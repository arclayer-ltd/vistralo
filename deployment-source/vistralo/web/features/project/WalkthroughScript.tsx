import React, { useEffect, useRef, useState } from "react";
import type { Project, WorkspaceAdapter } from "../../contracts";
import { Button } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import {
  STOP_TEXT_LIMIT,
  formatDuration,
  walkthroughScriptEdit,
  type WalkthroughStop,
} from "../flow-utils";
import type { ProjectAction } from "./useProjectDetail";

type Draft = { stops: WalkthroughStop[]; closing?: string; draftedAt?: string };

// Speech runs at about 2.4 words a second, the same pace the director writes for.
const spokenSeconds = (texts: string[]) =>
  texts.join(" ").split(/\s+/).filter(Boolean).length / 2.4;

/** A recorded walkthrough whose script was written for review and is not voiced yet. */
export const awaitingReview = (project: Project) =>
  project.type === "walkthrough" &&
  !!project.data.walkthroughDraft &&
  project.data.scriptApproved !== true;

/**
 * The drafted narration of a recorded walkthrough, one row per screen beside its still, for the
 * owner to read and edit before it is voiced. Approving saves the edits and queues the voice;
 * nothing is spoken before that.
 */
export function WalkthroughScript({
  adapter,
  project,
  processing,
  action,
  onDirty,
}: {
  adapter: WorkspaceAdapter;
  project: Project;
  processing: boolean;
  action: ProjectAction;
  onDirty: (dirty: boolean) => void;
}) {
  const draft = project.data.walkthroughDraft as Draft;
  const [texts, setTexts] = useState<string[]>(() => draft.stops.map((s) => s.text || ""));
  const [closing, setClosing] = useState(draft.closing || "");
  const [dirty, setDirty] = useState(false);
  const seen = useRef(draft.draftedAt);

  // A newly drafted script (after a redo) replaces the rows, unless the owner is mid-edit.
  useEffect(() => {
    if (seen.current === draft.draftedAt || dirty) return;
    seen.current = draft.draftedAt;
    setTexts(draft.stops.map((s) => s.text || ""));
    setClosing(draft.closing || "");
  }, [draft, dirty]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const spoken = [...texts, closing].filter((t) => t.trim());
  const edit = (i: number, value: string) => {
    setTexts((current) => current.map((text, j) => (j === i ? value : text)));
    setDirty(true);
  };
  async function save() {
    const stops = texts.map((text) => ({ text }));
    walkthroughScriptEdit(draft, stops, closing);
    await adapter.rpc("walkthroughScriptSave", { id: project.id, stops, closing });
    setDirty(false);
  }

  return (
    <section className="walkthrough-script" aria-labelledby="walkthrough-script-title">
      <header className="flow-heading">
        <div>
          <h2 id="walkthrough-script-title">Narration script</h2>
          <p className="flow-muted">
            Read what will be said on each screen and change anything before it is voiced.
            Leave a screen empty and the video plays through it without stopping.
          </p>
        </div>
        {dirty && <span className="edge brief-unsaved">Unsaved changes</span>}
      </header>
      <p className="edge walkthrough-count" aria-live="polite">
        {spoken.length} of {texts.length + 1} parts spoken · about{" "}
        {formatDuration(spokenSeconds(spoken))} of voice
      </p>
      <ol className="walkthrough-stops">
        {draft.stops.map((stop, i) => (
          <li key={`${stop.at}-${i}`} className={stop.frame ? "" : "no-still"}>
            {stop.frame && (
              <img
                src={adapter.media(project.id, stop.frame)}
                alt={`Screen ${i + 1}${stop.label ? `, ${stop.label}` : ""}`}
                loading="lazy"
                decoding="async"
              />
            )}
            <label className="walkthrough-stop">
              <span className="edge">
                <time>{formatDuration(stop.at)}</time> · Screen {i + 1}
                {stop.label ? ` · ${stop.label}` : ""}
              </span>
              <textarea
                rows={4}
                maxLength={STOP_TEXT_LIMIT}
                value={texts[i]}
                placeholder="Silent: the video plays through this screen."
                onChange={(event) => edit(i, event.target.value)}
                disabled={processing}
              />
            </label>
          </li>
        ))}
        <li className="no-still">
          <label className="walkthrough-stop">
            <span className="edge">Closing · design system</span>
            <textarea
              rows={3}
              maxLength={STOP_TEXT_LIMIT}
              value={closing}
              placeholder="Silent: the film ends on the last screen."
              onChange={(event) => {
                setClosing(event.target.value);
                setDirty(true);
              }}
              disabled={processing}
            />
          </label>
        </li>
      </ol>
      <div className="flow-actions">
        <Button
          disabled={processing || !dirty}
          onClick={() => void action("Saving script", save, "Script saved.")}
        >
          Save script
        </Button>
        <Button
          variant="primary"
          disabled={processing || !spoken.length}
          onClick={() =>
            void action(
              "Generating voice",
              async () => {
                if (dirty) await save();
                await adapter.rpc("walkthroughApprove", { id: project.id });
              },
              "Script approved. Vistralo is adding the voice and building the film.",
            )
          }
        >
          Approve and generate voice
        </Button>
      </div>
      <p className="brief-script-cost">
        <Icon name="info" />
        Making the voice is a paid request to OpenAI, on your own key or, on Pro and Studio, on
        Vistralo’s. It runs only if its estimate fits the cost cap per job in Settings, under AI
        narration.
      </p>
    </section>
  );
}
