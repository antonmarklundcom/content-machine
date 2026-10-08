# Phase O9 — Social schema + contracts. Opus 5.5 med session. Lane 1.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §5.O9, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: none. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/db/schema.ts`, `drizzle/**`, `src/db/seed.ts`, `src/lib/posts/contract.ts` (new), `src/lib/clips/telegram.ts` (new), `src/lib/clips/url.ts`, `tsconfig.json`, `eslint.config.mjs`, `.prettierignore` (exclude `workers/**` only), `src/lib/bridge/{families,accounts,assets,posts,metrics}.ts` (new), `src/lib/bridge/index.ts`, `src/lib/bridge/facts.ts` + existing call sites of `facts.brandId` (nullability only), `src/lib/i18n/dict/{accounts,media,posts,capture}.ts` (stubs), `tests/integration/**`, `docs/log/o9.md`

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o9-social-schema` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `claude-api` is not needed (no model calls). Read `src/lib/scripts/contract.ts` for the contract style.
- Write the whole of §2 in ONE migration. It is the complete contract for build 3: lane 2 and 3 can never add a column, so re-read §5–§6 and check every field they name exists before you generate.
- The `residency-guide` → `guide` rename touches every table with a `brand_id` (ideas, scripts, lessons, facts, brand_sources, competitor_reports, audience_questions, …): grep the schema, don't guess.
- Seed values for the seven residency brands come from the paraguayresidency repo (`git clone --depth 1 https://github.com/antonmarklundcom/paraguayresidency` into your scratchpad): `CLAUDE.md` domain table, `plan.md` §11 for niche/voice. Never infer a domain from a brand name.
- Exclude `workers/**` from the root `tsconfig.json`, ESLint and Prettier now, so S16's Worker (own tsconfig) never breaks root verify.
- `facts.brand_id` becomes nullable: fix every type error it causes, change no behaviour.
- `parseCaptureMessage` is pure and imported by the Cloudflare Worker (S16): no Node APIs, no DB, no `server-only`.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o9.md`; stop only per §4.4.

Exit (§5.O9): verify green; migrate + seed twice on a fresh DB clean; rename test on a build 2 fixture passes; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Next: `prompts/opus-10-media-storage.md`, model `claude-opus-5-5`.
