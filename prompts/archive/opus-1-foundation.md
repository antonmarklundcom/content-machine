# Phase O1 — Foundation. Paste into a fresh OPUS session.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md` (if
present). Execute plan §5.O1 under the autonomy protocol §4. Build nothing
outside the plan.

Phase rules:
- Branch `phase/o1-foundation` off latest main.
- Load the `claude-api` skill before touching any Anthropic-client or spend
  code; `nextjs-deploy-hostinger` is NOT needed this phase (home is Vercel).
- The schema comment convention in `src/db/schema.ts` is the quality bar:
  every new table/column gets a comment saying why it exists. No FK
  constraints — soft links + drizzle `relations` only (§1.4).
- Retiring `src/lib/brands.ts` means retiring it everywhere: `grep BRANDS`
  and leave zero importers of the constant. The seed script must be
  idempotent (re-running never duplicates or clobbers edited rows).
- Do NOT touch UI, the ingest pipeline internals, or `/youtube` views —
  this phase is schema, seed, spend, and the `src/lib/bridge/` query layer.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: drizzle migration generated AND applied to the Neon dev DB; seed run;
`npm run build`, lint, typecheck green; `/api/generate` works reading the
brands table and its cost appears in `spend_log`; PR merged green.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass (PR merged green, exit checklist, pre-
handoff audit, §9 entry committed): spawn a NEW session via the claude-code-
remote `create_session` tool — inherit environment and permission mode
(never `plan`), `model` Opus, prompt exactly:
`Read prompts/opus-2-capture-bridge.md in this repo and execute it.`
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: same model, so continue in this window. Then end with the
phase report.
