# Phase O11 — Post engine. Opus 5.5 med session. Lane 1.

Read ONLY: this file, `PLAN.md` §1 (items 39+), §2, §4, §1.46–§1.48, §5.O11, the phase table and §9 index,
and `docs/log/<dep>.md` for each phase in Depends on: O10. Do not read the archived plans.
Execute under the autonomy protocol §4. Build nothing outside the plan.

Owns (the only paths you may create or modify, plus the §4.9 exceptions):
`src/lib/ai.ts` (new calls only), `src/lib/ai-fake.ts`, `src/lib/posts/**`, `src/app/api/posts/**` (new), `src/app/api/generate/route.ts` (topic param only), `content/style/**`, `content/playbooks/**` (new), `tests/integration/**`, `docs/log/o11.md`

Budget: one session, ≤ 90 min. When the exit criteria pass, open the PR that turn (§4.13).

Phase rules:
- Branch `phase/o11-post-engine` off latest main (or the harness's `claude/…` branch). WIP commit every 30 min.
- Skills: `claude-api` only if you touch model ids; read `src/lib/ai.ts` `structuredJson()` and the scripts engine (build 2 O8) and copy their patterns.
- Every new paid call goes through `withSpendCap` with a reservation estimate, like the scripts calls.
- `transcribeClip` is Gemini-only (it needs the media), even when `AI_PROVIDER` is `claude`/`codex`.
- The playbooks in `content/playbooks/` are the engagement know-how: concrete patterns (hook formulas, carousel arcs of 7–10 slides, comment-keyword CTAs, save/share prompts, story sticker sequences, series). Write them as instructions a model follows, ≤ 150 lines each.
- Style guides `es.md`, `pt-BR.md`, `de.md`, `nl.md`, `sv.md` follow the shape of the existing `en.md`.
- Adaptation rewrites for the target brand's audience; it must not copy facts the target language's facts do not support.
- Re-runnable: check what exists first, continue from the first unmet exit criterion.
  Minor issues → `docs/log/o11.md`; stop only per §4.4.

Exit (§5.O11): verify green; draft + adapt integration tests under the fake; PR merged; then spawn S13–S19 per `_handoff.md`. Screenshots: CI artifact only.

## After this phase
Follow `prompts/_handoff.md`. Last lane 1 phase: spawn ALL of lane 2 (S13–S19) at once.
