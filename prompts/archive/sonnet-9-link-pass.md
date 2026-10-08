# Phase S9 — Link pass. OPUS 5.5 session (effort low, §1.37). Sequential, ONLY after S5, S6, S8, S10, S11, S12 and Build 2b A–D are all merged.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S9, the phase table and §9 index,
and `docs/log/s5.md`, `s6.md`, `s8.md`, `s10.md`, `s11.md`, `s12.md`, `b2b-a.md` … `b2b-d.md`. Execute under the autonomy
protocol §4.

Owns: ESLint + Prettier config files, `package.json` (`lint`, `format`,
`verify`), `.github/workflows/ci.yml` (add the lint step), the repo-wide
autofix commit, `src/components/Header.tsx` (final nav), `src/app/youtube/video/**`
(mounting S11's `SaveLessonButton` + `FallbackAnalyzeButton` only), any component S5 and S6 both shipped (dedupe), `KNOWN-ISSUES.md`,
`prompts/_watcher.md` (no-op), `docs/log/s9.md`.

Budget: one session, ≤ 90 min.

Phase rules:
- Branch `phase/s9-link-pass` off latest main.
- ESLint flat config: `next/core-web-vitals` + `@typescript-eslint`
  recommended; Prettier with the repo's existing style (2 spaces, double
  quotes, trailing commas, 100 cols — check a few files). ONE autofix
  commit (`prettier --write . && eslint --fix .`), then hand-fix what
  remains. Never disable a rule to get green; if a rule is genuinely wrong
  for this repo, note why in the config comment.
- `npm run lint` joins `verify` and CI. CI must stay green.
- Header nav: Content, Research (Outliers, Report, Questions, Compare), Studio (Scripts, Plan, From listing), Facts, Lessons, YouTube (Digest, Topics,
  Marks, Sources, Ingest), Inbox. Mount S11's two buttons on the video page
  (lesson button per key point; fallback button when no transcript). Mount S6's `IdeaActions`/`IdeaStatusTabs` on
  `/brand/[id]` if S5 shipped its own minimal version; delete the duplicate.
- `KNOWN-ISSUES.md`: remove every item O4–O6 turned into a passing test
  (all the "UNVERIFIED" entries); keep only still-open, cross-phase items
  from the `docs/log/*.md` files, one line each with the log it came from.
- Re-runnable; stop only per §4.4.

Exit: `npm run verify` (now with lint) green in CI; nav complete;
`KNOWN-ISSUES.md` holds only open items; PR merged; log + §9 line.

## After this phase
Delete the watcher Routine (`delete_trigger`). Then STOP with the closing
report to Anton: what shipped per phase (PR links), PLAN §7 items still
unchecked, and exact numbered manual steps (follow `docs/LOCAL-SETUP.md`,
add competitors in `/research`, decisions-needed answers). No further sessions.

Also (Build 2b): copy the Task Scheduler lines from `docs/log/o6.md` and `docs/log/b2b-a.md`
into `docs/LOCAL-SETUP.md`, and add `docs/SUBSCRIPTION-MODE.md` to the README.
