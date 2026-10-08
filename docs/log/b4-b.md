# b4-b — Video render + captions

## Built

- Pure planners in `src/lib/video/`: `timeline.ts` (audio + pad, cumulative frames), `captions.ts` (word-timing and proportional cues, ≤2×42 chars, ≤6 s, ≥0.8 s; SRT/VTT writers), `camera.ts` (gentle moves, default rotation, art-never-cropped window check), `ffmpeg-args.ts` (scene/audio/mux/ffprobe argument + filtergraph builders).
- `render.ts`: `renderVideo()` body — per-scene stills (blurred darkened cover bg + whole art fitted in 90 %, composed at 4× then zoompan) or looped/trimmed clips; narration padded per scene and concatenated; music bed looped at `musicDb`, sidechain-ducked, faded; concat + AAC 192k + `+faststart`; optional libass burn-in; ffprobe duration check; temp dir cleaned.
- Outputs `<outFolder>/<outName>-r<id>.{mp4,srt,vtt}` under MEDIA_ROOT; MP4 via `registerFile`, SRT/VTT as `document` assets; `video_renders` lifecycle queued → rendering → done/failed with `plan` = request + timeline + cameras + cues.
- `enqueueRender()`: one render at a time per process, returns the row id at once.
- `from-script.ts` + pure `script-blocks.ts`: script → `RenderRequest` from selected takes (`script:<id>`, scene refs `hook`/`s01…`/`cta`), b-roll from `media/<id>/NN-*`, else sharp title cards (`title-card.ts`) on the brand kit colour; refusal lists blocks without a take.
- `src/lib/video.actions.ts`: `startRenderAction` / `rerenderAction` (owner-only, `after()` background, errors returned not thrown).
- `GET /api/video/renders/[id]` status JSON; `/video` page (list, links, errors, re-render, auto-refresh, stale-render sweep).
- Components `RenderButton` (start + poll), `RenderRerunButton`, `RenderAutoRefresh`; dict `videoRender.ts` (en + sv).
- CLI `scripts/video-render.ts`; `docs/VIDEO.md`.
- Tests: 41 unit tests (`src/lib/video/*.test.ts`), integration `tests/integration/b4-b-render.test.ts` (16:9 + 9:16 renders, music + burn, failure row, script → video).

## Decisions

- Camera moves the whole composite with the art fitted to 90 % of the frame: max zoom 1.08 and pans (zoom 1.05, 4 % travel) never reach the art — "frame, don't crop" holds at every frame.
- Video visuals get no camera move (clips already move).
- Output names carry the render id so a re-render never overwrites a file another asset row points at.
- SRT/VTT rows are inserted by the renderer (kind `document`, sha256-deduped) because `sniffMime` rejects text files.
- Background work uses `after()` from `next/server` (Next 15.5; `node_modules/next/dist/docs` does not exist in this version); outside a request scope the promise just runs.
- Re-render of a script rebuilds the request from current takes; other owners repeat the stored `plan.request`.
- Duration tolerance in the renderer is 500 ms (fails the row); the integration test asserts ±150 ms.

## Known issues

- `assets.source` has no `render` value; outputs use `import` with `source_ref = render:<id>` and tag `render`.
- Caption assets show in the media library grid as documents.
- The render queue is per process: a CLI render and a UI render can run at the same time.
- A server restart mid-render leaves the row `rendering` until `/video` sweeps it (6 h).
- Burned-caption font sizes per format are tuned by eye for DejaVu Sans; other fonts may need `subtitleStyle()` tweaks.
- The media route serves SRT/VTT with their stored mime; browsers download rather than display them.

## Link pass

- package.json script: `"video:render": "tsx --conditions=react-server scripts/video-render.ts"`
- Nav link: `/video` ("Video renders" / "Videorenderingar") in `Header.tsx`.
- Mount in the script studio (`src/app/studio/[id]/page.tsx`): `<RenderButton ownerKind="script" ownerRef={`script:${script.id}`} languages={[script.language, ...]} formats={["16x9", "9x16", "1x1"]} defaultLanguage={script.language} />` (owner only).
- Phase A: write script takes with `owner_kind=script`, `owner_ref=script:<id>`, `scene_ref` = `hook` | `s01`… | `cta` (helpers `scriptOwnerRef`, `sectionSceneRef` in `src/lib/video/script-blocks.ts`).
- Phase C: call `enqueueRender(req)` (returns `{ renderId, done }`) or `renderVideo(req)`; `RenderRequest.brandId` (new, optional) registers outputs under the brand.
- `.env.example`: optional `VIDEO_X264_PRESET` (default `medium`).
- Optional: `sniffMime` could accept SRT/VTT so `registerFile` handles captions.

## Verification

On commit 9050071 + this log (local, ffmpeg 6.1.1 with libass, Postgres `content_engine_b`):
`npm run typecheck` clean; `npm run lint` clean; `npm test` 402/402 pass; `npm run test:db` 262/262 pass (b4-b-render: 4 tests, ~40 s, durations within ±150 ms). `npm run build` not run (per instructions).
