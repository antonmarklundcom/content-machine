# Phase S11 — Lessons + no-caption fallback UI. OPUS 5.5 session (effort low, §1.37). Lane 2, parallel with S5, S6, S8, S10, S12.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S11, the phase table and §9
index, `docs/log/o7.md`. Execute under §4.

Owns: `src/app/lessons/**` (new), `src/components/Lesson*.tsx` (new),
`src/components/SaveLessonButton.tsx` (new),
`src/components/FallbackAnalyzeButton.tsx` (new),
`src/lib/lessons.actions.ts` (new), `src/lib/i18n/dict/lessons.ts`,
`tests/integration/lessons-ui.test.ts`, `docs/log/s11.md`.

HARD LIMITS (§4.7): no schema, auth, spend-cap, pipeline or `ai.ts` changes;
data only through `bridge/lessons.ts` and O7's fallback. Do NOT edit
`src/app/youtube/**` — export the two buttons; S9 mounts them.

Budget: one session, ≤ 75 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s11-lessons` off latest main.
- Build exactly PLAN §6.S11 items 1–3. `SaveLessonButton` props:
  `{ videoId, text?, timestampSec?, defaultBrandId? }`. Kinds: lesson, hook,
  title pattern, fact.
- `FallbackAnalyzeButton` shows the estimated cost and requires one confirm
  click; owner-only (hide for employees); shows the error text on refusal.
- Export Markdown groups by kind, each item with its video link +
  `&t=<sec>` when a timestamp exists.
- Copy in en + sv. Re-runnable; minor issues → log; stop only per §4.4.

Exit: actions integration test; `/lessons` renders; a small demo page is NOT
needed; `npm run verify` green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
