# Phase O14 — Hostinger EU deploy. Opus 5.5 med session. Lane 3 (gated on PLAN.md §7).

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §5.O14, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O13. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`docs/DEPLOY-HOSTINGER.md` (new), `next.config.ts`, `src/db/driver.ts` (IPv4 only), `src/lib/storage/drive.ts` (new), `package.json` scripts, `.env.example`, `docs/log/o14.md`

Lane 3 hard limits (§4.7): no schema, migration, auth or spend-cap changes. The schema already
holds every column this phase needs (§2).

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o14-hostinger-deploy` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `nextjs-deploy-hostinger` — follow it exactly (EU account, IPv6 to Neon, migrations from the PC).
- `docs/DEPLOY-HOSTINGER.md` and the `DB_FORCE_IPV4` flag in `src/db/index.ts` already exist (added before build 3 finished, because Anton deployed early). Extend them; do not rewrite. Add every env var lanes 2–3 introduced.
- Never put the app on the Brazil account (§1.42).
- YouTube caption polling stays on the PC; the online cron runs poll with captions disabled.
- Steps you cannot run from the sandbox are written as exact commands for Anton and marked UNVERIFIED.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o14.md`; stop only per §4.4.

Exit (§5.O14): deploy doc complete; verify green; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing; report.
