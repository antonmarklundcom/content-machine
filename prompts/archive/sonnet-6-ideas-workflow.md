# Phase S6 — Ideas workflow. OPUS 5.5 session (effort low, §1.37). Lane 2, parallel with S5, S8, S10, S11, S12.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S6, the phase table and §9 index,
and `docs/log/o6.md`. Execute under the autonomy protocol §4.

Owns:
- `src/app/api/ideas/**`, `src/lib/bridge/ideas.ts` (new; export from
  `src/lib/bridge/index.ts` — one line), `src/lib/ideas.actions.ts` (new),
  `src/components/Idea*.tsx` (new), `src/lib/i18n/dict/ideas.ts`,
  `tests/integration/ideas.test.ts`, `docs/log/s6.md`.

HARD LIMITS (§4.7): no schema (O6 already added `posted`/`posted_at`), no
auth, spend, pipeline or `ai.ts` changes. Do NOT edit `src/app/brand/**` —
S5 owns those pages; export your components and S5/S9 mount them.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s6-ideas-workflow` off latest main.
- `bridge/ideas.ts`: `listIdeas({brandId, status?, page?})`,
  `ideaCountsByStatus(brandId)`, `getIdea(id)`.
- `ideas.actions.ts`: `setIdeaStatus` (any signed-in user; `posted` sets
  `posted_at` — reuse the PATCH route or write the same rule),
  `deleteIdea` (owner only, `requireOwner`, and only when status is
  `rejected`), `saveIdeaEdits` (title/angle/draftCopy).
- Components: `IdeaStatusTabs` (proposed/approved/posted/rejected with
  counts), `IdeaActions` (approve, reject, mark posted, copy caption via
  `CopyTextButton`, delete when rejected), `IdeaCitations` (links),
  `IdeaVisualNotes` (collapsed). Copy via `dict/ideas.ts` (en + sv).
- Integration tests for the three actions incl. the owner gate on delete.
- Re-runnable; minor issues → `docs/log/s6.md`; stop only per §4.4.

Exit: proposed → approved → posted round-trips with `posted_at` set;
filtering by status works; delete refused for non-rejected and non-owner;
`npm run verify` green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
