# Phase O7 — Studio data foundation. OPUS 5.5 session (effort medium, §1.37). Lane 1.

Read ONLY: this file, `PLAN.md` §1 (esp. 27–36), §2, §4, §5.O7, the phase
table and §9 index, `docs/log/o5.md`, `docs/log/o6.md`. Execute under the
autonomy protocol §4. Build nothing outside the plan.

Owns:
- `src/db/schema.ts`, `drizzle/**` (migration 0005 only),
  `src/lib/research/**` (new), `src/lib/bridge/research.ts`,
  `src/lib/bridge/lessons.ts`, `src/lib/bridge/scripts.ts` (new),
  `src/lib/analysis/fallback.ts` (new), `src/lib/ai.ts` (the fallback call
  only), `src/lib/ai-fake.ts` (fallback canned response),
  `src/lib/i18n/dict/{research,lessons,scripts}.ts` (empty) + their import
  lines in `dictionary.ts`, `tests/integration/**`, `docs/log/o7.md`.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/o7-studio-foundation` off latest main. WIP commit every 30 min.
- Tables `brand_sources`, `lessons`, `scripts` exactly as §1.29/§1.31/§1.32
  and §2. Comment every table/column with why. No FK constraints (§1.4).
  `scripts.body` is `jsonb`; O8 owns its contract — store it opaque here,
  but the bridge's update function takes a validator argument O8 will pass.
- Outlier (§1.30) is a pure function over rows; unit-test edge cases.
  The bridge query for "top outliers per brand" must be one SQL statement
  per brand (window/median via `percentile_cont`), not N+1 loops.
- Fallback (§1.35): Gemini `fileData: { fileUri: <youtube url> }`, low
  media resolution, same output parsing as the caption analysis path, same
  storage. Reservation estimate from `videos.duration`; refuse (clear error)
  when duration is unknown or > 90 min. Never called from poll/batch.
- Bridges are the only data access lane 2 will use — give each function a
  one-line doc comment; lane 2 cannot change them.
- Re-runnable; minor issues → `docs/log/o7.md`; stop only per §4.4.

Exit: migration 0005 generated and applied in CI; outlier unit tests; an
integration test per bridge function; fallback test via the fake; `npm run
verify` green; PR merged; log + §9 line.

## After this phase
Follow `prompts/_handoff.md`. Next: `prompts/opus-8-script-engine.md`, model `claude-opus-5-5`.
