# b5-b — Recording studio

## Built

- `/voice/record` (owner-only, PC-only): GET setup form — source (story × language, or studio script) + speaker profile (active `manual`, or any profile with a person's consent) — then the session; bookmarkable `?source=story:<slug>:<lang>&profile=<id>`.
- `src/lib/voice/record/lines.ts` (pure): `buildStoryLines` (stories rules `canNarrate`/`narrationLines`/`lineSlot`; locked lines keep a reason + message, Guaraní needs approved Guaraní text), `buildScriptLines` (`scriptBlocks` refs hook/s01…/cta; review notice locks), source keys, voice-language mapping.
- `resume.ts` (pure): what a profile has recorded per line (manual, done, current text, not rejected), resume at first unrecorded unlocked line, progress (recorded/total/locked/ms), line stepping.
- `analyze.ts` (pure): peak/RMS, clipping, quiet/silent, leading/trailing silence (start/end cut, long lead/tail), too short/long vs text (13 letters/s), meter scale, mixdown, MediaRecorder mime pick.
- `session.ts`: sources, speaker profiles, up-front `importRecording` refusal (`profileRefusal`), `resolveSource`, `loadRecordSession`, `recordingMinutes` (per language × profile).
- `save.ts` + route `POST /voice/record/upload`: rebuilds the line server-side, refuses locked / changed text, `importRecording` with the studio conventions, optional auto-select (story: `selectSceneTake`, which rebuilds scene audio; script: `selectTake`).
- `src/lib/record.actions.ts`: `recordSessionAction`, `recordingMinutesAction`.
- `RecorderStudio` (teleprompter, next line dimmed, device picker, raw-voice getUserMedia, AnalyserNode meter, 3-2-1 count-in, playback + warnings, Keep/Redo, keys Space/Enter/R/←/→, line list), `RecorderMeter`, `RecorderTips` (tips, 20-min break timer, minutes table refreshed after each keep).
- Dict `record.*` (en + sv); `docs/RECORDING.md`.
- Tests: `lines.test.ts`, `resume.test.ts`, `analyze.test.ts` (16) and `tests/integration/b5-b-record.test.ts` (3: WAV → manual take with exact text on `S02#1`, refusals, script block).

## Decisions

- Own route `src/app/voice/record/upload/route.ts` instead of `/api/stories/upload`: one route for stories and scripts, server-side line rebuild, optional auto-select, the voice error shape (`{error, reason}`).
- The text saved is always the server's line text; the browser's `text` is only compared (line breaks compared loosely: multipart turns LF into CRLF).
- A speaker profile is required (resume and minutes are per profile); unnamed recordings stay on the existing upload panels.
- Recorded = this profile's manual take of the current text; a later keep never steals an existing selection.
- Arrow keys and Enter skip locked lines; the line list reaches locked ones to show why.
- Script blocks have no approval status; only review notices lock them.
- getUserMedia with echo cancellation / noise suppression / AGC off (raw master for datasets).

## Known issues

- MediaRecorder/AnalyserNode UI is not covered by automated tests (no browser in CI); analysis helpers and the upload path are.
- Takes are uploaded synchronously on Keep (the narrator waits ~1 s per line for ffmpeg normalisation).
- Too short/long uses a fixed 13 letters/s; slow bedtime reading of very short lines may still warn.
- Break timer and the count-in setting reset on page reload.

## Link pass

- `src/components/VoiceSubnav.tsx`: add `{ href: "/voice/record", key: "record.title" }` to `LINKS` (the page already passes `current="/voice/record"`).
- Optional: a "Record this book" link on `/stories/<slug>` → `/voice/record?source=story:<slug>:<lang>`, and on `/studio/<id>/voice` → `?source=script:<id>`.
- New route outside `/api`: `POST /voice/record/upload` (`src/app/voice/record/upload/route.ts`) — gated by the same middleware as `/api` routes; nothing to change, listed for the route inventory.
- `docs/VOICE.md`/README: point to `docs/RECORDING.md`.
- Phase C: approved manual takes from this studio carry `voice_profile_id`, exact `input_text`, slot and language.

## Verification

- `npm run typecheck` ✓, `npm run lint` ✓, `npm test` ✓ (616 pass), `npm run test:db` ✓ (343 pass, 0 skipped; ffmpeg present; DB `content_engine_b5b`). `npm run build` not run (per instructions).
