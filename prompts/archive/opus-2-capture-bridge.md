# Phase O2 — Capture + bridge. Paste into a fresh OPUS session.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.O2 under the autonomy protocol §4. Build nothing outside
the plan.

## §0. Before anything else: finish O1's database step

O1 merged with its schema work done but never applied — the build session had
no `DATABASE_URL`. This phase cannot verify a single exit criterion until that
is fixed, so it is step one, not a footnote.

```bash
npm install
npm run db:migrate    # applies drizzle/0003 — clips + ideas.source_analysis_id
npm run db:seed       # inserts the 11 brands; a re-run is a no-op by design
npm run db:check      # confirm the tables and rows are actually there
```

Then confirm O1's own exit criteria before building on them:

- `select count(*) from brands` returns 11 (or more, if Anton added any).
- `clips` exists with its three indexes; `ideas.source_analysis_id` exists.
- `/api/generate` with a real `brandId` returns ideas AND adds a row (or
  increments today's row) in `spend_log`. Check the cost is non-zero and
  plausible — this is the first time that path has ever billed.

If `DATABASE_URL` is missing or the migration fails, STOP and tell Anton
exactly what broke (§4.4 — a missing credential with no fallback). Do not
build O2 against an unmigrated database; every exit criterion below reads it.
Once it is green, tick item 1 in PLAN.md §7 in your build-log commit.

## Phase rules

- Branch `phase/o2-capture-bridge` off latest main — unless the session
  harness pins a branch name, in which case use the pinned one and say so in
  the §9 entry (O1 did exactly this).
- Load the `claude-api` skill before writing the promote call or the
  seed-from-analysis prompt changes.
- Reuse, never rebuild: the YouTube save path goes through the EXISTING
  by-URL ingest (find it under `/youtube`'s ingest route/lib) — if it needs
  a small refactor to be callable from `/api/clips`, extract, don't fork.
- New reads go in `src/lib/bridge/` (O1 built it), not inline in routes. S3
  is only allowed to read through that module, so anything the UI will need
  has to exist there by the end of this phase.
- `CLIP_TOKEN`: generate a value, put the name in `.env.example`, use a
  constant-time comparison. Missing token env ⇒ Bearer path returns 503
  with a clear message; cookie path still works (§4.5).
- Every paid call goes through `withSpendCap` and records its real cost —
  copy the shape `generateContentPlan` in `src/lib/anthropic.ts` uses. The
  promote endpoint's voice-adaptation call is optional per request:
  promoting verbatim must work with zero spend.
- **Provider coupling: do not deepen it.** Anton wants to move the app's
  paid calls off the Anthropic API and onto Gemini later (§8, §10) — the
  bill, not the API, is the reason. That swap is not this phase and must not
  be attempted here. What this phase owes it: keep every new paid call
  behind `src/lib/anthropic.ts`-style helpers with the cost arithmetic in
  `src/lib/analysis/pricing.ts`, so a provider swap stays one module's job.
  No new call sites constructing their own client, and no Anthropic-only
  feature (batch, prompt caching, server-side web search) added to a path
  that does not already need it.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

## Exit

- §0 done: migration applied, seed run, `/api/generate` verified against the
  dev DB with its cost in `spend_log`.
- `npm run build`, `npm run typecheck`, `npm test` green. (There is no ESLint
  in this repo — `next build`'s own pass is what "lint" means here.)
- Against the dev DB: a YouTube URL saved via Bearer token reaches status
  `analyzed` with `video_id` set; promote inserts an `ideas` row with
  `source_analysis_id` set; `/api/generate` with `analysisId` returns
  grounded ideas.
- §9 build-log entry appended; PR merged green.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass: spawn a NEW session via `create_session`
— inherit environment and permission mode (never `plan`), **`model` Sonnet**
(this is the model switch), prompt exactly:
`Read prompts/sonnet-3-inbox-ui.md in this repo and execute it.`
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: model switch ⇒ STOP and report; Anton pastes the Sonnet
prompt in a fresh window himself.
