# Phase S7 — Caption probe route. SONNET session. Lane 2, parallel with S5, S6, S8.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S7, the phase table and §9 index,
`docs/log/o6.md`, and `docs/CAPTION-FETCH-RESILIENCE.md`. Execute under the
autonomy protocol §4.

Owns:
- `src/lib/youtube/captions/probe.ts` (new), `scripts/probe-captions.ts`
  (thin CLI over it), `src/app/api/admin/probe/route.ts` (new),
  `src/app/youtube/admin/**` (new), `src/lib/i18n/dict/admin.ts`,
  `src/components/ProbeRunner.tsx` (new), `docs/log/s7.md`.

HARD LIMITS (§4.7): no schema (the verdict is NOT persisted), no auth
changes (use `requireOwner`/`getSession` as they exist), no changes to the
caption strategies themselves, no spend.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s7-probe-route` off latest main.
- `runProbe(videos?: string[]) → ProbeReport` returns exactly what the CLI
  prints today (environment incl. outbound IP, per-video per-strategy
  outcomes, verdict, `CAPTION_STRATEGIES=` line). The CLI keeps its flags
  and exit codes and calls `runProbe`.
- `POST /api/admin/probe`: session required, owner only (403 otherwise),
  `maxDuration = 300`, `dynamic = "force-dynamic"`, returns the report as
  JSON. It is behind the session middleware already — do not add it to the
  matcher's exclusions.
- `/youtube/admin`: owner-only page (redirect others to `/youtube`) with a
  "Run caption probe" button (`ProbeRunner`, client island), verdict table,
  outbound IP, the env line to paste into Vercel, and a sentence telling
  the owner to paste the verdict into `docs/decisions-needed.md` (that is
  PLAN §7.4). Copy via `dict/admin.ts` (en + sv). Header nav link is S9's.
- Unit-test `runProbe`'s verdict logic with stubbed strategy outcomes.
- Re-runnable; minor issues → `docs/log/s7.md`; stop only per §4.4.

Exit: CLI unchanged in behaviour; route returns a report for the owner and
403 for an employee (integration test); page renders; `npm run verify`
green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
