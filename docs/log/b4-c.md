# b4-c — Cuentos story studio

## Built

- `src/lib/stories/parse.ts`: tolerant pure parser (story.json, art manifest, `languages/`, `audio/` scripts) → scenes + report (warnings, unknown files); never invents text.
- `book.ts` + `import.ts` + `scripts/stories-import.ts`: read-only import from `CUENTOS_ROOT/books/*`, sharp art sizes, upsert stories/scenes, re-import keeps in-app approvals unless repo status or text changed, change report.
- `rules.ts`: `canNarrate` (§1.3: approved statuses, pending notices, missing language = refusal), `gn` upload-only, line slots, bedtime padding.
- `studio.ts`: narrate a scene via `@/lib/voice` (narrator/character profiles, `story:<slug>` scope), upload recording, select/review takes, approve text here (who/when), scene audio (ffmpeg join, 250 ms gaps, measured, timings shifted, registered).
- `render.ts`: `RenderRequest` builder (refusal list, sample ≤ 45 s, varied camera, 900/600 ms padding, captions = text) → `renderVideo()`.
- `export.ts`: Export to cuentos — selected WAV/MP3 + latest SRT/VTT into `books/<slug>/audio/<lang>/`, `audio/manifest.content-engine.json`; never overwrites files it did not write.
- `deps.ts` seam (fake voice/video engines in tests), `data.ts` reads + per-language readiness.
- UI: `/stories` library (readiness, import + report), `/stories/[slug]` scene grid, render/export panel; `Story*` components (minimal take UI).
- Routes: `/api/stories/art/<slug>/<scene>` (owner, path from DB, traversal/symlink safe, `?size=thumb`), `/api/stories/audio/…`, `POST /api/stories/upload/<slug>`.
- Fixture book `tests/fixtures/cuentos/books/tito-salto-chiquito/`; unit tests (parser, rules, render/readiness) and `tests/integration/b4-c-{import,studio}.test.ts`.
- `docs/CUENTOS.md`: setup, formats, rules, Tito sample walkthrough, Guaraní workflow.

## Decisions

- Story languages stay `es/gn/jopara/en`; voice language mapping `es → es-PY` (narrations rows carry the voice language).
- Multi-line scenes use slots `S03#1`, `S03#2` as `sceneRef` (one selected take per owner/scene/language/speaker would collide for repeated speakers); one-line scenes use `S03`.
- Audio-script lines are used only when they say exactly the scene text; otherwise the text is one narrator line (no unapproved wording reaches TTS).
- A take counts only while its `inputText` equals the current line text; character lines without a character profile fall back to the narrator (noted).
- In-app approvals and built scene audio live as JSON in `story_scenes.notes`; the last import report in `stories.notes`.
- Scenes removed from story.json are deleted on re-import (takes remain in `narrations`).
- Upload is a route, not a server action (1 MB server-action body limit).

## Known issues

- `narrate`/`importRecording`/`selectTake`/`reviewTake`/`renderVideo` are foundation stubs here: the UI shows their "not built yet" error until phases A/B merge.
- Renders run synchronously inside the server action (no queue); long full renders may hit request timeouts.
- Export copies SRT/VTT only when phase B registers them as `assets` (`srt_asset_id`/`vtt_asset_id`).
- No music bed selection in the UI yet (`musicPath` is supported by `renderStory`).
- Pending-notice detection is pattern-based (uppercase PENDIENTE/REVISAR/TODO/TBD, `[??]`, `pending review`, `[gn?]`).

## Link pass

- `package.json`: `"stories:import": "tsx --conditions=react-server scripts/stories-import.ts"`.
- Nav (`Header.tsx`) + home card: link `/stories` (`stories.title` key exists).
- Swap `StorySceneCard`'s take list / Narrate form for phase A's `NarrationTakes` / `NarrateButton` if preferred (owner `story_scene`, ref `story:<slug>`, slot = `sceneRef`).
- Check phase A's `selectTake` groups by (owner, sceneRef, language, speaker) — the slot scheme relies on it — and that phase B registers SRT/VTT as assets.

## Verification

- `npm run typecheck` ✓, `npm run lint` ✓, `npm test` ✓ (388 pass), `npm run test:db` ✓ (271 pass, ffmpeg present, 0 skipped).
