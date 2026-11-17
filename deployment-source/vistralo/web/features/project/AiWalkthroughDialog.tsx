import React, { useEffect, useState } from "react";
import type { Project, WorkspaceAdapter } from "../../contracts";
import { Button, Field } from "../../components/Controls";
import { Dialog } from "../../components/Primitives";
import { Icon } from "../../components/Icon";
import {
  aiWalkthroughEstimate,
  errorMessage,
  formatDuration,
  publicWebsite,
  websiteProblem,
} from "../flow-utils";

type ProviderState = { openai: boolean; cap: number; included?: boolean };

const dollars = (value: number) => `$${value.toFixed(2)}`;

/** A project an AI walkthrough can be added to: it has a video and nothing is running on it. */
export function canAddAiWalkthrough(project: Project) {
  return (
    !project.trashed &&
    !!(project.video || project.data?.video || project.data?.walkthroughVideo) &&
    !["uploading", "queued", "processing"].includes(project.status)
  );
}

/**
 * Asked before an AI walkthrough is queued: what it does, what it is likely to cost, and whose
 * key pays. Starting it only drafts the script; nothing is voiced until the owner has read it and
 * pressed Approve. The worker's per-job cost cap and the key rules are unchanged, and decide.
 */
export function AiWalkthroughDialog({
  project,
  adapter,
  onClose,
  onStarted,
  onSettings,
  notify,
}: {
  project: Project;
  adapter: WorkspaceAdapter;
  onClose: () => void;
  /** The draft is queued; the project should be refreshed and shown. */
  onStarted: (project: Project) => void;
  onSettings: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const cloud = adapter.mode === "cloud" && adapter.capabilities.providers;
  const [provider, setProvider] = useState<ProviderState | null>(null),
    [loadError, setLoadError] = useState(""),
    [url, setUrl] = useState(project.source === "web" ? "" : project.url || ""),
    [touched, setTouched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!cloud) return;
    let live = true;
    adapter
      .rpc<ProviderState>("providerSettings")
      .then((value) => live && setProvider(value))
      .catch((failure) => live && setLoadError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, []);
  const duration = Number(project.duration || project.data?.mediaInfo?.duration) || 0;
  const estimate = aiWalkthroughEstimate(duration);
  const redo = !!project.data?.narratedVideo;
  const noKey = !!provider && !provider.included && !provider.openai;
  const problem = project.source === "web" ? "" : websiteProblem(url);
  const ready = cloud && !!provider && !noKey && !problem && !busy;

  async function start() {
    if (!ready) {
      setTouched(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The address helps the draft name the site's real build; it is saved with the project.
      if (project.source !== "web") {
        const next = url.trim() ? publicWebsite(url) : undefined;
        if ((next || "") !== (project.url || "")) await adapter.update(project.id, { url: next });
      }
      // Always the reviewed path: the script is drafted and saved, and nothing is voiced yet.
      await adapter.rpc("voiceover", { id: project.id, review: true });
      notify("Vistralo is drafting the narration. It stops for you to read it before anything is voiced.");
      let refreshed = project;
      try {
        refreshed = (await adapter.project(project.id)).project;
      } catch {
        /* The queued job stands even if this refresh fails. */
      }
      onStarted(refreshed);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={redo ? "Redo the AI walkthrough" : "Add an AI walkthrough"}
      description={
        <>
          Vistralo watches <strong>{project.name}</strong>, pauses on each screen and explains it in
          an AI voice.
        </>
      }
      icon="sparkle"
      onClose={busy ? () => {} : onClose}
      className="ai-walkthrough-dialog"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button
            variant="primary"
            icon="sparkle"
            busy={busy}
            busyLabel="Starting…"
            disabled={!ready && (!cloud || !provider || noKey)}
            onClick={() => void start()}
          >
            Draft the script
          </Button>
        </>
      }
    >
      <ol className="ai-steps">
        <li>
          <Icon name="edit" />
          <span>
            <strong>Vistralo drafts the narration</strong>
            <small>One short script for each screen in the video.</small>
          </span>
        </li>
        <li>
          <Icon name="checkCircle" />
          <span>
            <strong>You read and edit it</strong>
            <small>Nothing is voiced until you press Approve.</small>
          </span>
        </li>
        <li>
          <Icon name="mic" />
          <span>
            <strong>Vistralo adds the voice</strong>
            <small>The video pauses on each screen while it is explained.</small>
          </span>
        </li>
      </ol>
      <section className="ai-cost" aria-labelledby="ai-cost-title">
        <h3 id="ai-cost-title">Cost</h3>
        {estimate ? (
          <p>
            About <strong className="edge">{dollars(estimate.total)}</strong> for this{" "}
            {formatDuration(duration)} video: about {dollars(estimate.script)} to draft the script
            now, and about {dollars(estimate.voice)} for the voice after you approve. This is an
            estimate; the real number depends on how many screens Vistralo finds.
          </p>
        ) : (
          <p>
            Usually between $0.10 and $1.20, depending on the video's length and how many screens
            Vistralo finds. Drafting the script is about 10 cents plus under a cent a screen.
          </p>
        )}
        <p className="flow-muted">
          {!cloud
            ? "AI walkthroughs run in a Vistralo cloud workspace, which prices each job before it starts."
            : provider
              ? provider.included
                ? provider.openai
                  ? `Runs on your own OpenAI key. Each job stops before it would go over your ${dollars(provider.cap)} cost cap.`
                  : `Runs on the AI included in your plan, within Vistralo's own limit and your ${dollars(provider.cap)} cost cap per job.`
                : provider.openai
                  ? `Runs on your OpenAI key. Each job stops before it would go over your ${dollars(provider.cap)} cost cap, so it never spends more than that.`
                  : "Add your OpenAI key in Settings to use AI walkthroughs."
              : loadError || "Checking your AI settings…"}
        </p>
      </section>
      {noKey && (
        <p className="sheet-note">
          <Icon name="lock" />
          <span>
            AI walkthroughs use your OpenAI key on this plan.{" "}
            <button type="button" className="link-button" onClick={onSettings}>
              Open AI settings
            </button>
          </span>
        </p>
      )}
      {project.source !== "web" && (
        <Field
          label={
            <>
              Website shown in the video <span className="flow-muted">(optional)</span>
            </>
          }
          error={touched || (url.trim() && problem && url.length > 3) ? problem : ""}
          hint="If the video shows a public website, Vistralo reads its code to name the real tech behind each effect."
        >
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            placeholder="example.com"
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        </Field>
      )}
      {!cloud && (
        <p className="sheet-note">
          <Icon name="info" />
          <span>
            This demo keeps everything in your browser, so nothing is drafted or voiced here.
            Connect a Vistralo cloud workspace to add AI walkthroughs.
          </span>
        </p>
      )}
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
