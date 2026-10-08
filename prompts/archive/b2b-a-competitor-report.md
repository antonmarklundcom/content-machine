# Build 2b · A — Weekly competitor report + comment mining (ideas 1, 2). OPUS 5.5 session.

Read: this file, `PLAN.md` §1 (esp. 27–38) and §4, `src/db/schema.ts` (the
"Build 2b" block at the end), `src/lib/studio/types.ts`, `src/lib/bridge/research.ts`,
`src/lib/youtube/data-api.ts`, `src/lib/ai.ts` (`structuredJson` only),
`docs/SUBSCRIPTION-MODE.md`. Work under the autonomy protocol §4. Branch `b2b/a-competitors`.

Owns: `src/lib/studio/report.ts`, `src/lib/studio/questions.ts` (+ tests),
`src/lib/bridge/reports.ts`, `src/lib/bridge/questions.ts`,
`src/lib/youtube/comments.ts` (+ test), `src/app/research/report/**`,
`src/app/research/questions/**`, `src/components/Report*.tsx`, `src/components/Question*.tsx`,
`src/lib/report.actions.ts`, `scripts/weekly-report.ts`, one `package.json` script line,
`src/lib/i18n/dict/report.ts` + its one import line, `tests/integration/b2b-a.test.ts`,
`docs/log/b2b-a.md`. Nothing else — no schema changes (the tables exist).

Build:
1. **Report (idea 1).** `buildCompetitorReport(brandId, days=7)`: take `topOutliersForBrand`
   over the window (role competitor + inspiration), add each video's analysis summary if one
   exists, call `structuredJson` (no web search) with a schema matching `CompetitorReport`,
   validate, save a `competitor_reports` row with cost. Ideas must be Anton's own angles,
   never a copy. Nothing in the window → save nothing, return a clear "no new outliers" result.
2. `/research/report?brand=` — latest report per brand, older ones listed, "Generate now"
   (owner only), each idea has "Write script" → `/studio/new?brand=…&topic=…&ref=<videoIds>`
   (if `/studio/new` does not read `topic` yet, add that one param read in its page — the
   only S12 file you may touch).
3. `npm run studio:weekly` → report for every brand that has competitors; for Windows Task
   Scheduler (Monday 08:00). Document the scheduler line in the log for the final docs pass.
4. **Comment mining (idea 2).** `youtube/comments.ts`: `commentThreads.list`
   (`order=relevance`, `maxResults=100`, `textFormat=plainText`), quota-aware like data-api.ts,
   comments-disabled → empty. `mineQuestions(brandId, {videos: 10})`: top outliers' comments →
   keep likely questions (a `?` or question words in en/es) → `structuredJson` clusters them into
   ≤ 20 questions with `askCount`, ≤ 5 verbatim examples, `videoIds` → upsert by normalized
   question text into `audience_questions` (bump count, merge ids).
5. `/research/questions?brand=` — sorted by askCount, status new/used/dismissed, "Mine comments"
   (owner), "Write script" (sets status used, links to `/studio/new?brand=&topic=`).
6. Tests: unit for question filtering + report validation; integration with the Gemini fake
   (add canned responses only via your own test setup, not by editing ai-fake.ts — if you must
   edit ai-fake.ts, add a new branch keyed on your schema and nothing else).

Exit: `npm run verify` green, PR open with the §4.13 body, merged when CI is green (Anton has
authorized merge-on-green); if a merge is refused, push and end. Log `docs/log/b2b-a.md`.
