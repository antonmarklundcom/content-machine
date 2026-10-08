# Phase S8 — Docs + local setup. OPUS 5.5 session (effort low, §1.37). Lane 2, parallel with S5, S6, S10, S11, S12.

Read ONLY: this file, `PLAN.md` (all of it — this phase documents the
method), `docs/log/o4.md` … `docs/log/o8.md`, and the current `README.md`,
`docs/*.md`, `.env.example`, `package.json`.

Owns: `README.md`, `CONTRIBUTING.md` (new), `docs/VERIFY.md` (new),
`docs/LOCAL-SETUP.md` (new), `start.bat` (new, repo root), `docs/CAPTURE.md`,
`docs/CAPTION-FETCH-RESILIENCE.md`, `docs/log/s8.md`.

HARD LIMITS: docs + `start.bat` only. No code, no config, no `.env.example`
edits. A code bug found → one line in `docs/decisions-needed.md`, move on.

Budget: one session, ≤ 60 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s8-docs` off latest main.
- `docs/LOCAL-SETUP.md` per PLAN §6.S8 item 0, written for Anton on Windows,
  not for a developer: numbered steps, exact PowerShell lines (`winget install
  OpenJS.NodeJS.LTS`, `winget install Git.Git`), where each key comes from
  (Neon, aistudio.google.com/apikey, Google Cloud YouTube Data API v3), the
  Task Scheduler entry from `docs/log/o6.md`, and troubleshooting for the
  three likeliest failures (port busy, wrong `DATABASE_URL`, missing key).
- `start.bat`: `cd /d %~dp0`, `npm run build` only if `.next` is missing,
  `npm run start`, open `http://localhost:3000`.
- `README.md`: what the app is (research studio: competitors, digests,
  lessons, titles, scripts, Higgsfield hand-off; plus inbox; ≤ 10 lines),
  local run first (link LOCAL-SETUP), login and roles, every env var with one
  line, `npm run verify`, `npm run smoke`, Vercel as a short optional
  section, three lines on `PLAN.md` + `prompts/`. Every command must exist in
  `package.json`.
- `CONTRIBUTING.md`: §4 in 15 lines, file ownership, adding a
  `dict/<feature>.ts`, adding an integration test, writing a phase log.
- `docs/VERIFY.md`: what CI proves, what `smoke` proves, what neither can.
- `docs/CAPTION-FETCH-RESILIENCE.md`: captions come from the home IP (§1.28).
- Re-runnable; minor issues → `docs/log/s8.md`; stop only per §4.4.

Exit: every command in README and LOCAL-SETUP exists in `package.json`; no
mention of the dropped S7 probe route; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
