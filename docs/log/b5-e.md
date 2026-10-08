# Build 5 · Phase E — render known issues

## Built
1. `queueStoryRender()` in `src/lib/stories/studio.ts`: same preparation as `renderStory` (stale scene audio rebuilt, not-ready refusal), then `enqueueRender()`; returns `{ renderId, done, sceneRefs }` at once. `renderStory` stays synchronous for the CLI/tests (shared `prepareStoryRender`).
2. `renderStoryAction` queues, hands `done` to `after()`, returns `stories.render.queued` with the render id; revalidates `/video`.
3. Story page render section: `RenderAutoRefresh` while any story render is queued/rendering, an "in the background · All renders" line, translated status per row.
4. `src/lib/media/music.ts`: `listMusicFiles` (audio under `MEDIA_ROOT/music/`, 3 levels deep, durations via ffprobe), `listMusicTracks` (+ audio assets tagged `music`), pure `resolveMusicPath` (no `..`, absolute, drive, NUL, non-audio; stays inside root) and `parseMusicDb` (clamp −24 … −12, default −18).
5. `src/lib/media/music-levels.ts`: client-safe level constants (keeps `node:fs` out of the client bundle).
6. Story render form: Music select (None + tracks with duration) and level select (−24/−21/−18/−15/−12 dB) → `musicPath`/`musicDb`.
7. `RenderButton`: same two selects; tracks via optional `musicTracks` prop, else fetched once with the new `listMusicAction()`.
8. `startRenderAction` accepts `musicPath` (relative) / `musicDb`, validates and passes them to `buildScriptRenderRequest`; `rerenderAction` keeps a stored script render's music.
9. i18n keys in `stories.ts` / `videoRender.ts` (en + sv); `stories.render.running` now reads "Queuing…".
10. Tests: `src/lib/media/music.test.ts`, `tests/integration/b5-e-render.test.ts`.

## Decisions
- Kept `renderStory` signature and behaviour so b4-c tests are untouched; the queued path is a separate function taking an injectable `enqueue`.
- Music travels from forms as a MEDIA_ROOT-relative path and is resolved server-side; existence is left to the renderer's own preflight.
- `musicDb` is only set when a music bed is chosen.
- No change to `src/lib/video/**`.

## Known issues
- Asset-tagged music outside `music/` is listed only when its `local_path` passes `resolveMusicPath`.
- Durations need ffprobe; without it they show nothing.
- The story form's result line shows the render id but not a live status; the list below refreshes instead.

## Link pass
- `docs/VIDEO.md`, add under music bed: "Music beds: put audio files (mp3, wav, m4a, aac, ogg, flac, opus) under `MEDIA_ROOT/music/` (subfolders up to three deep), or tag an audio asset `music` in the media library. The story render form and the Render video button offer them with a level of −24 … −12 dB (default −18); the bed loops and is ducked under narration. Story renders are queued: the action returns at once and the story page refreshes until the render is done; all renders are on `/video`."
- KNOWN-ISSUES: remove the build 4 items "story renders block the request" and "no music picker" (both fixed).
- Optional: `src/app/studio/[id]/voice/page.tsx` may pass `musicTracks={await listMusicTracks()}` to `RenderButton` to skip the client fetch.

## Verification
- `npm run typecheck`, `npm run lint`, `npm test` (603 pass), `npm run test:db` (341 pass, 0 skipped) — all green.
