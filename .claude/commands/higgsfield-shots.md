---
description: Generate a script's b-roll and thumbnails with the Higgsfield MCP and save them to media/<script-id>/ with a manifest.
argument-hint: <script id | pasted shot list>
---

# /higgsfield-shots — render a script's shot list

Input: `$ARGUMENTS` — either a script id, or a pasted shot list (the studio's
"Shot list → Copy", or `GET /api/scripts/<id>/export?format=shots`).

You are a Claude Code session with the Higgsfield MCP connected. The app never
calls Higgsfield and holds no Higgsfield key (PLAN.md §1.34); this command is
the whole hand-off. Follow the steps in order.

## 1. Get the shot list

- **Pasted:** use the fenced ` ```json ` block at the end of the paste. It is
  a `ShotList`: `{ scriptId, title, mediaDir, shots[], thumbnails[] }` (see
  `src/lib/scripts/export.ts`).
- **Script id:** fetch
  `http://localhost:3000/api/scripts/<id>/export?format=shots&as=json`. It
  needs a signed-in session cookie; if you have none, ask Anton to paste the
  shot list from `/studio/<id>` instead. Do not try to sign in.

Each shot has `number`, `section`, `spokenLine`, `description`,
`imagePrompt`, `videoPrompt` (null = a still), `aspectRatio`, and
`files.image` / `files.video` — the exact paths to save to. Each thumbnail has
`imagePrompt`, `aspectRatio` (16:9) and `file`.

## 2. Resume, don't redo

Read `media/<scriptId>/manifest.json` if it exists. Skip every shot whose
files it already lists and that exist on disk. Never regenerate a finished
shot unless Anton names it.

## 3. Choose models — recommend first, cheapest that fits

- Before the **first** generation of this run, call Higgsfield's
  `models_explore` with `action: "recommend"`, once for images (photoreal
  b-roll stills, the aspect ratios in the list) and once for image-to-video
  (short, subtle camera motion from a still). Use its answer; do not pick a
  model from memory.
- Use the **cheapest model that fits** the shot. Premium models only when
  the shot cannot work without them (legible text, faces), and say why.
- Estimate the run: (images + thumbnails) × image cost + videos × video
  cost. Check `balance`. If the estimate is more than the credits left, or a
  step would spend more than that estimate, **stop and ask Anton** with the
  numbers before generating anything more.

## 4. Generate — images first, then video

1. **Stills.** For every pending shot and thumbnail, one image from
   `imagePrompt` at its `aspectRatio`. Shots are independent, so **batch**
   them (`generate_image_batch`), then wait with `jobs_wait` — do not poll
   job by job.
2. **Motion.** Only for shots whose `videoPrompt` is not null: image-to-video
   from that shot's finished still, with `videoPrompt`. Again one batch
   (`generate_video_batch`) and `jobs_wait`.
3. A failed job: retry it once with the same model; if it fails again, record
   the error in the manifest and move on.

Do not add text overlays to thumbnails — `textOverlay` is set in the editor
later. Do not invent shots that are not in the list.

## 5. Save to `media/<script-id>/` with a manifest

Download each result to the exact path in `files.image`, `files.video` or
`file` (relative to the repo root; create the folder). Then write
`media/<scriptId>/manifest.json`:

```json
{
  "scriptId": 12,
  "title": "…",
  "generatedAt": "2026-09-26T10:00:00Z",
  "shots": [
    {
      "number": 1,
      "kind": "image",
      "file": "media/12/01-calendar-pages-flipping.png",
      "url": "https://…higgsfield result URL…",
      "prompt": "Paper calendar mid-flip",
      "model": "…",
      "jobId": "…",
      "status": "done"
    }
  ],
  "thumbnails": [
    { "number": 1, "file": "media/12/thumb-1-….png", "url": "…", "prompt": "…", "model": "…", "status": "done" }
  ],
  "credits": { "estimated": 0, "spent": 0 }
}
```

One entry per file: a shot with motion has an `image` entry and a `video`
entry (the video's `prompt` is the `videoPrompt`). `status` is `done` or
`failed` (with an `error`). Merge into an existing manifest; never drop
entries from an earlier run.

## Progress lines (always print them)

content-engine starts this command headless (the `/higgsfield` page, build 4
§1.14) and reads these lines from the output; they cost nothing when you run
it by hand. Print each **alone on its own line**, as it happens:

- `HF_BALANCE before <credits>` — after checking `balance`, before generating
- `HF_JOB <higgsfield job id>` — for every job submitted (so a re-run never resubmits)
- `HF_FILE <path relative to MEDIA_ROOT>` — for every media file saved (not the manifest)
- `HF_BALANCE after <credits>` — at the end
- `HF_CREDITS <credits spent in this run>` — at the end

Download with `node "<repository>/scripts/media-download.mjs" "<MEDIA_ROOT>" "<relative path>" "<url>"`
(forward slashes; a headless run allows no other shell command). When the
prompt carries **Run rules** from content-engine, they win: their credit
ceiling is hard, nobody can answer a question (stop and report instead of
asking), and the app runs the media scan itself.

## 6. Report

End with: files written, shots skipped as already done, failures, credits
estimated vs spent, and the manifest path. `media/` holds large binaries —
do not commit it.


For headless runs, use the exact staged downloader command in the Run rules. It validates and atomically promotes complete bytes, refuses overwrites, and leaves interrupted staging hidden from scans. Never download directly to a final filename.
