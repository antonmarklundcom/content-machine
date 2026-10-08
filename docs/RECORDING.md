# Recording studio (build 5 §3.B)

`/voice/record` turns a narrator's reading session into ordinary voice takes.
A native speaker reads a cuentos story (Spanish or Guaraní) or a studio script
line by line from a teleprompter; every kept take goes through
`importRecording()` with the line's **exact approved text**, so it is at once a
narration take (stories studio, script video) and, once approved, training data
for the dataset export (phase C). Owner-only, PC-only (refuses on
`APP_MODE=online`). Code: `src/lib/voice/record/`, `src/components/Recorder*.tsx`.

## Before the session

1. **Speaker profile** on `/voice`: provider `manual`, the languages the person
   reads (`es-PY`, `gn`, …), consent status `signed` with the signed document if
   the recordings may ever train or clone a voice (PLAN-build4 §1.5). The studio
   lists active `manual` profiles and any profile with a person's consent on
   record; a profile whose consent is pending, revoked or expired, or that does
   not list the language, is shown with `importRecording`'s refusal and cannot
   keep takes.
2. **Text approved.** Story lines are recordable only when the scene's text in
   that language is approved (repo status or "Mark text approved here" on
   `/stories`) and carries no review notice. Guaraní needs approved Guaraní
   text too; a missing language stays missing. Locked lines are listed with the
   reason (missing text, no status, not approved, review notice). Script blocks
   are locked only by a review notice (`PENDIENTE`, `REVISAR`, `TODO`, `[??]`).
3. **Room and gear**: quiet room with soft surfaces, phone silent, no fans.
   One USB/XLR microphone for the whole project, same distance (15–20 cm, a bit
   off-axis), same gain. Headphones for playback. Chrome or Edge on the PC.

## Running a session

1. Open `/voice/record`, pick **What to read** (`<story> — es`, `<story> — gn`
   or a studio script) and the **Speaker**, then **Open session**. The URL
   (`?source=story:<slug>:<lang>&profile=<id>`) can be bookmarked per narrator.
2. **Turn on microphone**, pick the device. The meter shows −60…0 dBFS; aim for
   speech peaks in the shaded −18…−6 zone, never red. Browser processing (echo
   cancellation, noise suppression, auto gain) is switched off: the master must
   be the raw voice.
3. The session resumes at the **first line without a take by this speaker in
   this language** (a take of an older text does not count). Progress shows
   recorded/total lines, minutes so far and how many lines are locked.
4. Read, listen, keep:

| Key | Action |
|---|---|
| Space | Record / stop (with the optional 3-2-1 count-in); during review, record again |
| Enter | Keep & next — uploads the take, then moves to the next recordable line |
| R | Redo — discard the take and record again |
| ← / → | Previous / next recordable line (an unkept take is discarded) |

The full line list (collapsed under the recorder) jumps to any line, locked
ones included, to see why they are locked.

After each take the studio shows playback and checks the take (pure helpers in
`src/lib/voice/record/analyze.ts`): **clipping**, **very quiet**, **silent**,
**first/last word may be cut** (< 120 ms of silence at an edge), **long silence**
(> 2 s) before or after, and **much shorter / longer than the text suggests**
(≈ 13 letters per second). Warnings never block Keep; the narrator decides.

**Use the take when the line has none selected** (on by default) selects the
kept take when the slot has no selected take of the current text yet — the
story scene's audio is then rebuilt like a selection on `/stories`. Later
keeps never steal an existing selection; choose between takes on `/stories` or
`/studio/<id>/voice`.

## Quality checklist

- Same mic, distance, gain, room and time of day across sessions; note changes.
- Peaks −12…−6 dBFS, no clipping warnings; re-record any clipped take.
- A breath of silence (≈ 0.3–1 s) before and after every line; no cut words.
- Read the text exactly as written: voseo stays voseo, Guaraní as reviewed. If
  the text is wrong, stop and fix it in the repo (or approve the corrected text
  on `/stories`) — never read a different wording, the take is saved with the
  written text.
- Breaks every 20 minutes (the tips panel has a timer); water at hand.
- Listen back to the first takes of each session on headphones.

## Where the takes go

- **Story line** → `narrations` row: `owner_kind = story_scene`,
  `owner_ref = story:<slug>`, `scene_ref` = the stories studio's slot (`S03` for
  a one-line scene, `S03#2` for the second line of several), `speaker` = the
  line's character key (null = narrator), language `es-PY` / `gn` / `jopara`,
  provider `manual`, `voice_profile_id` = the speaker. It appears on
  `/stories/<slug>` under that line.
- **Script block** → `owner_kind = script`, `owner_ref = script:<id>`,
  `scene_ref = hook | s01… | cta`, language = the script's; it appears on
  `/studio/<id>/voice` and renders with the script video.
- Files: WAV 48 kHz mono master + MP3 under
  `MEDIA_ROOT/voice/<owner-kind>/<owner-ref>/<slot>/<language>/take-<id>.*`.
- **Dataset export** (phase C, `npm run voice:dataset`) reads approved manual
  takes — approve the good ones on `/stories` or the script's voice page. The
  tips panel shows minutes kept per language and speaker (rejected takes are
  not counted).

## Upload route

`POST /voice/record/upload` (multipart, owner-only): `file`, `source`
(`story:<slug>:<lang>` | `script:<id>`), `slot`, `voiceProfileId`, `text` (what
the narrator saw), `autoSelect` (`1`). The line is rebuilt on the server from
the database and refused when locked (422 `locked`), when its text changed
since the page loaded (422 `text_changed`), or by `importRecording` (422
`consent_missing` / `language_not_supported`); unknown line 404. Success: 201
`{ narrationId, durationMs, selected, notes }`.
