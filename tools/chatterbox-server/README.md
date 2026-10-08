# Chatterbox server (local, CPU)

A small HTTP server that runs **Chatterbox Multilingual** (Resemble AI, MIT
licence) on this PC and speaks for content-engine's `chatterbox` voice profiles
in `local` mode. Full guide: [docs/CHATTERBOX.md](../../docs/CHATTERBOX.md).

**UNVERIFIED** — written in the build session, not run there.

## Start (Windows)

1. Install **Python 3.11** from python.org (tick "Add python.exe to PATH").
2. Double-click `start.bat` (or `powershell -ExecutionPolicy Bypass -File start.ps1`).
   The first run creates `.venv`, installs CPU PyTorch and `chatterbox-tts`
   (~1 GB) and downloads the model from Hugging Face (~3 GB). Later runs start
   in about a minute.
3. Leave the window open. In content-engine Settings, "Chatterbox server URL"
   can stay empty (default `http://127.0.0.1:8004`) or be set to it.

Options: `start.bat --port 8010 --threads 8` (or `CHATTERBOX_PORT`,
`CHATTERBOX_THREADS`). It listens on **127.0.0.1 only** and has no password,
so it is never reachable from the network.

## API

- `GET /health` → `{"status":"ok","model_loaded":true,"device":"cpu","sample_rate":24000,"languages":[...]}`
- `POST /tts` with JSON
  `{"text": "...", "language_id": "es", "exaggeration": 0.5, "cfg_weight": 0.5, "reference_wav_base64": "<WAV>"}`
  → `audio/wav` (mono, 24 kHz, 16-bit).

Text over 300 characters is split at sentence ends and joined with 250 ms of
silence (the app already sends chunks of at most 300 characters, so this only
matters when you call it by hand). One generation runs at a time; others wait.
Errors come back as `{"error": "..."}` with a 4xx/5xx status.

## Speed

On an i7-13620H (CPU only) expect very roughly 2–6× slower than real time: a
10-second sentence may take 20–60 s. Fine for overnight batches; use Replicate
for quick tests. Estimates, not measurements.
