import React, { useEffect, useState } from "react";
import type { WorkspaceAdapter } from "../contracts";
import { errorMessage } from "./flow-utils";

type Settings = {
  openai: boolean;
  voiceId: string;
  cap: number;
  workerKey: boolean;
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
const knownVoice = (id: string) =>
  VOICES.some((voice) => voice.id === id) ? id : DEFAULT_VOICE;

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

  if (!settings && !error) return <p className="caption">Loading AI settings…</p>;

  return (
    <form className="flow-stack provider-settings" onSubmit={save}>
      <p className="caption">
        Keys are encrypted in this browser against the capture worker’s public
        key. They are never stored in readable form and cannot be displayed
        again after saving.
      </p>
      {settings && !settings.workerKey && (
        <p className="flow-notice">
          The capture worker has not published an encryption key yet. Start the
          worker before saving keys.
        </p>
      )}
      <label className="field">
        OpenAI API key {settings?.openai && <span className="caption">— configured</span>}
        <input
          type="password"
          autoComplete="off"
          placeholder={settings?.openai ? "Saved. Enter a new key to replace it." : "sk-…"}
          value={openai}
          onChange={(e) => setOpenai(e.target.value)}
        />
      </label>
      <p className="caption">
        OpenAI writes the narration and speaks it, so this one key covers both.
      </p>
      <label className="field">
        Narration voice
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
          {VOICES.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Cost cap per job (USD)
        <input
          type="number"
          min="0.01"
          max="50"
          step="0.01"
          required
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </label>
      <p className="caption">
        Every paid request is refused unless its reviewed estimate fits inside
        this cap, and identical requests are never submitted twice.
      </p>
      {error && <p className="flow-error">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save AI settings"}
      </button>
    </form>
  );
}
