# B2b-A — Weekly competitor report + comment mining (ideas 1, 2)

Branch `b2b/a-competitors`.

## Built

- `studio/report.ts` `buildCompetitorReport(brandId, days=7)`: window outliers (score > 1, competitor +
  inspiration, ≤ 20) + analysis summaries → one `structuredJson` (no web search) → validated → `competitor_reports`
  row with cost. Nothing above median → nothing saved, `{ ok: false, reason: "no_outliers" }`, no model call.
- `studio/report-contract.ts` (pure): schema, prompt, `validateCompetitorReport` — winners' title/channel/score come
  from our rows by id, unknown ids dropped, an idea equal to a competitor's title (folded) dropped.
- `youtube/comments.ts` `YouTubeCommentsClient.topComments`: `commentThreads.list` relevance/100/plainText, 1 unit
  per call against a run budget, `quotaExceeded` → `QuotaExhaustedError` (no retry), comments disabled → `[]`.
- `studio/questions.ts` `mineQuestions(brandId, {videos: 10})` + pure `studio/question-filter.ts`: en/es question
  filter → ≤ 400 comments round-robin across videos → clusters (≤ 20, ≤ 5 verbatim examples) → upsert by
  normalised text (count bumped, examples/ids merged, status kept).
- Bridge: `reports.ts` (save/list/get, `brandIdsWithCompetitors`), `questions.ts` (list/get/status/upsert).
- `/research/report?brand=[&id=]` (latest + older list, owner "Generate now", idea → "Write script") and
  `/research/questions?brand=[&status=]` (by askCount, owner "Mine comments", dismiss/restore, "Write script" → used).
- `npm run studio:weekly [-- --days N --brand id]`; `dict/report.ts` en + sv; unit + `b2b-a.test.ts` integration.

## Decisions

- Pure halves in two new files (`report-contract.ts`, `question-filter.ts`): `report.ts`/`questions.ts` import the
  `server-only` bridge, which plain `npm test` cannot load.
- Canned model answers live in `b2b-a.test.ts` (wraps the fake's `generateContent` for these two schemas only,
  validated with the fake's own `validate()`); `ai-fake.ts` untouched.
- Comments have their own small transport: `YouTubeDataClient.call` is private and `quota.ts` is not owned.
- `?topic=` needed a 2-line `initialTopic` prop on `StudioBriefForm.tsx` (S12's, outside Owns) — the form holds
  the topic state, so the page alone could not prefill it. Questions link without `ref` (rarely analysed).

## Known issues

- No nav links to the two pages yet (parent session adds them after all four 2b phases); PLAN.md §9 index line
  left to that session too, to avoid four parallel edits of PLAN.md.
- A report whose model answer fails validation has still been billed (same as titles/scripts).
- Scheduler line for the final docs pass (Monday 08:00, after `yt:poll`):
  `schtasks /Create /SC WEEKLY /D MON /ST 08:00 /TN "content-engine weekly report" /TR "cmd /c cd /d C:\path\to\content-engine && npm run studio:weekly >> logs\weekly.log 2>&1"`

Verification: `npm run verify` green locally (259 unit, 135 integration, build); CI green on <sha>.
