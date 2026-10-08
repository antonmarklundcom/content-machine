# Chatterbox — free voice cloning (build 5, phase D)

**Chatterbox Multilingual** is Resemble AI's open-source text-to-speech model.
It copies a voice from a short reference sample (~10 s) and speaks Spanish and
about 20 other languages (Arabic, Danish, German, Greek, English, Finnish,
French, Hebrew, Hindi, Italian, Japanese, Korean, Malay, Dutch, Norwegian,
Polish, Portuguese, Russian, Swedish, Swahili, Turkish, Chinese). It does
**not** speak Guaraní: Guaraní stays recorded by people (PLAN-build4 §1.4).

In content-engine it is the voice provider `chatterbox`, with two modes per
voice profile (`settings.chatterbox.mode`):

| Mode | Where it runs | Setup (Settings) | Cost | Speed |
|---|---|---|---|---|
| `local` | `tools/chatterbox-server` on this PC, CPU | “Chatterbox server URL” (empty = `http://127.0.0.1:8004`) | free | slow (overnight batches) |
| `replicate` | Replicate's cloud GPUs | “Replicate API token” | cents per clip | seconds per sentence |

Every live path here is **UNVERIFIED** until Anton runs the server or sets a
token: request shapes are unit-tested against canned responses only.

## Licence

MIT. Commercial use is allowed, including for cuentos.com.py and the brands.
Resemble AI adds an inaudible watermark (Perth) to generated audio; it does not
change how it sounds. Cloning still needs the person's consent (below) — the
licence covers the software, not anyone's voice.

## The reference sample

- **About 10 seconds** of the person speaking clearly, alone, in a quiet room,
  in the language and mood you want (a calm storyteller voice for bedtime
  stories). Same mic as later recordings if possible. No music, no echo.
- It is **only the voice to copy**. Takes can be any length: a whole book is
  split into sentences and every sentence is spoken in that voice.
- Upload or record it on the voice profile (the “Chatterbox reference sample”
  panel, `ChatterboxReferencePanel`). The route `POST /api/voice/reference/<profile id>`
  (owner only, ≤ 20 MB, any audio ffmpeg reads) trims leading silence,
  converts to **WAV 24 kHz mono**, keeps the first **30 s**, refuses under 3 s,
  and stores it as `MEDIA_ROOT/voice/_references/<profile-key>-<timestamp>.wav`.
  The path goes into `settings.chatterbox.referencePath`; other settings are
  untouched and older samples stay on disk. `GET` on the same URL plays it.
- A profile without a sample refuses with `provider_not_configured`.

## Consent

A cloned voice is a person (PLAN-build5 §1.4). The reference upload is refused
(`consent_missing`, 422) unless the profile's consent is `signed` (and not
expired) or `not_needed`; `narrate()` checks it again before every take. For a
real person's voice set the consent to `signed`, name the person and upload the
signed document on the profile first. `not_needed` is only for a voice nobody
owns (for example a synthetic voice you generated yourself).

## Knobs (per profile, `settings.chatterbox`)

- `exaggeration` 0.25–2 (default 0.5): emotion and intensity. 0.3–0.5 for
  calm narration; higher is more dramatic and speeds speech up.
- `cfgWeight` 0–1 (default 0.5): pacing and adherence to the reference. Lower
  (~0.3) slows a fast speaker down and helps when the reference has a strong
  accent in another language.
- `languageId` (default from the take's language: `es-PY`/`jopara`/`es` → `es`).
- Word timings: none (`alignment` is null); captions fall back to proportional timing.

## How a take is made

The adapter (`src/lib/voice/providers/chatterbox.ts`) splits the text **in the
app** into chunks of at most ~300 characters at sentence ends (short sentences
packed together, long ones cut at commas), sends one request per chunk, and
joins the WAVs with 250 ms of silence into one take. Same behaviour in both
modes; the timeout applies per chunk. The local server splits too, by the same
rule, so it is also safe to call by hand.

## Quality — what to expect

Good, natural Spanish from a clean sample; the accent follows the reference, so
a Paraguayan speaker's sample gives a Paraguayan-sounding voice (neutral
Latin-American Spanish otherwise). Weaknesses: occasional mispronounced names
or Guaraní loanwords (use the pronunciation dictionary), sometimes a breath or
artefact at chunk edges, and less control than ElevenLabs. Listen to every take
(the voice gate at /voice/test compares it with the other providers).

## Local mode on Windows (Anton's PC)

i7-13620H, 24 GB RAM, Intel integrated graphics — **no NVIDIA GPU**, so it runs
on the CPU. That works, it is just slow.

1. Install **Python 3.11** (python.org; tick “Add python.exe to PATH”).
2. Run `tools\chatterbox-server\start.bat` (or `start.ps1`). The first run
   creates `.venv`, installs CPU PyTorch + `chatterbox-tts` (~1 GB, from the
   CPU wheel index) and downloads the model (~3 GB) from Hugging Face.
3. Leave the window open; it listens on `127.0.0.1:8004` only (no password, so
   never on the network). `GET /health` answers `{"status":"ok", ...}`.
4. Settings: “Chatterbox server URL” can stay empty (the default) or point
   elsewhere. `CHATTERBOX_TIMEOUT_SEC` (default 900) is the per-chunk timeout.
5. On a voice profile with provider `chatterbox`, mode `local`, upload the
   sample and make a take.

**CPU speed (UNVERIFIED estimate):** roughly 2–6× slower than real time on this
CPU — a 300-character chunk (~20 s of speech) in about 40 s to 2 min, a
5-minute story in 10–30 minutes, model load about a minute. RAM use is a few
GB. Queue a book before bed. Close heavy apps; `--threads` sets CPU threads.

## Replicate mode

1. Create a token at replicate.com/account/api-tokens and paste it in Settings
   (“Replicate API token”). Set up billing on Replicate.
2. On the profile choose mode `replicate` and upload the sample.
3. The adapter creates one prediction per chunk with the text, language,
   reference audio (a data URI up to 256 KB, otherwise uploaded to Replicate's
   file API first), exaggeration and cfg weight; polls every 2 s until
   `succeeded` (or `failed`/`canceled`, or the timeout — then it cancels);
   downloads the output (the token is never sent to the download host) and
   converts it to WAV with ffmpeg if it is not WAV already.

- **Model:** `CHATTERBOX_REPLICATE_MODEL`, default
  `resemble-ai/chatterbox-multilingual` — **UNVERIFIED slug**; check the model
  page and change the env var if it differs. `owner/name:version` pins a version.
  The input field names (`text`, `language`, `reference_audio`, `exaggeration`,
  `cfg_weight`) are also UNVERIFIED; they live in `replicateInput()`.
- **Cost:** `costUsd` = Replicate predict time × `CHATTERBOX_REPLICATE_USD_PER_SEC`
  (default **$0.000975/s**, Replicate's public L40S GPU rate — UNVERIFIED for
  this model); without a predict time, the audio length is used. Expect about
  5–15 s of GPU time per chunk, i.e. roughly half a cent to 1.5 cents per
  20 seconds of speech, around $0.10–0.40 for a 5-minute story. The spend cap
  reserves nothing up front for Chatterbox (`estimateTakeUsd` is 0); the actual
  cost is recorded after the take.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `CHATTERBOX_URL` | `http://127.0.0.1:8004` | local server (Settings field) |
| `CHATTERBOX_TIMEOUT_SEC` | 900 | per-chunk timeout, both modes |
| `REPLICATE_API_TOKEN` | — | Replicate mode (Settings field) |
| `CHATTERBOX_REPLICATE_MODEL` | `resemble-ai/chatterbox-multilingual` | UNVERIFIED |
| `CHATTERBOX_REPLICATE_USD_PER_SEC` | 0.000975 | cost per second of predict time |

## Refusals

- No reference sample, or the file is gone (drive unplugged?) → `provider_not_configured`.
- Mode `replicate` without a token → `provider_not_configured` naming “Replicate API token”.
- A bad “Chatterbox server URL” (or online without a URL) → `provider_not_configured`.
- Guaraní (`gn`) → `language_not_supported`, as every TTS provider.
- Consent not `signed`/`not_needed` → `consent_missing` (upload and takes).
- Server not running → an error naming the server URL and `start.bat`.
