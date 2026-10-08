# b4-a — Voice engine + voice studio

## Built

- `src/lib/voice/index.ts`: `narrate` (refusals → pronunciations → provider under `withSpendCap` + `recordSpend` → WAV master + MP3 → ffprobe duration → both `registerFile`d → `narrations` row; failures keep a `failed` row), `importRecording` (any audio → WAV 48 kHz mono + MP3, `manual`), `selectTake` (one transaction), `reviewTake`, `voiceChangeRecording` (ElevenLabs speech-to-speech, optional).
- Providers behind one `VoiceAdapter` (`providers/`): ElevenLabs (with-timestamps → word timings, `/v1/voices`), Azure (SSML, es-PY voices, voice list), Gemini TTS (via `geminiClient()`, PCM → WAV), plus `fake.ts` (`VOICE_FAKE=1`/tests) — only `providers/index.ts` knows about it.
- Pure modules with unit tests: `pronunciations.ts` (Unicode/Guaraní-aware, scope ranking), `alignment.ts`, `ssml.ts`, `wav.ts`, `costs.ts`, `refusals.ts`.
- `store.ts` (profiles, pronunciations, takes, voice-test runs; validation), `views.ts`, `http.ts`, `audio.ts` (ffmpeg via the clip-fetch binary lookup).
- `src/lib/voice.actions.ts`: owner-only server actions for profiles, voice lists, pronunciations (CRUD, review, preview), takes, the voice gate and winner.
- Pages `/voice`, `/voice/pronunciations`, `/voice/test`; routes `POST /api/voice/recordings`, `POST /api/voice/consent`, `GET /api/voice/consent/[id]`.
- Components: `NarrationTakes`, `NarrateButton`, `VoiceProfileForm/Row`, `Pronunciation{Form,Row,AddForm}`, `VoiceTestForm/Run`, `VoiceSubnav`, `VoiceStyles`; dict `voice.*` (en + sv).
- `scripts/voice-test.ts` CLI; `docs/VOICE.md`.
- Tests: 4 unit files (42 tests) + `tests/integration/b4-a-voice.test.ts`, `b4-a-voice-ui.test.ts` (13 tests; ffmpeg ones skip without it).

## Decisions

- Inactive/unknown profile and a manual profile in `narrate` refuse as `provider_not_configured` (the contract union has no `inactive`; not widened).
- `narrate` also refuses `text_not_approved` on pending-review markers (§1.3); `TODO`/`PENDIENTE`/`REVISAR` are case-sensitive because "todo" is Spanish.
- Refusals and a missing media drive throw before any row is written; anything after the row (spend cap, provider, ffmpeg) leaves a `failed` row.
- Without ffmpeg `narrate` still works: the WAV is also the playback copy. `importRecording` needs ffmpeg.
- Fake is on with `VOICE_FAKE=1`, `NODE_ENV=test` or `GEMINI_FAKE=1`; `VOICE_FAKE=0` forces real adapters. Fake tones carry dither so takes never share an asset sha.
- Uploads go through route handlers, not server actions (server-action body limit is 1 MB). Consent docs are not registered as assets (contracts, not content).
- Word timings are mapped back to the written words when the respelled text has the same word count.
- `narrate(req, { skipPronunciations, includeProposed })` — optional second arg for previews; contract unchanged.

## Known issues

- ElevenLabs, Azure, Gemini TTS and speech-to-speech live paths are UNVERIFIED (no keys in the build session); request shapes are unit-tested against canned responses.
- ElevenLabs/Azure cost is the per-character estimate (no usage in their responses); Azure free tier is not modelled (errs high).
- Gemini TTS voices list is a static list of prebuilt names.
- Asset rows use `source: "import"` for TTS takes and `"upload"` for recordings (no `tts` source in the schema enum).
- `listVoiceTests` loads the last 10 runs only; no pagination.
- Uploads are read into memory (100 MB cap).

## Link pass

- package.json scripts: `"voice:test": "tsx --conditions=react-server scripts/voice-test.ts"`
- Nav link: `/voice` ("Voice" / "Röst", key `voice.nav.profiles` or a new nav key) in `Header.tsx`; optional home card.
- Mount `NarrationTakes` (`src/components/NarrationTakes.tsx`, client) with props `{ ownerKind: NarrationOwnerKind, ownerRef: string, sceneRef?: string | null, language: VoiceLanguage, speaker?: string | null, text?: string, pronunciationScope?: string | null, locale?: Locale }` — e.g. /stories scene editor (`ownerKind "story_scene"`, `ownerRef "story:<slug>"`, `sceneRef "S01"`, `pronunciationScope "story:<slug>"`), studio script page (`"script"`, `"script:<id>"`).
- `NarrateButton` (`src/components/NarrateButton.tsx`): `{ ownerKind, ownerRef, sceneRef?, language, speaker?, text, pronunciationScope?, defaultVoiceProfileId?, locale?, onDone?(narrationId) }`.
- Phase B/C: import `narrate`, `importRecording`, `selectTake`, `reviewTake` from `@/lib/voice`; `listTakes` from `@/lib/voice/store` for selected takes.
- KNOWN-ISSUES/README: point to docs/VOICE.md; `.env.example` could add `ELEVENLABS_USD_PER_1K_CHARS` and `VOICE_FAKE`.

## Verification

- `npm run typecheck`: pass · `npm run lint`: pass · `npm test`: 403/403 pass · `npm run test:db`: 271/271 pass (local Postgres `content_engine_a`, ffmpeg present, no keys). `npm run build` not run (per instructions).
