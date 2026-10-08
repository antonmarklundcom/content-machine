# B4-E — Learn (the aiinsights merge)

Worktree branch off the build 4 foundation `d1998d8`.

## Built

- `src/lib/learn/summarize.ts`: aiinsights' prompt → `structuredJson` with `LEARN_SUMMARY_JSON_SCHEMA` (title, whatItIs, whyItMatters, howToStart, category, tags), parse/validate, cap estimate; `LearnModelRunner` seam.
- `categories.ts` (`LEARN_CATEGORIES` = aiinsights' 11, legacy text mapping), `github.ts` (README excerpt, `GITHUB_TOKEN` optional), `vision.ts` (Bot API download → Gemini Flash-Lite vision under `withSpendCap`, temp file deleted).
- `process.ts`: `processLearnClip(id, {force})` gathers note, page meta (reuses `fetchListing`'s SSRF-safe fetch), README (link or first repo link in the note), YouTube captions, existing transcript/postText, screenshot; per-clip lease `learn:clip:<id>`; `processLearnClips` batch.
- `nudge.ts` (pure, bundled by the Worker): `pickNudge`, `formatNudgeMessage`, `parseLearnCommand`, shared SQL; `send.ts`: `runWeeklyNudge` for the PC.
- `import.ts`: aiinsights `items` → learn clips, idempotent by canonical URL, `tg://photo/<id>` → `https://telegram.invalid/aiinsights/<id>`, dry-run.
- `query.ts` + `list.ts`: /learn filters (category/none, implemented, committed, search over title/note/summary/url/tags), category counts.
- `/learn` page (owner-only), `LearnFilters`, `LearnCard`, `LearnActions`; `learn.actions.ts` (summarise, implemented ±, commit ±, delete); dict `learn.*` en+sv.
- Scripts `learn-process.ts`, `learn-nudge.ts`, `learn-import-aiinsights.ts`; `docs/LEARN.md`.
- Worker: `/done <id>`, `/commit <id>` (one UPDATE each, allowed chats), `scheduled` cron (`0 12 * * 5`) in `src/nudge.ts`; README updated.
- Tests: 5 unit files (learn) + `workers/telegram-capture/test/learn.test.ts` + `tests/integration/b4-e-learn.test.ts` (13).

## Decisions

- No `last_nudged_at` column (schema not owned): the nudge cooldown is a `leases` row `learn-nudged:<clip id>` expiring 14 days after the nudge.
- The Gemini fake has no canned answer for the new learn schema (`ai-fake.ts` not owned), so tests fake the runner and validate the canned answer against the schema; vision answers in `TRANSCRIPT_JSON_SCHEMA` and runs on the real fake.
- `clips.summary` = "what it is" + "Why it matters: …"; title is filled only when empty.
- A clip with nothing but a bare URL is not sent to the model: error asks for a note (aiinsights' `needs_note`).
- A screenshot that cannot be read (video, other bot's file id) is non-fatal when a note exists.
- Import skips URLs already in clips (any purpose) and tags imports `aiinsights` (+`aiinsights-dismissed`).
- `/done` keeps `committed_at` (history); the pick ignores implemented items anyway.

## Known issues

- Live paths UNVERIFIED: Gemini learn summary/vision, Bot API download and sendMessage, GitHub README, page fetch, the Worker cron on Cloudflare, importing from the real aiinsights Neon.
- Worker `npm test` runs from the root `node_modules` (no Worker install needed); `wrangler` is not installed here, so `wrangler deploy`/cron config was not validated.
- Imported screenshots keep aiinsights' `file_id`; re-reading them works only if the same bot token is used.
- Dismissed aiinsights items are imported (tagged) and can be nudged until deleted.
- Page-meta reuse of `fetchListing` returns listing-flavoured errors internally (swallowed → null).

## Link pass

- package.json scripts:
  - `"learn:process": "tsx --conditions=react-server scripts/learn-process.ts"`
  - `"learn:nudge": "tsx --conditions=react-server scripts/learn-nudge.ts"`
  - `"learn:import-aiinsights": "tsx --conditions=react-server scripts/learn-import-aiinsights.ts"`
- Nav: add `/learn` (label key `learn.title`) to `Header.tsx`/`HeaderNav`; optional home card.
- `src/lib/ai-fake.ts`: add a `learn` kind (schema has `whatItIs`, `whyItMatters`, `howToStart`) so `structuredJson` can run on the fake.
- `.env.example`: `APP_URL=` (optional /learn link in the nudge); note the Worker now needs `TELEGRAM_BOT_TOKEN` as a secret for the cron.
- Later schema: `clips.last_nudged_at` would replace the `leases` cooldown rows.
- `docs/CAPTURE.md`: mention `#learn`/`#ai` and `/done`, `/commit`; link docs/LEARN.md from README.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` (385 pass), `npm run test:db` (271 pass) on `content_engine_e`; Worker `tsx --test test/*.test.ts` (21 pass) and `tsc -p workers/telegram-capture` clean.
