import React, { useEffect, useRef, useState } from "react";
import type { Project, WorkspaceAdapter } from "../contracts";
import {
  STOP_TEXT_LIMIT,
  errorMessage,
  formatDuration,
  walkthroughScriptEdit,
  type WalkthroughStop,
} from "./flow-utils";

type Draft = { stops: WalkthroughStop[]; closing?: string; draftedAt?: string };

// Speech runs at about 2.4 words a second, the same pace the director writes for.
const spokenSeconds = (texts: string[]) =>
  texts.join(" ").split(/\s+/).filter(Boolean).length / 2.4;

/**
 * The drafted narration of a recorded walkthrough, one row per screen, for the owner to read and
 * edit before it is voiced. Approving saves the edits and queues the voice; nothing is spoken before.
 */
export function WalkthroughScript({
  adapter,
  project,
  disabled,
  onDirty,
  onDone,
  notify,
}: {
  adapter: WorkspaceAdapter;
  project: Project;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onDone: () => Promise<void> | void;
  notify: (message: string, error?: boolean) => void;
}) {
  const draft = project.data.walkthroughDraft as Draft;
  const [texts, setTexts] = useState<string[]>(() => draft.stops.map((s) => s.text || ""));
  const [closing, setClosing] = useState(draft.closing || "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
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
  const seconds = spokenSeconds(spoken);

  async function save() {
    walkthroughScriptEdit(draft, texts.map((text) => ({ text })), closing);
    await adapter.rpc("walkthroughScriptSave", {
      id: project.id,
      stops: texts.map((text) => ({ text })),
      closing,
    });
    setDirty(false);
  }

  async function run(label: string, work: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await work();
      await onDone();
      notify(message);
    } catch (failure) {
      const text = errorMessage(failure);
      setError(text);
      notify(text, true);
    } finally {
      setBusy("");
    }
  }

  const update = (i: number, value: string) => {
    setTexts((current) => current.map((text, j) => (j === i ? value : text)));
    setDirty(true);
  };

  return (
    <section className="flow-stack walkthrough-script" aria-labelledby="walkthrough-script-title">
      <header className="flow-heading">
        <div>
          <h2 id="walkthrough-script-title">Narration script</h2>
          <p className="flow-muted">
            Read what will be said on each screen and change anything before it is voiced.
            Leave a screen empty and the video plays through it without stopping.
          </p>
        </div>
      </header>
      <p className="flow-caption flow-muted" aria-live="polite">
        {spoken.length} of {texts.length + 1} parts spoken · about {formatDuration(seconds)} of
        voice
      </p>
      <ol className="walkthrough-stops">
        {draft.stops.map((stop, i) => (
          <li key={`${stop.at}-${i}`}>
            {stop.frame ? (
              <img
                src={adapter.media(project.id, stop.frame)}
                alt={`Screen ${i + 1}${stop.label ? `, ${stop.label}` : ""}`}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="walkthrough-stop-blank" aria-hidden="true" />
            )}
            <label className="field">
              <span>
                <time>{formatDuration(stop.at)}</time> · Screen {i + 1}
                {stop.label ? ` · ${stop.label}` : ""}
              </span>
              <textarea
                rows={4}
                maxLength={STOP_TEXT_LIMIT}
                value={texts[i]}
                placeholder="Silent: the video plays through this screen."
                onChange={(event) => update(i, event.target.value)}
                disabled={disabled || !!busy}
              />
            </label>
          </li>
        ))}
        <li>
          <span className="walkthrough-stop-blank" aria-hidden="true" />
          <label className="field">
            <span>Closing · design system</span>
            <textarea
              rows={3}
              maxLength={STOP_TEXT_LIMIT}
              value={closing}
              placeholder="Silent: the film ends on the last screen."
              onChange={(event) => {
                setClosing(event.target.value);
                setDirty(true);
              }}
              disabled={disabled || !!busy}
            />
          </label>
        </li>
      </ol>
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
      <div className="flow-actions">
        <button
          className="button"
          disabled={disabled || !!busy || !dirty}
          onClick={() => void run("Saving script", save, "Script saved.")}
        >
          {busy === "Saving script" ? "Saving…" : "Save script"}
        </button>
        <button
          className="button button-primary"
          disabled={disabled || !!busy || !spoken.length}
          onClick={() =>
            void run(
              "Generating voice",
              async () => {
                if (dirty) await save();
                await adapter.rpc("walkthroughApprove", { id: project.id });
              },
              "Script approved. Vistralo is adding the voice and building the film.",
            )
          }
        >
          {busy === "Generating voice" ? "Starting…" : "Approve and generate voice"}
        </button>
      </div>
    </section>
  );
}
