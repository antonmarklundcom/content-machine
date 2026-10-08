# b5-d — Chatterbox voice provider

## Built

- `src/lib/voice/providers/chatterbox.ts`: `chatterboxAdapter(env, deps?)` (same exported signature plus optional injected `fetch`/`readFile`/`sleep`/`now`/`toWav`/`mediaRoot`) and `chatterboxConfigured(env)`, replacing the stub.
- Local mode: `POST ${CHATTERBOX_URL ?? http://127.0.0.1:8004}/tts` `{text, language_id, exaggeration, cfg_weight, reference_wav_base64}` → WAV; per-chunk timeout `CHATTERBOX_TIMEOUT_SEC` (900); clear "server not running" message; `chatterboxHealth()` (`GET /health`).
- Replicate mode: prediction per chunk (`CHATTERBOX_REPLICATE_MODEL`, `owner/name` or `owner/name:version`), reference as data URI ≤ 256 KB else uploaded to `/v1/files`, poll to succeeded/failed/canceled/timeout (cancels), download without the token, ffmpeg → WAV when needed, `costUsd` = predict time × `CHATTERBOX_REPLICATE_USD_PER_SEC`.
- Pure helpers: `splitForChatterbox` (≤ 300 chars at sentence ends, packed, long sentences cut at commas/spaces), `joinWavs` (250 ms gaps), `chatterboxLanguageId` (es-PY/jopara → es, gn → null).
- Refusals in the adapter: no/missing reference, gn, replicate without token, bad URL — with the Settings field named. `listVoices()` → [], alignment null.
- `POST/GET /api/voice/reference/[profileId]` + `reference.ts` (ffmpeg → WAV 24 kHz mono, leading silence trimmed, ≤ 30 s, ≥ 3 s; `voice/_references/<key>-<stamp>.wav`; SQL jsonb merge of `settings.chatterbox.referencePath`, mode defaults to `local`). Consent-gated via `assertConsent`.
- `ChatterboxReferencePanel` (client): player, upload, "record 10 s" (MediaRecorder), consent notice.
- `tools/chatterbox-server/`: `server.py` (stdlib HTTP, 127.0.0.1 only, model loaded once on CPU, same splitting, one generation at a time), `requirements.txt`, `start.bat`, `start.ps1`, `README.md`, `.gitignore`.
- `docs/CHATTERBOX.md`; dict `chatterbox.*` (en + sv).
- Tests: `providers/chatterbox.test.ts` (11) and `tests/integration/b5-d-chatterbox-reference.test.ts` (3).

## Decisions

- Text is split client side (in the adapter) for both modes: per-chunk timeouts, no chapter-sized CPU request, same behaviour on Replicate. The server splits too (same rule) for hand use.
- `chatterboxConfigured`: ok on the PC without setup (local default URL acceptable), ok with a token or URL online; a malformed URL is not ok. Per-mode checks live in the adapter.
- Spend cap reserves 0 for Chatterbox (`costs.ts` unchanged); the actual Replicate cost is recorded after the take.
- The reference route writes settings with a jsonb merge, not `updateProfile` (whose `cleanSettings` drops `chatterbox`).
- References are not media assets (like consents); older samples stay on disk.
- Python server uses the standard library HTTP server (no FastAPI/uvicorn deps).

## Known issues

- Local server, CPU speeds and the requirements pins are UNVERIFIED (not run here).
- Replicate slug `resemble-ai/chatterbox-multilingual`, its input field names and the $0.000975/s rate are UNVERIFIED.
- `store.ts` `cleanSettings` strips `settings.chatterbox` (and `higgsfield`): saving the profile form erases the reference path — see Link pass.
- `validateProfile` requires a provider voice id and `assertCanSynthesize` refuses without one; Chatterbox profiles must carry a dummy id (e.g. the key) until fixed.
- No mode/knob fields in `VoiceProfileForm` yet (phase A owns it).

## Link pass

- `src/lib/voice/store.ts` `cleanSettings`: keep `chatterbox` (`mode` local|replicate, `referencePath`, `exaggeration` 0.25–2, `cfgWeight` 0–1, `languageId`) — otherwise the form wipes the reference.
- `validateProfile` / `refusals.ts assertCanSynthesize`: don't require `providerVoiceId` for `chatterbox` (the reference is the voice).
- Mount `ChatterboxReferencePanel` (`src/components/ChatterboxReferencePanel.tsx`) on /voice for chatterbox profiles: `{ profileId: number, referencePath?: string | null, consentStatus: ConsentStatus, locale?: Locale, onSaved?(path) }`.
- `VoiceProfileForm`: chatterbox mode select + exaggeration/cfg weight/language id fields.
- `.env.example`: `CHATTERBOX_TIMEOUT_SEC`, `CHATTERBOX_REPLICATE_MODEL`, `CHATTERBOX_REPLICATE_USD_PER_SEC`.
- `docs/VOICE.md` providers table + README: link docs/CHATTERBOX.md; PLAN-build5 §5 row for D.
- Optional: a Settings "test connection" button calling `chatterboxHealth()`.

## Verification

- `npm run typecheck`: pass · `npm run lint`: pass · `npm test`: 611/611 pass · `npm run test:db`: 343/343 pass (local Postgres `content_engine_b5d`, ffmpeg present, no keys, no network). `npm run build` not run (per instructions).
