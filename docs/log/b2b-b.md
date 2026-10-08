# B2b-B — Fact sheets + own channel vs competitors (ideas 3, 4)

## Built

- `bridge/facts.ts`: create / get / update / mark checked / delete / list (+ grouped by topic), and
  `brandScriptsNeedingCorrection` (posted scripts' `sources[].url` read in SQL, then the pure rule).
- `studio/staleness.ts` (+ 7 unit tests): `isFactStale` (> 90 days), `normalizeUrl`, `scriptsNeedingCorrection`.
- `facts.actions.ts`: owner-only create / update / checked today / delete; results carry dictionary keys.
- `/facts?brand=`: brand chips, "Videos that may need a correction" (links to `/studio/[id]`), add form,
  facts grouped by topic with source link, last-checked date, stale badge, inline edit, checked today, delete.
- Scripts get the facts: `factsForPrompt` in `scripts/brief.ts` (≤ 40), `ScriptBrief.facts?` + a FACTS
  block in `generateScript` ("use as-is, cite the URL; a fact not listed still needs its own source"),
  loaded for the brand in `POST /api/scripts`.
- `bridge/compare.ts` + `/research/compare?brand=`: per linked channel (own first) median of the last 30,
  uploads/month over 90 days, best 5 by outlier score; own latest titles vs competitors' top titles.
  "Link my channel" reuses `addCompetitorChannel` with role `own`. Pure SQL, no AI, no API calls.
- `dict/facts.ts` (en + sv, `facts.*` and `compare.*`); one import + two spreads in `dictionary.ts`.
- `tests/integration/b2b-b.test.ts`: 9 tests — CRUD + owner gate, updatedAt rule, correction check,
  facts in the script prompt (fake Gemini), compare stats held to `lib/research/outlier.ts`.

## Decisions

- `updatedAt` moves only on a new claim or source URL; topic, notes and "checked today" don't — they
  don't change what a posted video said, so they must not flag it.
- Source URLs match after normalisation (host case, trailing slash, `#fragment`); path and query stay significant.
- Facts are owner-write, signed-in read: the sheet is what scripts are told to say verbatim.
- `ScriptBrief.facts` is optional so other `generateScript` callers (B2b-D) compile unchanged.
- Uploads/month = videos published in the last 90 days × 30/90, from stored rows (as fresh as the last poll).
- Compare's median/score reuse §1.30's baseline (last 30 with a view count, min 5) — same numbers as `/research`.

## Known issues

- No nav links to `/facts` or `/research/compare` — the parent session adds them after all four 2b PRs (§6b).
- The script cost reservation (`SCRIPT_PROMPT_OVERHEAD_TOKENS`) was not raised for the FACTS block (outside
  Owns); facts are capped at 40 (~2k input tokens) so the estimate still covers it.
- PLAN.md §9 index line not added — PLAN.md is not in this phase's Owns.

## Verification

`npm run verify` green locally against postgres 16 (248 unit, 137 integration, `next build`); Playwright
smoke of `/facts` (add, checked today, edit) and `/research/compare` at 1280 and 390 px.
