# Phase O5 — Gemini test double + live smoke. OPUS 5.5 session (effort medium, §1.37). Lane 1.

Read ONLY: this file, `PLAN.md` §1, §4, §5.O5, the phase table and §9 index,
and `docs/log/o4.md`. Execute under the autonomy protocol §4.

Owns:
- `src/lib/ai.ts` — the `geminiClient()` seam ONLY (return the fake when
  `GEMINI_FAKE=1`); no other change to money math or prompts unless a live
  smoke run proves a reservation too low (then adjust the three estimate
  constants and say so in the log).
- `src/lib/ai-fake.ts` (new), `scripts/smoke.ts` (new),
  `tests/integration/**`, `package.json` scripts, `.env.example`
  (`GEMINI_FAKE` line), `docs/log/o5.md`.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Load the `claude-api` skill before touching `ai.ts` (its trigger covers
  this repo's LLM code even though the provider is Gemini — the skill also
  documents the cost guardrail you must respect).
- The fake implements only what the repo calls: `models.generateContent`,
  `models.generateContentStream`, `batches.create`, `batches.get`. Read
  `@google/genai` 2.19.0's types and return objects that satisfy them,
  including a `text` getter or `candidates[0].content.parts` (see
  `responseText` for why both paths matter). Every canned response must
  validate against the JSON schema the caller sent
  (`IDEAS_JSON_SCHEMA`, `ADAPT_JSON_SCHEMA`, `ANALYSIS_JSON_SCHEMA`, the
  screening and outline schemas). Include realistic `usageMetadata` and,
  for calls with `googleSearch`, `groundingMetadata.webSearchQueries` of
  length 3. Record every call (`fake.calls`) for assertions.
- Integration tests call the route handlers directly
  (`await POST(new Request("http://x/api/generate", {...}))`) with the
  session cookie or Bearer token they need; assert DB rows AND the
  `spend_log` delta equals `pricing.ts` applied to the fake's usage. Cover:
  generate (grounded and `analysisId`-seeded), 429 at cap 0, promote with
  `adapt`, `/api/clips` Bearer → `analyzed`, `pollSources` dry run, and a
  real run that submits and collects a fake batch.
- `scripts/smoke.ts`: refuses under `GEMINI_FAKE`; needs real
  `DATABASE_URL` + `GEMINI_API_KEY`; `--dry-run` prints plan + estimates;
  live run does generate / promote-adapt / clip save / one analysis for
  `<brandId>` and prints spend before/after, each call's `usageMetadata`,
  query counts, and the reservation held. If the session has the
  credentials (PLAN §7.1), run it once and log the figures; if not, write
  the command for Anton to `docs/decisions-needed.md` and continue.
- Re-runnable; minor issues → `docs/log/o5.md`; stop only per §4.4.

Exit: CI green with the fake-Gemini integration tests above;
`npm run smoke -- --dry-run` works; live smoke run (figures in the log) or
its command handed off; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Next: `prompts/opus-6-prod-hardening.md`,
model `claude-opus-5-5`.
