# Video render + captions (build 4, phase B)

`renderVideo()` (`src/lib/video`) turns a `RenderRequest` — scenes of a still or
clip, a narration take and caption text — into an MP4 plus SRT and WebVTT
captions under `MEDIA_ROOT`, registers all three as assets and records a
`video_renders` row. Rendering is ffmpeg/ffprobe via `child_process`; no
Python, no cloud service.

## Formats

| Format | Size | Use |
|---|---|---|
| `16x9` | 1920×1080 | YouTube, story videos |
| `9x16` | 1080×1920 | Shorts, Reels, TikTok |
| `1x1` | 1080×1080 | Feed posts |

All at 30 fps, H.264 `yuv420p` (CRF 18), AAC 192 kbps 48 kHz, `+faststart`.

## Timing (§1.7)

Scene length = the take's measured duration + `padAfterMs` (default 600 ms;
bedtime stories 900+). Narration is never time-stretched, so each language
has its own runtime. Frame boundaries come from the cumulative times, so a
long video does not drift. The final file is checked with ffprobe; more than
500 ms off the timeline fails the render.

## Framing rule (§1.8)

- Background: the image scaled to cover the frame, heavily blurred, darkened.
- Foreground: the whole image fitted inside 90 % of the frame, centred —
  never cropped (4:5 art sits whole inside 16:9).
- Camera: the composite moves gently — `zoom_in`/`zoom_out` change scale by
  8 %, pans run at 5 % zoom and travel 4 % of the frame. At every moment the
  art is fully visible (the unit tests check this). Scenes without a move
  rotate `zoom_in → pan_right → zoom_out → pan_left`, never repeating the
  previous scene's move.
- Smoothness: each still is composed at 4× the frame size before `zoompan`,
  so its whole-pixel crop moves in quarter pixels (no jitter); easing is
  smoothstep.
- Video visuals are looped/trimmed to the scene length and framed the same
  way (no camera move — clips already move).

## Captions (§1.9)

- From the provider's word timings when the take has them; otherwise by
  character share across the take's duration, split at sentence ends.
- A cue is ≤ 2 lines of ≤ 42 characters, ≤ 6 s, ≥ 0.8 s (when the next cue
  leaves room), never crosses into the next scene.
- SRT (`HH:MM:SS,mmm`) and WebVTT (`HH:MM:SS.mmm`) are always written.
  Burning in (`burnCaptions: true`) is an extra: it needs an ffmpeg with
  libass (the `subtitles` filter) and fails clearly without one.

## Music bed

`musicPath` loops under the whole video at `musicDb` (default −18 dB),
ducked under the narration with `sidechaincompress`, faded out over the last
2.5 s.

**Picking music (build 5).** Put tracks in `MEDIA_ROOT/music/` (subfolders are
fine; audio files tagged `music` in the library show up too). The story render
form and the script "Render the video" button list them with a level select
(−24 … −12 dB, default −18). Story renders are queued like script renders: the
button returns at once, the story page refreshes while a render is queued or
running, and the finished files appear in its renders list and on `/video`.

## Outputs

`<outFolder>/<outName>-r<renderId>.{mp4,srt,vtt}` — the render id keeps every
render's files distinct, so a re-render never overwrites a file an asset row
points at. Story renders go to `stories/<slug>/video/<lang>/`, script renders
to `renders/script/script-<id>/<lang>/` (title cards in `…/cards/`).

## Script → video

`buildScriptRenderRequest({ scriptId, language, format })` makes one scene per
spoken block. The take convention (phase A's voice studio writes these):

| Field | Value |
|---|---|
| `narrations.owner_kind` | `script` |
| `narrations.owner_ref` | `script:<id>` |
| `narrations.scene_ref` | `hook`, `s01`, `s02`, … (1-based section index), `cta` |

One `selected`, `done` take per block and language (the narrator take wins).
A missing take refuses with the list of blocks that lack one. The visual is
the block's first b-roll file in `media/<script-id>/` (matched by its `NN-`
shot number, video before still), else a title card of the on-screen text on
the brand kit's first colour.

## Running it

- UI: `/video` lists renders (status, duration, MP4/SRT/VTT links, errors,
  re-render) and refreshes itself while one runs. `RenderButton` starts a
  render from a page; the server action returns at once and the work runs
  after the response (`after()` from `next/server`). Renders run one at a time
  per process; others wait as `queued`. A render left `queued`/`rendering`
  for 6 h (the app stopped) is marked failed when `/video` is opened.
- CLI: `npx tsx --conditions=react-server scripts/video-render.ts --script 12
  --lang es-PY --format 16x9 [--burn] [--music bed.mp3] [--music-db -18]`.

## What to install

- **ffmpeg + ffprobe** on PATH (`winget install ffmpeg` — the gyan.dev full
  build includes libass), or set `FFMPEG_PATH` / `FFPROBE_PATH`.
- Optional `VIDEO_X264_PRESET` (default `medium`; `veryfast` for drafts).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ffmpeg/ffprobe are not installed" | Install ffmpeg or set `FFMPEG_PATH` and `FFPROBE_PATH`. |
| "Burning captions needs an ffmpeg built with libass" | Use a full ffmpeg build, or render without burning (SRT/VTT are still written). |
| "Media drive not connected" | Plug in the drive or fix `MEDIA_ROOT`. |
| "Scene S03: visual not found" | The art moved; re-import the story or fix the path. |
| "No selected es-PY take for: s02 (…)" | Record and select a take for that block. |
| A render stays "Rendering…" | It is running (long videos take minutes); a 6 h old one is failed on the next visit to `/video`. |
| Burned captions show boxes | The font is missing; install DejaVu Sans or edit `subtitleStyle()`. |
