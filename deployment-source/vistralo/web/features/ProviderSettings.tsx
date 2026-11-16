import React, { useEffect, useState } from "react";
import type { WorkspaceAdapter } from "../contracts";
import { Button, Field } from "../components/Controls";
import { Icon } from "../components/Icon";
import { errorMessage } from "./flow-utils";

type Settings = {
  openai: boolean;
  voiceId: string;
  cap: number;
  workerKey: boolean;
  /** The plan includes AI narration on Vistralo's own key, so the account's own key is optional. */
  included?: boolean;
};

// OpenAI text-to-speech voices; the worker keeps the same list (src/providers.cjs).
const DEFAULT_VOICE = "cedar";
const VOICES = [
  { id: "cedar", label: "Cedar (default)" },
  { id: "marin", label: "Marin" },
  { id: "alloy", label: "Alloy" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "fable", label: "Fable" },
  { id: "nova", label: "Nova" },
  { id: "onyx", label: "Onyx" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "verse", label: "Verse" },
];
// A voice saved before speech moved to OpenAI (a HeyGen voice ID) shows as the default, which the worker also uses.
const knownVoice = (id: string) => (VOICES.some((voice) => voice.id === id) ? id : DEFAULT_VOICE);

/**
 * Whether a key is on file. The key itself is never read back, so this is all the page can show.
 * On a plan that includes AI narration, no key of one's own means the included one is used.
 */
function KeyState({ saved, included }: { saved: boolean; included: boolean }) {
  const label = included ? (saved ? "Your key" : "Included") : saved ? "Saved" : "Not added";
  return (
    <span className={`key-state ${saved || included ? "is-saved" : ""}`.trim()}>
      <Icon name={saved || included ? "checkCircle" : "lock"} />
      {label}
    </span>
  );
}

/**
 * AI narration settings: the workspace's own OpenAI key, the voice, and the most a single job may
 * cost. OpenAI writes the narration and speaks it, so one key covers both. The key is sealed in
 * this browser before it is sent.
 */
export function ProviderSettings({
  adapter,
  notify,
}: {
  adapter: WorkspaceAdapter;
  notify: (message: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openai, setOpenai] = useState("");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE);
  const [cap, setCap] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    adapter
      .rpc("providerSettings")
      .then((value: Settings) => {
        if (cancelled) return;
        setSettings(value);
        setVoiceId(knownVoice(value.voiceId));
        setCap(value.cap.toFixed(2));
      })
      .catch((failure) => {
        if (!cancelled) setError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adapter.rpc("providerSave", { openai, voiceId, cap: Number(cap) });
      setOpenai("");
      setSettings(await adapter.rpc("providerSettings"));
      notify("AI provider settings saved");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const included = !!settings?.included;

  if (!settings && !error)
    return (
      <p className="caption" role="status">
        Loading AI settings…
      </p>
    );

  return (
    <form className="sheet-stack provider-settings" onSubmit={save}>
      {included ? (
        <p>
          Your plan includes AI narration. Vistralo writes and speaks it with OpenAI on its own
          account, so you need no key. To run narration on your own OpenAI account instead, add
          your key below.
        </p>
      ) : (
        <p>
          On the Free plan, Vistralo writes and speaks the narration with OpenAI using a key from
          your own account, and OpenAI bills you for what you use. Pro and Studio include AI
          narration with no key needed.
        </p>
      )}
      {settings && !settings.workerKey && (
        <p className="provider-notice" role="status">
          <Icon name="warning" />
          The worker that makes walkthroughs has not published its encryption key yet, so
          keys cannot be saved. Try again once it is running.
        </p>
      )}
      <section className="provider-group" aria-labelledby="provider-keys-title">
        <h2 id="provider-keys-title">Provider key</h2>
        <div className="sheet-group">
          <div className="provider-row">
            <div className="provider-row-head">
              <span>
                OpenAI
                <small>Looks at each screen, writes the line spoken over it, and speaks it.</small>
              </span>
              <KeyState saved={!!settings?.openai} included={included} />
            </div>
            <Field
              label={
                included
                  ? "Your own OpenAI key (optional)"
                  : settings?.openai
                    ? "Replace the OpenAI key"
                    : "OpenAI API key"
              }
              hint={settings?.openai ? "Leave empty to keep the saved key." : undefined}
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <p className="provider-sealed">
          <Icon name="lock" />
          Keys are encrypted in this browser for the worker alone. Nobody can read them
          back, including you, so a saved key is shown only as {included ? "“Your key”" : "“Saved”"}.
        </p>
      </section>
      <section className="provider-group" aria-labelledby="provider-voice-title">
        <h2 id="provider-voice-title">Voice and spending</h2>
        <div className="sheet-group">
          <div className="provider-row">
            <Field label="Narration voice" hint="One of OpenAI's voices, used for every walkthrough.">
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="provider-row">
            <Field
              label="Most a job may cost (US dollars)"
              hint={
                included
                  ? "Applies to jobs on your own key. Jobs on the included key stay within Vistralo's own limit, which this can lower but not raise. The same request is never sent twice."
                  : "The whole job counts: one that would cost more is refused before anything is sent. The same request is never sent twice."
              }
            >
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                max="50"
                step="0.01"
                required
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>
      {error && (
        <p className="field-error" role="alert">
          <Icon name="warning" />
          {error}
        </p>
      )}
      <div>
        <Button variant="primary" type="submit" busy={busy} busyLabel="Saving…">
          Save AI settings
        </Button>
      </div>
    </form>
  );
}
