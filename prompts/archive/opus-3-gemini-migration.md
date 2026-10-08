# Phase O3 — Provider migration: Anthropic → Gemini. Paste into a fresh OPUS session.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §5.O3 under the autonomy protocol §4. Build nothing outside
the plan.

## Why this is an Opus phase, not Sonnet

This touches money math and every paid-call path in the app at once — the
same bar O1 was held to (§4.7 bars Sonnet phases from spend-cap changes
entirely). Get the pricing table wrong here and the spend cap silently
under-reports every call after this PR merges.

## What this phase is

Anton decided (§8, 2026-08-29) to move every paid model call off the
Anthropic API onto Gemini, on cost. Two call sites, one shared client module:

1. `src/lib/anthropic.ts` — brand ideation (`generateContentPlan`, called
   from `/api/generate`) and promote's voice adaptation (`adaptIdeaToBrand`,
   called from `promote.ts`). Uses Anthropic's server-side `web_search` tool,
   streaming, tool-use, `thinking: { type: "adaptive" }`.
2. `src/lib/analysis/*` + `src/lib/screening/*` — the YouTube
   summarise/screen pipeline (`run.ts`, `batch.ts`, `screening/run.ts`,
   `screening/sql.ts`). `batch.ts` specifically relies on Anthropic's Batch
   API for a flat 50% discount on the nightly poller's cost.

Both share `src/lib/analysis/pricing.ts`'s rate tables and cost arithmetic —
that module's shape (rates per model, `costUsdAtRates`, batch discount
multiplier, "unknown model bills at the most expensive rate on file" safety
default) is provider-agnostic and should survive the swap unchanged in
structure, only the numbers and model names inside it change.

## Before writing any code

- Research the current Gemini API: the first-party Node/TS SDK package name
  (do not assume `@google/genai` is still current — verify), current model
  names/tiers and their per-million-token pricing, how function
  calling/structured output works (the nearest equivalent to Anthropic's
  `tool_choice` + `ToolUseBlock`), Search grounding (the equivalent of
  `web_search`) and its billing unit, and whether a Gemini Batch API exists
  with a comparable discount for `batch.ts`'s use case. Load the `claude-api`
  skill if useful for understanding what to compare against, but the actual
  numbers must come from Gemini's own current docs, not memory — pricing
  changes and a stale number here is exactly the failure mode §1's own
  comments warn about.
- Grep for every `anthropic`/`Anthropic` reference before touching anything
  (`grep -rli anthropic src`) — do not rely on the list above being
  exhaustive.

## Phase rules

- Branch `phase/o3-gemini-migration` off latest main — unless the session
  harness pins a branch name, in which case use the pinned one and say so in
  the §9 entry.
- Keep `src/lib/anthropic.ts`'s role as the ONE module every paid call goes
  through — O2 built every new call site against that discipline
  specifically so a provider swap would be one module's job. Renaming the
  file (e.g. to `src/lib/ai.ts`) is fine if it reads better once it's no
  longer Anthropic-specific; if you rename it, update every import.
- `generateContentPlan` and `adaptIdeaToBrand`'s exported signatures
  (params, return shape `{ ideas, researchNotes, costUsd }` /
  `{ idea, costUsd }`) must not change — every caller (`/api/generate`
  route, `promote.ts`) stays untouched apart from import paths.
- Every paid call still goes through `withSpendCap` and still records its
  real cost via `recordSpend` — do not weaken this. If Gemini's usage
  reporting shape differs from Anthropic's `response.usage`, adapt the cost
  computation to read whatever Gemini actually returns; never estimate
  post-hoc cost from the request instead of the response.
- Rate tables (`MODEL_RATES`, `IDEATION_MODEL_RATES`,
  `WEB_SEARCH_USD_PER_REQUEST`, `BATCH_DISCOUNT`) get real Gemini numbers,
  sourced from the current pricing page, with rate comments in the same
  style the file already uses (cite the date and what changes if a promo
  rate expires, the way the existing Sonnet-5 introductory-rate comment
  does). Keep the "unknown/unlisted model bills at the most expensive rate
  on file" fallback — the safe-direction reasoning doesn't change with the
  provider.
- `pricing.test.ts` must assert real numbers against the new rate table —
  update the test fixtures, don't just make it pass by deleting assertions.
- `.env.example`: remove `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
  `ANTHROPIC_PROMOTE_MODEL` entirely; add the Gemini equivalents (e.g.
  `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_PROMOTE_MODEL` — name them to
  match whatever the chosen SDK actually reads) with comments in the same
  explanatory style as the surrounding file. This is the concrete thing
  Anton is waiting on: a fresh Vercel import of this repo must show the
  correct (Gemini) env var keys immediately, not stale Anthropic ones.
  Touch nothing else in `.env.example` — every other var
  (`DATABASE_URL`, `CLIP_TOKEN`, `SESSION_SECRET`, `YOUTUBE_API_KEY`,
  `MONTHLY_SPEND_CAP_USD`, `CRON_SECRET`, caption/screening vars) is out of
  scope for this phase.
- `package.json`: add the Gemini SDK; remove `@anthropic-ai/sdk` only if
  nothing else in the repo still imports it after your grep.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4 (a
  missing credential with no fallback, or a bad-foundation call where
  guessing wrong forces a rewrite — e.g. if Gemini genuinely has no batch
  discount equivalent, that's a §4.4 stop: report it, propose the fallback
  (interactive-only pricing for the poller), and let Anton decide rather
  than silently absorbing the cost regression).

## Exit

- `npm run build`, `npm run typecheck`, `npm test` green (`pricing.test.ts`
  included, against real Gemini rates).
- Against the dev DB: a real `/api/generate` call returns ideas grounded via
  Gemini Search and logs a non-zero, plausible cost to `spend_log`; a real
  promote call with `adapt=true` returns adapted copy and logs cost.
- `.env.example` contains zero Anthropic var names; a fresh Vercel import of
  this repo shows the correct Gemini keys.
- §9 build-log entry appended (rates used and their source/date, SDK package
  name chosen, any feature-parity gap found — e.g. batch discount, prompt
  caching — and how it was handled); PR merged green.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass: spawn a NEW session via `create_session`
— inherit environment and permission mode (never `plan`), **`model` Sonnet**,
prompt exactly:
`Read prompts/sonnet-4-worker-igfb.md in this repo and execute it.`
Remember S4 is conditional on §1.9's caption-probe gate (§7 item 2) — if
that verdict still isn't recorded, say so instead of spawning S4 blind.
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: model switch ⇒ STOP and report; Anton pastes the Sonnet
prompt in a fresh window himself.
