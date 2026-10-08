# Phase O10 — Media storage. Opus 5.5 med session. Lane 1.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §1.41, §5.O10, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O9. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/storage/**` (new), `src/lib/media/**` (new), `src/lib/studio/media.ts`, `src/app/api/media/**`, `hosting/media-upload/**` (new), `scripts/media-*.ts` (new), `package.json`, `package-lock.json`, `.env.example`, `tests/integration/**`, `docs/log/o10.md`

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o10-media-storage` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `nextjs-deploy-hostinger` for the Hostinger PHP endpoint conventions.
- `src/lib/studio/media.ts` (build 2 script media) must keep working: build on it or wrap it, don't break `/studio/[id]/thumbnails`.
- A missing or unplugged `MEDIA_ROOT` is a normal state (§1.41): every read returns a typed `missing` result, never a 500.
- `sharp` is the only new runtime dependency; `ffprobe` is optional and detected at runtime.
- The PHP endpoint is security-sensitive: constant-time token check, extension AND sniffed-MIME allowlist, size cap, random file names, no PHP execution in the upload dir.
- `media:scan` must be idempotent (sha256) and safe to run hourly from Task Scheduler.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o10.md`; stop only per §4.4.

Exit (§5.O10): verify green; register/scan/missing-root/hostinger-driver tests pass; PR merged. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Next: `prompts/opus-11-post-engine.md`, model `claude-opus-5-5`.
