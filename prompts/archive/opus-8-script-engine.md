# Phase O8 — Titles + script generation. OPUS 5.5 session (effort medium, §1.37). Lane 1 (last).

Read ONLY: this file, `PLAN.md` §1 (esp. 32–34), §4, §5.O8, the phase table
and §9 index, `docs/log/o5.md`, `docs/log/o7.md`. Execute under §4.

Owns:
- `src/lib/scripts/**` (new), `src/lib/ai.ts` (new calls), `src/lib/ai-fake.ts`,
  `src/app/api/scripts/**` (new), `content/style/**` (new),
  `tests/integration/**`, `prompts/_watcher.md` (ids), `docs/log/o8.md`.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/o8-script-engine` off latest main.
- `contract.ts` (§1.32): `ScriptBodyV1` type + `validateScriptBody()` with
  readable errors; this is the shape videoPY reads later, so field names are
  plain English and stable. Unit tests for valid, missing, and extra fields.
- Style guides: `content/style/en.md`, `es-PY.md`, `jopara.md`, each ≤ 60
  lines, concrete examples, written for spoken on-camera delivery (short
  sentences, one idea per line, no filler). es-PY: voseo, Paraguayan
  vocabulary, softeners. jopara: which Guaraní words to mix in and when not
  to; never invent Guaraní — prefer common, well-known words.
- `generateTitles` / `generateScript` per §5.O8: Gemini structured output,
  Search grounding on for the script, every factual claim in `sources[]`
  with a URL; competitor analyses are passed as *structure references* and
  the prompt forbids copying their wording. Legal/residency facts carry a
  "verify before recording" flag. Through `withSpendCap`; faked.
- Export `format=shots`: numbered shots, each with the spoken line it covers,
  an image prompt and (if motion) a video prompt, aspect ratio, and a
  suggested file name `media/<script-id>/<nn>-<slug>.{png,mp4}`.
- Owner gate on the two spending routes (same 401/403 shape as generate).
- If `GEMINI_API_KEY` + `DATABASE_URL` are present, run one real generate
  and record cost + a trimmed sample in `docs/log/o8.md`; else note it.
- Re-runnable; minor issues → `docs/log/o8.md`; stop only per §4.4.

Exit: contract unit tests; titles, generate+save, and all three exports
covered by integration tests with the fake; `npm run verify` green; PR
merged; log + §9 line; `_watcher.md` ids filled.

## After this phase
Follow `prompts/_handoff.md`: create the watcher Routine, then spawn lane 2
on Opus 5.5 (`claude-opus-5-5`): `sonnet-5-design-system.md`, `sonnet-6-ideas-workflow.md`,
`sonnet-8-docs.md`, `sonnet-10-competitors.md` (≤ 4 at once; the watcher
starts `sonnet-11-lessons.md` and `sonnet-12-script-studio.md` as slots free).
