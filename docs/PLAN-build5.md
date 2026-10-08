# PLAN — content-engine build 5: voice production

Build 4 (`docs/PLAN-build4.md`) put voice, stories and video into content-engine.
Build 5 makes voice production practical: Higgsfield's TTS engines on Anton's
existing credits, a recording studio for a narrator's 5 hours of Spanish and
Guaraní, a training-dataset export from those recordings, Chatterbox (free
voice cloning on the PC or a few cents on Replicate), and the open build 4
known issues on rendering.

Every build 4 decision (§1 there) still holds: approved text only, Guaraní is
recorded by people, consent before cloning, every take kept, never
time-stretch, PC-only features refuse online (`APP_MODE=online`).

## §1. Decisions

1. **Higgsfield voice goes through the bridge.** The app holds no Higgsfield key.
   A voice job (`higgsfield_jobs.kind = voice`) carries a line manifest; the
   `/higgsfield-voice` command preflights every line with `get_cost`, stays under
   the job's credit ceiling, generates with `generate_audio_batch`, downloads the
   files and prints `HF_*` lines. The app then turns each file into a take
   (WAV master + MP3, measured duration, `provider = higgsfield`,
   `narrations.cost_credits`, `narrations.higgsfield_job_id`, the Higgsfield job id
   in `narrations.external_ref`).
2. **`narrate()` stays synchronous.** For a Higgsfield profile it refuses with
   `queued_provider`; callers queue a batch instead (one line, a scene, a whole
   book/language or a script).
3. **Measured prices (get_cost, 2026-10-07, ~950 characters ≈ 1 min of Spanish):**
   `text2speech_v2` variant `elevenlabs` 2.7 credits, `minimax` 2.7,
   `elevenlabs_v4` 4.14, `seed_audio` 5.9, `qwen_audio_tts` 0.38 (no Spanish in
   its language list). Estimates scale by characters; the command's `get_cost`
   is the truth. `elevenlabs_v4`'s `dialogue` is `[{text, voice_type, voice_id}]`.
4. **Cloned voices** (`voice_type = element`, Chatterbox reference samples) are
   people: the profile's consent must be `signed`, as in build 4 §1.5.
5. **The recording studio records in the browser** (MediaRecorder) and saves each
   line through `importRecording()` with its exact text, so a recording session
   produces normal manual takes — usable as narration at once and as training
   data later.
6. **Datasets are exported, never uploaded.** `npm run voice:dataset` writes an
   LJSpeech/Piper folder under `MEDIA_ROOT/voice/_datasets/`; nothing leaves the PC.
7. **Chatterbox** has two modes per profile: `local` (a small Python server in
   `tools/chatterbox-server/`, CPU) and `replicate` (`REPLICATE_API_TOKEN`).
   Live paths are UNVERIFIED until Anton runs them.
8. Build models: Opus subagents at low/medium effort. Never Fable.

## §2. Foundation (merged before the phases)

- Contract: providers `higgsfield`, `chatterbox`; `VoiceSettings.higgsfield`
  (`model`, `variant`, `voiceType`, `voiceId`) and `VoiceSettings.chatterbox`
  (`mode`, `referencePath`, `exaggeration`, `cfgWeight`, `languageId`); refusal
  reason `queued_provider`.
- Schema (migration 0012): `narrations.cost_credits`, `narrations.higgsfield_job_id`,
  `narrations.external_ref`; Higgsfield job kind `voice`.
- `scanMediaRoot({ folder })` scans one folder.
- Provider registry: `higgsfield` refuses with `queued_provider`;
  `providers/chatterbox.ts` is a stub for phase D.
- Settings: `CHATTERBOX_URL`, `REPLICATE_API_TOKEN`; empty i18n dicts `hfVoice`,
  `record`, `dataset`, `chatterbox`.

## §3. Phases

| Id | Phase | Effort | Owns |
|---|---|---|---|
| A | Higgsfield voice | medium | `src/lib/higgsfield/voice.ts` (new), `src/lib/higgsfield/run.ts` (voice prompt + finalize hook only), `src/lib/voice/higgsfield-takes.ts` (new), `src/lib/higgsfield-voice.actions.ts` (new), `src/components/HiggsfieldVoice*.tsx` (new), `src/components/VoiceProfileForm.tsx` (Higgsfield fields), `.claude/commands/higgsfield-voice.md` (new), `src/lib/i18n/dict/hfVoice.ts`, `docs/HIGGSFIELD.md` (voice section) |
| B | Recording studio | medium | `src/app/voice/record/**`, `src/components/Recorder*.tsx`, `src/lib/voice/record/**`, `src/lib/record.actions.ts`, `src/lib/i18n/dict/record.ts`, `docs/RECORDING.md` |
| C | Dataset export | low | `src/lib/voice/dataset/**`, `src/app/voice/dataset/**`, `src/components/Dataset*.tsx`, `src/lib/dataset.actions.ts`, `scripts/voice-dataset.ts`, `src/lib/i18n/dict/dataset.ts`, `docs/DATASET.md` |
| D | Chatterbox provider | medium | `src/lib/voice/providers/chatterbox.ts`, `tools/chatterbox-server/**`, `src/app/api/voice/reference/**`, `src/components/ChatterboxReference*.tsx`, `src/lib/i18n/dict/chatterbox.ts`, `docs/CHATTERBOX.md` |
| E | Render known issues | low | `src/lib/stories/studio.ts` (renderStory only), `src/lib/stories.actions.ts` (render action), `src/app/stories/[slug]/page.tsx` (render section), `src/components/RenderButton.tsx`, `src/lib/video.actions.ts`, `src/lib/media/music.ts` (new), `src/lib/i18n/dict/{stories,videoRender}.ts` |
| L | Link pass (orchestrator) | — | nav, `package.json` scripts, mounts, `docs/VOICE.md`, KNOWN-ISSUES, README |

Tests: unit next to code, integration as `tests/integration/b5-<id>-*.test.ts`.

## §4. Human inputs (Anton)

1. Create cloned voices in Higgsfield (Create Voice) from a consented sample and
   paste the element id into the voice profile.
2. Record with the studio: Spanish and Guaraní narrators, quiet room, same mic.
3. For Chatterbox local: install Python 3.11 and run `tools/chatterbox-server`
   (docs/CHATTERBOX.md); or set a Replicate token.

## §5. Build log index

| Phase | Log | State |
|---|---|---|
| Foundation | — | merged |
| A Higgsfield voice | `docs/log/b5-a.md` | merged |
| B Recording studio | `docs/log/b5-b.md` | merged |
| C Dataset export | `docs/log/b5-c.md` | merged |
| D Chatterbox provider | `docs/log/b5-d.md` | merged |
| E Render known issues | `docs/log/b5-e.md` | merged |
| L Link pass | — | merged: profile settings kept on save (Higgsfield/Chatterbox, reference sample survives edits), Chatterbox form fields + reference panel, Higgsfield batch/line buttons on stories, scripts and take lists, voice job links, recording studio and dataset links, music list on the script page, docs |
