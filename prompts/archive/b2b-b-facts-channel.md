# Build 2b · B — Fact sheets + own channel stats (ideas 3, 4). OPUS 5.5 session.

Read: this file, `PLAN.md` §1 (27–38), §4, `src/db/schema.ts` Build 2b block,
`src/lib/bridge/research.ts`, `src/lib/research/outlier.ts`, `src/lib/ai.ts`
(`generateScript` and its brief), `src/lib/scripts/brief.ts`. Branch `b2b/b-facts`.

Owns: `src/lib/bridge/facts.ts`, `src/lib/studio/staleness.ts` (+ test), `src/app/facts/**`,
`src/components/Fact*.tsx`, `src/lib/facts.actions.ts`, `src/app/research/compare/**`,
`src/components/Compare*.tsx`, `src/lib/bridge/compare.ts`, `src/lib/scripts/brief.ts`
(facts field only), `src/lib/ai.ts` (only: add a FACTS block to the `generateScript` prompt when
the brief has facts), `src/app/api/scripts/route.ts` (load the brand's facts into the brief),
`src/lib/i18n/dict/facts.ts` + import line, `tests/integration/b2b-b.test.ts`, `docs/log/b2b-b.md`.

Build:
1. **Facts (idea 3).** CRUD bridge + `/facts?brand=` grouped by topic: add/edit/delete,
   "Checked today" button (sets lastCheckedAt), stale badge when lastCheckedAt > 90 days, editing
   claim or source bumps updatedAt. Owner-only writes.
2. Scripts get the facts: the brief carries `facts[]`; the prompt says "use these checked facts
   as-is and cite their URL; a fact not listed still needs its own source".
3. **Out-of-date check.** `staleness.ts` (pure, unit-tested): a posted script is flagged when a fact
   whose sourceUrl appears in the script's sources was updated after the script's postedAt. `/facts`
   shows "Videos that may need a correction" with links to `/studio/[id]`.
4. **Own channel (idea 4).** A channel linked with role `own` (the role exists). `/research/compare?brand=`:
   per channel (own first) median views of last 30 videos, uploads per month, best 5 videos by
   outlier score; own channel's titles vs competitors' top titles side by side. Pure SQL via a new
   bridge, no AI, no extra API calls.
5. Tests: staleness unit tests; facts CRUD + compare bridge integration tests.

Exit: `npm run verify` green; PR merged on green (authorized) or pushed + ended. Log `docs/log/b2b-b.md`.
