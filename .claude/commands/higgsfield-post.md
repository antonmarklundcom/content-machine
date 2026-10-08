---
description: Generate a post's visuals with the Higgsfield MCP and save them into the post's folder under MEDIA_ROOT with a manifest.
argument-hint: <post id | pasted generation brief>
---

# /higgsfield-post — render a post's generation brief

Input: `$ARGUMENTS` — either a post id, or a pasted generation brief (the
post's "Brief → Copy", or `GET /api/posts/<id>/export?format=brief`).

**Run this in Claude Code on Anton's PC** (PLAN.md §1.45), with the
Higgsfield MCP connected. It writes into `MEDIA_ROOT` — the external media
drive (e.g. `E:\ContentEngine`) — which a cloud session cannot reach. If
`MEDIA_ROOT` is not set in `.env` or the folder does not exist, stop and say
"media drive not connected" before spending anything.

The app never calls Higgsfield and holds no Higgsfield key (§1.34); this
command is the whole hand-off. Same conventions as `/higgsfield-shots`
(build 2), extended from scripts to posts. Follow the steps in order.

## 1. Get the brief

- **Pasted:** use the fenced ` ```json ` block at the end of the paste. It is
  a `PostBrief` (`src/lib/posts/export.ts`):
  `{ postId, brandId, handle, platform, format, language, title, folder, kit, visuals[] }`.
- **Post id:** fetch
  `http://localhost:3000/api/posts/<id>/export?format=brief&as=json`. It needs
  a signed-in session cookie; if you have none, ask Anton to paste the brief
  from the post page instead. Do not try to sign in.

Each visual has `n`, `kind` (`slide` | `shot` | `story_frame`), `role`,
`label`, `prompt`, `aspectRatio`, `targetFile`, and for a reel/video shot
`videoPrompt` + `targetVideoFile`. **`targetFile` and `targetVideoFile` are
relative to `MEDIA_ROOT`** — the post's folder in the §1.41 layout
`<brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>/NN-<slug>.<ext>`. Never
invent another path.

`kit` (may be null) carries the brand's `higgsfieldElementIds`,
`higgsfieldCharacterIds`, `styleNotes` and `colors`. Use the element and
character ids as references on every generation that supports them, and
append `styleNotes` to each prompt. Do not render `textOverlay` into the image
unless the visual is a cover and the prompt asks for text — overlays are set
in the editor later.

## 2. Resume, don't redo

Read `<MEDIA_ROOT>/<folder>/manifest.json` if it exists. Skip every visual
whose file it lists with `status: "done"` and that exists on disk. Retry the
`failed` ones. Never regenerate a finished visual unless Anton names it.

## 3. Choose models — recommend first, cheapest that fits

- Before the **first** generation of this run, call Higgsfield's
  `models_explore` with `action: "recommend"`: once for images (the brief's
  aspect ratios; mention legible text if a cover needs it) and, when any
  visual has a `videoPrompt`, once for image-to-video. Use its answer; never
  pick a model from memory.
- Use the **cheapest model that fits**. Premium only when the visual cannot
  work without it (legible text, faces, a kit character), and say why.
- Estimate the run: stills × image cost + clips × video cost. Check
  `balance`. If the estimate is more than the credits left, or a step would
  spend more than that estimate, **stop and ask Anton** with the numbers.

## 4. Generate — batch, then wait

1. **Stills.** One image per pending visual from `prompt` at its
   `aspectRatio`, as **one** `generate_image_batch`, then `jobs_wait`. Do not
   poll job by job.
2. **Motion.** Only visuals with a `videoPrompt`: image-to-video from that
   visual's finished still, as one `generate_video_batch`, then `jobs_wait`.
3. A failed job: retry once with the same model; if it fails again, record
   the error in the manifest and move on.

## 5. Save into the post's folder with a manifest

Download each result to `<MEDIA_ROOT>/<targetFile>` (and
`<targetVideoFile>`), creating the folder. Then write
`<MEDIA_ROOT>/<folder>/manifest.json` — the format `scanMediaRoot()` reads
(`src/lib/media/manifest.ts`):

```json
{
  "postId": 41,
  "brandId": "guide",
  "handle": "guide_en",
  "source": "higgsfield",
  "tags": ["post-41"],
  "generatedAt": "2026-09-27T10:00:00Z",
  "files": [
    {
      "n": 1,
      "file": "guide/guide-en/2026-10/41-cedula-in-45-days/01-cedula-in-45-days.png",
      "url": "https://…higgsfield result URL…",
      "prompt": "…the prompt actually sent…",
      "model": "…",
      "jobId": "…",
      "altText": "…the visual's label…",
      "status": "done"
    }
  ],
  "credits": { "estimated": 0, "spent": 0 }
}
```

`file` is relative to `MEDIA_ROOT`. One entry per file: a shot with motion
has the still and the clip (the clip's `prompt` is the `videoPrompt`).
`status` is `done` or `failed` (with an `error`). Merge into an existing
manifest; never drop entries from an earlier run. Put `accountId` at the top
too if you know it (the brief does not carry it).

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

## 6. Register and report

Unless the run rules say the app scans, run `npm run media:scan` (or ask
Anton to press **Scan now** on `/media`):
it registers every `done` entry as an asset for the brand, deduped by sha256,
so re-running is safe. End with: files written, visuals skipped as already
done, failures, credits estimated vs spent, the manifest path. `MEDIA_ROOT`
holds large binaries — never copy them into the repo or commit them.


For headless runs, use the exact staged downloader command in the Run rules. It validates and atomically promotes complete bytes, refuses overwrites, and leaves interrupted staging hidden from scans. Never download directly to a final filename.
