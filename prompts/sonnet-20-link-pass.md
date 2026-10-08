# Phase S20 — Link pass. Opus 5.5 low session. Link pass, after all of lane 2.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §6.S20, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: S13–S19. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/components/Header.tsx`, `src/app/page.tsx` (home cards), `src/lib/i18n/dict/{nav,header,app}.ts`, `KNOWN-ISSUES.md`, one-line mounts of lane 2 components in other lane 2 pages, `docs/log/s20.md`

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/s20-link-pass` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: none.
- You hold every cross-cutting edit: nav, home cards, the one-line mounts listed in §6.S20.
- Read the lane 2 logs' Known issues and `docs/decisions-needed.md`; promote only still-open cross-phase items.
- Closing report: what shipped, what Anton does next (§7). Lane 3 starts automatically (you spawn O12).
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/s20.md`; stop only per §4.4.

Exit (§6.S20): every nav link resolves; verify green; PR merged; closing report. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn `prompts/opus-12-meta-insights.md` (model `claude-opus-5-5`), then the closing report.
