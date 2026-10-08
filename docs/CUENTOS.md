# Cuentos story studio (build 4 §3.C)

`/stories` turns cuentos.com.py books into narrated, captioned videos —
scene by scene, one language at a time — without ever rewriting the books.
The cuentos repo stays the source of truth for text, art and review status
(PLAN-build4 §1.10).

## Setup

1. Set `CUENTOS_ROOT` to the cuentos repo, e.g. `C:\dev\cuentos` (Settings →
   cuentos folder, or `.env`).
2. Import: the **Import / re-import** button on `/stories`, or
   `npm run stories:import` (all books) / `npm run stories:import -- <slug>`.
   Import only reads `CUENTOS_ROOT`. It prints what changed and everything it
   did not understand; the same report sits under each book on `/stories`.
3. Voice profiles (phase A, `/voice`): an active narrator profile whose
   languages include `es-PY` (and `jopara` if needed), plus character profiles
   whose **character key** equals the speaker key in the audio scripts
   (`tito`, `meli`…). Cloned or recorded voices need signed consent first.
4. ffmpeg + ffprobe on PATH (or `FFMPEG_PATH` / `FFPROBE_PATH`).

Outputs go under `MEDIA_ROOT/stories/<slug>/` (`audio/<lang>/<scene>.wav|mp3`,
`video/<lang>/…`); takes live in `MEDIA_ROOT/voice/story_scene/…` (phase A).

## What the importer understands

The parser (`src/lib/stories/parse.ts`) is tolerant: whatever it cannot use goes
into the report — nothing is dropped silently and no text is invented.

- **`books/<slug>/story.json`** — `title` (string or `{es}`), `series`
  (string or `{name}`), `ageBand` / `age` (string, number or `{min,max}`),
  `pages` (or `scenes`/`spreads`). Each page: `id` (`S01`; a missing id gets
  `S<n>` with a warning, duplicates are skipped), `kind`/`type`
  (`page`/`cover`/`back`), `text` per language (`es`, `gn`, `en`, `jopara`;
  `es-PY`/`Guaraní`/`Jopará` spellings are normalised; `null` = not written;
  `{ text, status }` per language also works), `textStatus` (one string for
  every language or a per-language object; `status` as a fallback), `alt`,
  `artBrief`, optional `lines`. `questions`, `activity`, `coverBrief`,
  `design`, `referenceIds` are kept in the raw snapshot.
- **`art/manifest.json`** — an array (or `{entries|items|images…}`, or an object
  keyed by plan id) of `{ planId|plan|id|scene, file|path|localPath…, selected,
  status, rejected, createdAt… }`. Per scene: rejected entries never win, a
  selected one beats newer ones, otherwise the newest wins; a file that is not
  on disk falls back to the next candidate with a warning. Paths may be
  book-relative, `books/<slug>/…`, or absolute Windows paths inside the book.
  Image size is read with sharp. Entries for non-scenes (`cover`) are reported.
- **`languages/`** — `languages/<lang>.json` or `languages/<lang>/*.json`:
  a `pages`/`scenes` array of `{id, text, status}`, or an object keyed by scene
  id (`"S01": "…"` or `{text, status}`), with an optional top-level `status`.
  It fills a language story.json leaves `null`; it never overrides story.json
  (a difference is reported).
- **`audio/`** — narration scripts: arrays of `{scene|id|page, speaker|character,
  text, lang}`, or `{lang, lines|entries|script|segments}`, or scenes with
  nested `lines`. `narrator`/`narrador` = the narrator. A script is used for a
  scene only when its lines, joined, say **exactly** the scene text (letters and
  digits compared); otherwise the text is narrated as one narrator line and the
  mismatch is reported. JSON without lines (audio manifests) and other files
  are listed as not understood; existing recordings are counted, never read.

Re-import upserts by slug and scene id, removes scenes that left story.json
(their takes stay in the take history) and keeps an in-app approval only while
the repo's status and the text are unchanged.

### Checked against the real repo (2026-10-07, 105 books, 1,216 pages)

The importer was run on `antonmarklundcom/cuentos` (text-only snapshot) with a
placeholder at every image path in `ASSET-INDEX.json`:

- **Art**: each page's own `art` field (`art/originals/01.png`) is used first;
  the manifest (entries keyed by `planId` or `index`) is the fallback. 1,101 of
  1,216 pages found their art; the other 115 belong to books still
  `illustration-in-production`, and say so in the import report.
- **Scene ids**: `S01`, `S001`, `s1` and page `1` are one scene, so story.json
  (`S01`, or no id at all on 136 pages) matches audio scripts and Guaraní drafts
  (`S001`).
- **Guaraní**: `languages/gn.draft.json` (`{locale, status, pages: [{id, es, gn}]}`)
  and `audio/script.gn.tsv` fill Guaraní text with their own status
  (`unreviewed-ai-draft`, `human-review-pending`), so a native reviewer sees it in
  `/stories` — it is never narrated until approved scene by scene.
- **Narration tables**: `audio/script.<lang>.tsv` (`sceneId page text approval
  expectedFile`, quoted multi-line text) are read as per-scene text + status.
  `audio/manifest.json` (the recording tracker) is recognised and left alone.
- **Text status**: no Spanish page is approved in the repo yet (`draft-for-author`,
  `private-review`, `editorial-draft`). Approve a book's Spanish text in one click
  with **"Approve all es text in this book"** on the story page (who and when are
  recorded; scenes with a pending-review notice are skipped and listed), or
  scene by scene. Guaraní is never bulk-approved.
- `age` can be a long phrase; it is stored as free text.

## Language rules (`src/lib/stories/rules.ts`, §1.2–§1.4)

- A scene is narrated in a language only when its text exists and its status
  is `approved`, `final`, `reviewed`, `locked` or `approved-in-app`.
- Text with a pending-review notice (`PENDIENTE`, `REVISAR`, `TODO`, `TBD`,
  `[??]`, `pending review`, `[gn?]`) always refuses — the notice is never read
  aloud. Lower-case `todo`, `pendiente`, `revisar` are ordinary Spanish words.
- A missing language refuses; it is never filled from another language.
- Text is narrated verbatim: voseo stays voseo, Jopará only as reviewed. The
  voice engine applies reviewed pronunciations (scope `story:<slug>`); the
  studio never respells.
- `gn` has no TTS: Guaraní is uploaded (recorded by a person).
- **Mark text approved here** (owner) records who and when; it is refused for
  missing text or a pending notice.

## Takes, scene audio, video, export

- Narrate makes one take per line (ownerKind `story_scene`, ownerRef
  `story:<slug>`, speaker = character key or null). A one-line scene uses the
  scene id as its slot; a scene with several lines uses `S03#1`, `S03#2`… so
  each line keeps its own selected take. The first usable take is selected
  automatically; every take is kept (select/approve/reject on the page).
- A take only counts while it says the current text; a changed text shows
  "older text" and needs a new take.
- Scene audio: the selected takes in order with 250 ms gaps →
  `stories/<slug>/audio/<lang>/<scene>.wav` + `.mp3`, word timings shifted,
  durations measured with ffprobe (never estimated).
- Render (`renderVideo`, phase B): every scene in the cut needs approved text,
  usable takes, built scene audio and selected art, or the render is refused
  with the list. Art is passed as an absolute path under `CUENTOS_ROOT`; camera
  moves vary per scene; padding 900 ms for baby/preschool age bands (≤ 5 or
  baby/preescolar), 600 ms otherwise; captions are the scene text.
  **Sample** = scenes from the start up to ~45 s.
- **Export to cuentos** (on click only) copies each ready scene's WAV + MP3 to
  `books/<slug>/audio/<lang>/<scene>.wav|mp3`, the latest render's SRT/VTT next
  to them, and writes `audio/manifest.content-engine.json` (durations, take
  ids, voice profile keys, review statuses, render paths). A file that a
  previous export did not write is never overwritten (skipped and reported).

## First milestone: the Tito sample (30–45 s, es-PY, subtitles)

1. Import; open `/stories/<tito-slug>?lang=es`.
2. For each of the first scenes: check the text and badge. If the repo still
   says pending but the text has been reviewed by a Paraguayan reader, use
   **Mark text approved here**. Scenes with a notice must be fixed in the repo.
3. **Narrate** each scene (narrator + Tito's character profile), listen,
   approve/reject, re-take until happy. Scene audio builds itself.
4. Render: format 16x9, **Sample (~45 s)**. Check the MP4 and the SRT/VTT in the
   renders list. Then 9x16 for shorts.
5. **Export to cuentos** when the takes are final.

## Guaraní workflow

1. The Guaraní text is reviewed by a native speaker in the repo (or approved
   here after their review). Unreviewed AI proposals and passages with notices
   are refused; missing passages stay missing.
2. The speaker records each scene (or each line slot) and the owner uploads it
   with **Upload recording** on the `gn` tab (optionally under the speaker's
   voice profile, so consent is checked). It becomes a `manual` take.
3. Select, render and export exactly as for Spanish; the `gn` video is timed
   from the Guaraní recordings, independently of Spanish.
