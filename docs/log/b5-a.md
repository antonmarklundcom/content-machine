# B5-A — Higgsfield voice (TTS through the Claude Code bridge)

Worktree branch from f515bfc (build 5 foundation). Opus 5.5, medium.

## Built
- `src/lib/higgsfield/voice.ts` (pure): measured prices + character-scaled estimates (unmeasured engines priced high), engine/language rules (never `gn`, qwen has no Spanish), profile settings check, `outFile` naming (`take-<id>.hf.mp3|wav`), the line manifest (fenced JSON), the voice run prompt, `HF_JOB <lineId> <jobId>` / `HF_FAIL` / `HF_FILE` / `HF_CREDITS` parsing (one-token `HF_JOB` still read) and credit split by characters.
- `run.ts`: kind `voice` builds its own prompt (manifest with job ref + ceiling, run rules, ceiling sentence); a `VoiceMarkerCollector` reads the line-id form (job ids in the row are the real Higgsfield ids); a finalize hook runs before the media scan on every end (done/failed/cancelled) and for reaped voice runs.
- `src/lib/voice/higgsfield-takes.ts`: `planHiggsfieldVoice` (narrate()'s refusals via `assertCanSynthesize`, Higgsfield-only profiles, element needs signed consent, engine speaks the language, ≤ 10,000 chars, not already queued; pronunciations applied; estimate) → `queueHiggsfieldVoice` (ceiling refusal before any write, pending rows in one transaction, `startJob`, `higgsfield_job_id` set; rows deleted if the start throws).
- `finalizeHiggsfieldVoiceJob`: manifest from the stored prompt; file = outFile / reported / `take-<id>.hf.*` → WAV 48 kHz mono + MP3 (voice audio helpers), measured, both registered, row `done` with `cost_credits`, `external_ref`, or `failed` with the HF_FAIL reason / "no file"; selects where nothing usable is selected (story slots via readiness) and rebuilds story scene audio once per scene (`buildSceneAudio`). Only `pending` rows are touched → idempotent.
- Batch builders: `storyVoiceLines` (approved lines lacking a usable take, narrator + character Higgsfield profiles by characterKey, gn refused) and `scriptVoiceLines` (every block).
- `src/lib/higgsfield-voice.actions.ts`: `queueVoiceAction`, `queueStoryVoiceAction`, `queueScriptVoiceAction`, previews for each, `higgsfieldVoiceProfilesAction`, `saveVoiceProfileWithHiggsfieldAction` (owner-only).
- Components: `HiggsfieldVoiceBatchButton`, `HiggsfieldVoiceLineButton`, `HiggsfieldVoiceStatus` (polls `/api/higgsfield/jobs/[id]`); `VoiceProfileForm` Higgsfield fieldset (engine, variant, voice type, price hint, element → consent pending).
- `.claude/commands/higgsfield-voice.md`; `docs/HIGGSFIELD.md` "Voice (build 5)"; dict `hfVoice.*` (en + sv).
- Tests: `src/lib/higgsfield/voice.test.ts` (8) and `tests/integration/b5-a-voice.test.ts` (5, fake CLI `tests/integration/b5-a-fake-claude.mjs` writes WAVs at each outFile).

## Decisions
- Pure manifest/parsing lives in `higgsfield/voice.ts`; DB work in `voice/higgsfield-takes.ts`. run.ts loads the finalize hook with a dynamic import (that module starts jobs through run.ts).
- Finalize finds lines from the manifest in `higgsfield_jobs.prompt` (plus `higgsfield_job_id`), so a run that ends before `higgsfield_job_id` is written still finalizes.
- The raw `.hf.*` download is deleted once the WAV master and MP3 are registered (one copy per take; the scan never sees it).
- Credits: `HF_CREDITS`, else the row's balance delta, split by spoken characters over lines that made a take; failed lines get none.
- `VoiceProfileForm` now posts to `saveVoiceProfileWithHiggsfieldAction`, which passes non-Higgsfield providers straight to `saveVoiceProfileAction` and writes `settings.higgsfield` itself (the store's `cleanSettings` drops it). An element voice with consent `not_needed` is refused.
- Story/script batches queue the lines that pass and list the refused ones; a single line refuses outright. Busy targets: `voice:story:<slug>:<lang>`, `voice:script:<id>`, `voice:<ownerRef>#<scene>:<lang>`.
- The batch button's target prop is `targetRef` (not `ref`, which React reserves).

## Known issues
- **Live run UNVERIFIED**: no Claude login or Higgsfield MCP here. Unverified: the exact `generate_audio_batch` param shapes per engine, `get_cost` on audio, result URL fields, the downloaded format per engine (the finalize accepts any `take-<id>.hf.*`).
- Estimates use 2026-10-07 prices; unmeasured variants (`seed_speech`, `vibe_voice`, `cozy_voice`, `elevenlabs_v4_turbo`) are estimated high. No per-generation minimum charge is modelled.
- The store's `cleanSettings` drops `settings.higgsfield` on any other save path (only the form wrapper re-adds it) — see Link pass.
- Retry on `/higgsfield` refuses voice jobs (brief.ts has no voice brief); queue again from the page instead (already-done lines are skipped by the story batch, not by the script batch).
- Without ffmpeg only a WAV download can become a take.

## Link pass
- `src/lib/voice/store.ts` `cleanSettings`: keep `higgsfield` (validate with `resolveHiggsfieldSettings` from `@/lib/higgsfield/voice`) so other save paths do not drop it; then `saveVoiceProfileWithHiggsfieldAction` can be simplified.
- `src/lib/higgsfield/config.ts` `targetHref`: map `voice:story:<slug>:<lang>` → `/stories/<slug>?lang=<lang>` and `voice:script:<id>` → `/studio/<id>/voice` for the /higgsfield runs list.
- Mount `<HiggsfieldVoiceBatchButton kind="story" targetRef={story.slug} language={lang} profiles={await listHiggsfieldProfiles()} defaultMaxCredits={defaultMaxCredits()} locale={locale} />` on `/stories/[slug]` (owner only, not for `gn`); `listHiggsfieldProfiles` from `@/lib/voice/higgsfield-takes`, `defaultMaxCredits` from `@/lib/higgsfield/config`.
- Mount `<HiggsfieldVoiceBatchButton kind="script" targetRef={row.id} language={row.language} profiles={…} defaultMaxCredits={…} />` on `/studio/[id]/voice` (owner only, next to RenderButton).
- In `NarrationTakes` (or next to `NarrateButton`): `<HiggsfieldVoiceLineButton ownerKind ownerRef sceneRef language speaker text pronunciationScope locale onDone={reload} />` (loads profiles itself; renders nothing without a Higgsfield profile).
- KNOWN-ISSUES: "Higgsfield voice live run UNVERIFIED". `docs/VOICE.md`: point to docs/HIGGSFIELD.md "Voice".
- No new `package.json` scripts or nav links.

## Verification
`npm run typecheck` and `npm run lint` clean; `npm test` 608/608; `npm run test:db` 345/345, 0 skipped (DB `content_engine_b5a`, ffmpeg present, no keys, fake CLI). `npm run build` not run (per instructions).
