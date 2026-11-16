# Providers and spending

Vistralo calls one paid provider, OpenAI, only from the worker and only for real jobs. OpenAI writes the script and speaks it. HeyGen was removed in November 2026; its column in `vistralo_provider_settings` is no longer read.

## Keys

On Pro and Studio, jobs without a key of their own run on Vistralo's included key (`VISTRALO_INCLUDED_OPENAI_API_KEY`, see `src/included-ai.cjs` and the README). On Free, or to use their own account, the workspace owner enters an OpenAI key and picks a voice in the app's provider settings. The browser seals the key to the capture worker's public key (`web/cloud.ts`, `scripts/worker-secrets.cjs`) before saving it through `vistralo_save_provider_settings`, so the database only holds ciphertext. The private key stays on the worker host. Never paste keys into project names, briefs, prompts, logs or Git.

## OpenAI (director script)

The worker sends every held viewport plus small in-motion frames, and the build read's evidence text, in one structured request (`providers.directorScript`). The model is `VISTRALO_DIRECTOR_MODEL` if set, else `gpt-5-mini`, falling back to `gpt-4.1` and then `gpt-4o-mini` on HTTP 400, 403, 404 or 429.

The request carries a word budget that keeps the film near three times the recording and not much past six minutes. The director leaves repeated screens silent (the video plays through them), and each spoken stop ends with one line on how that section is built, hedged with "looks like" unless the build read proved it. The full detail per screen stays in the build brief.

## OpenAI (voice)

Speech is made per spoken stop with `POST /v1/audio/speech` (`providers.speech`), model `gpt-4o-mini-tts` with a short speaking-style instruction. `VISTRALO_TTS_MODEL` on the worker overrides the model. The default voice is `cedar`; the owner can pick another built-in voice (alloy, ash, ballad, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse) in settings, and `VISTRALO_TTS_VOICE` overrides it for every owner. A saved voice that is not on that list, such as an old HeyGen voice ID, falls back to the default.

OpenAI takes at most 4,096 characters per request, so longer scripts are spoken in parts split at sentence ends. Audio comes back as raw 24 kHz PCM and is saved as WAV, so the parts join exactly and ffmpeg measures the length precisely.

## Checking the key

On the worker host, `node scripts/local-admin-worker.cjs --check-openai [owner id]` picks the key a job for that owner would use (their own, else the included one; the worker's own account by default), lists models with a free call, and prints whether the key works and which of the director and speech models it can use. It never prints the key and starts no jobs.

## Spending

Each owner sets a cost cap per job (`cost_cap_usd`, default $1) in provider settings. The cap covers the whole job, not each request: every paid call adds its estimate to the job's running total, and a call that would take the total past the cap is refused before it is sent. A walkthrough is priced as a whole before its first paid call (the script, plus speech for its full word budget, at least 1 cent per screen), so a job over the cap stops before spending anything. A request the provider refuses outright (HTTP 400, 403, 404 or 429) is not billed and gives its estimate back.

Estimates: script draft 2 cents plus 1 cent per frame; director script 10 cents plus 0.8 cents per screen; speech 2 cents per 1,000 characters, at least 1 cent per request. They cannot guarantee what OpenAI bills, so also set a budget in the OpenAI account.

A request that fails with an uncertain outcome is not retried automatically. When the worker restarts with a job still running, a job without paid calls is queued again, but a narration job (or a website capture that drafts a script) is marked failed instead, because part of it may already have been charged; the owner retries it.
