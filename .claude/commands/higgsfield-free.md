---
description: Make images or videos from a free description with the Higgsfield MCP and save them to MEDIA_ROOT/_inbox/higgsfield/<date>/ with a manifest.
argument-hint: <free prompt from /higgsfield | a plain description>
---

# /higgsfield-free — make what the description asks for

Input: `$ARGUMENTS` — the "Free prompt" content-engine sends from
`/higgsfield` (a short Markdown block ending in a fenced ` ```json ` block:
`{ brandId, brandName, folder, request, kit }`), or a plain description typed
by hand.

**Run this in Claude Code on Anton's PC** (PLAN.md §1.45, build 4 §1.14),
with the Higgsfield MCP connected. It writes into `MEDIA_ROOT` — the external
media drive (e.g. `E:\ContentEngine`) — which a cloud session cannot reach. If
`MEDIA_ROOT` is not set in `.env` or the folder does not exist, stop and say
"media drive not connected" before spending anything. The app never calls
Higgsfield and holds no Higgsfield key (§1.34).

## 1. Read the request

- From content-engine: use the JSON block. `folder` is relative to
  `MEDIA_ROOT` (`_inbox/higgsfield/<YYYY-MM-DD>`); `brandId` may be null.
- Typed by hand: the whole input is the request; the folder is
  `_inbox/higgsfield/<today, YYYY-MM-DD>`; no brand.

Work out the list of outputs: how many images and/or videos, their aspect
ratios (default 4:5 for images, 9:16 for video) and one prompt each. Do not
make more than the request asks for. When `kit` is given, use its
`higgsfieldElementIds` / `higgsfieldCharacterIds` as references where the
model supports them and append its `styleNotes` to each prompt.

## 2. Choose models — recommend first, cheapest that fits

Before the first generation, call `models_explore` with
`action: "recommend"` (images, and image-to-video if any video is asked for).
Use the **cheapest model that fits**; premium only when the request cannot
work without it (legible text, faces, a kit character), and say why. Estimate
the run and check `balance`. If the estimate is above the credits left — or,
when run by content-engine, above the run's ceiling — stop and say so with
the numbers.

## 3. Generate — batch, then wait

All stills as **one** `generate_image_batch`, then `jobs_wait`; videos (from
their still, if any) as one `generate_video_batch`, then `jobs_wait`. A failed
job: retry once with the same model, then record the error and move on.

## 4. Save into the inbox folder with a manifest

Name each file `<slug of the first ~6 prompt words>-<first 8 chars of the job
id>.<ext>` (lower-case `a-z0-9-`; `-2`, `-3` for more outputs of one job) in
`<MEDIA_ROOT>/<folder>/`. Then write or merge
`<MEDIA_ROOT>/<folder>/manifest.json` (the format `scanMediaRoot()` reads):

```json
{
  "source": "higgsfield",
  "brandId": "guide",
  "generatedAt": "2026-10-07T10:00:00Z",
  "files": [
    {
      "file": "asuncion-skyline-at-dusk-warm-3f9a1c2b.png",
      "url": "https://…",
      "jobId": "3f9a1c2b-…",
      "prompt": "…the prompt actually sent…",
      "model": "…",
      "status": "done"
    }
  ]
}
```

Leave `brandId` out when there is none (the files stay unsorted in
`/media/inbox`). Merge; never drop entries from an earlier run.

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

## 5. Report

Unless the run rules say the app scans, run `npm run media:scan` (or press
**Scan now** on `/media`). End with: files written, failures, credits
estimated vs spent, and the folder. `MEDIA_ROOT` holds large binaries — never
copy them into the repo or commit them.


For headless runs, use the exact staged downloader command in the Run rules. It validates and atomically promotes complete bytes, refuses overwrites, and leaves interrupted staging hidden from scans. Never download directly to a final filename.
