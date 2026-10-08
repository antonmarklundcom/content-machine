# PLAN — content-engine build 2: verify, harden, unify, research studio (phased autonomous build)

> **Amended 2026-09-25 (studio scope, §1.27–§1.36).** The app now runs
> **locally first** on Anton's PC, and build 2 grows a *research studio*:
> competitor research, saved lessons, titles and on-camera scripts, and a
> Higgsfield hand-off. S7 is dropped; O7, O8, S10, S11, S12 are added.
> Voice, video rendering and clipping live in `antonmarklundcom/videoPY` and
> are **deferred**. Children's stories are a **separate build**, not here.

Build 1 (O1–O3, S3; 2026-08-28/29) wired the brand-ideation half and the
YouTube half together and added the clip inbox. Its plan and build log are
preserved verbatim in `docs/PLAN-v1-build1.md`. Its outcome: **every phase is
"code complete, UNVERIFIED"** — no build session could reach a database or the
Gemini API. Build 2 exists to fix that first, then to fix what the review
(`docs/REVIEW-2026-09-11.md`) found on top of it.

Same repo, same stack: Next.js (App Router) on Vercel, Neon Postgres via
drizzle, Gemini via `@google/genai`, all paid calls through `src/lib/ai.ts`
and `withSpendCap`.

## Phase table

Lane 1 runs first, sequentially, on Opus 5.5 (O5 → O6 → O7 → O8). When O8
merges, it creates the watcher Routine and spawns every lane 2 phase at once
(S5, S6, S8, S10, S11, S12; ≤ 4 running, the watcher starts the rest). S9 runs after all of
lane 2 has merged.

| Phase | Lane | Model | Prompt file | Plan § | Owns | Depends on |
|---|---|---|---|---|---|---|
| O4 Verification foundation | 1 | Opus 5.5 med | `prompts/opus-4-verify-foundation.md` | §5.O4 | `src/db/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts`, `drizzle.config.ts`, `package.json`, `package-lock.json`, `.github/**`, `tests/**`, `.env.example`, `docs/log/o4.md` | — |
| O5 Gemini double + live smoke | 1 | Opus 5.5 med | `prompts/opus-5-gemini-double-smoke.md` | §5.O5 | `src/lib/ai.ts` (test-double seam only), `src/lib/ai-fake.ts`, `scripts/smoke.ts`, `tests/integration/**`, `package.json` scripts, `docs/log/o5.md` | O4 |
| O6 Production hardening (local-first) | 1 | Opus 5.5 med | `prompts/opus-6-prod-hardening.md` | §5.O6 | `scripts/poll-sources.ts`, `src/app/api/cron/**`, `src/lib/poll.ts`, `src/lib/lease.ts`, `src/app/api/generate/route.ts`, `src/lib/clips/save.ts` (reaper hook only), `src/db/schema.ts`, `drizzle/**`, `src/lib/i18n/**` (split only), `docs/log/o6.md` | O5 |
| O7 Studio data foundation | 1 | Opus 5.5 med | `prompts/opus-7-studio-foundation.md` | §5.O7 | `src/db/schema.ts`, `drizzle/**`, `src/lib/research/**` (new), `src/lib/bridge/research.ts` + `lessons.ts` + `scripts.ts` (new), `src/lib/analysis/fallback.ts` (new), `src/lib/ai.ts` (fallback call only), `src/lib/i18n/dict/{research,lessons,scripts}.ts` (empty stubs + import lines), `tests/integration/**`, `docs/log/o7.md` | O6 |
| O8 Titles + script generation | 1 | Opus 5.5 med | `prompts/opus-8-script-engine.md` | §5.O8 | `src/lib/ai.ts` (new calls), `src/lib/ai-fake.ts`, `src/lib/scripts/**` (new), `src/app/api/scripts/**` (new), `content/style/**` (new), `tests/integration/**`, `prompts/_watcher.md` (ids), `docs/log/o8.md` | O7 |
| S5 One design system | 2 | Opus 5.5 low | `prompts/sonnet-5-design-system.md` | §6.S5 | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/brand/**`, `src/app/globals.css`, `src/components/TopNav.tsx`, `src/components/Header.tsx`, `src/components/Brand*.tsx` (new), `src/lib/i18n/dict/brands.ts`, `docs/log/s5.md` | O6 |
| S6 Ideas workflow | 2 | Opus 5.5 low | `prompts/sonnet-6-ideas-workflow.md` | §6.S6 | `src/app/api/ideas/**`, `src/lib/bridge/ideas.ts` (new), `src/lib/ideas.actions.ts` (new), `src/components/Idea*.tsx` (new), `src/lib/i18n/dict/ideas.ts`, `tests/integration/ideas.test.ts`, `docs/log/s6.md` | O6 |
| ~~S7 Caption probe route~~ | — | — | dropped §1.28 | — | — | — |
| S8 Docs + DX | 2 | Opus 5.5 low | `prompts/sonnet-8-docs.md` | §6.S8 | `README.md`, `CONTRIBUTING.md` (new), `docs/CAPTURE.md`, `docs/CAPTION-FETCH-RESILIENCE.md`, `docs/VERIFY.md` (new), `docs/LOCAL-SETUP.md` (new), `docs/log/s8.md` | O8 |
| S10 Competitor research | 2 | Opus 5.5 low | `prompts/sonnet-10-competitors.md` | §6.S10 | `src/app/research/**` (new), `src/components/Research*.tsx` (new), `src/lib/research.actions.ts` (new), `src/lib/i18n/dict/research.ts`, `tests/integration/research-ui.test.ts`, `docs/log/s10.md` | O8 |
| S11 Lessons + no-caption fallback UI | 2 | Opus 5.5 low | `prompts/sonnet-11-lessons.md` | §6.S11 | `src/app/lessons/**` (new), `src/components/Lesson*.tsx` (new), `src/components/SaveLessonButton.tsx` (new), `src/components/FallbackAnalyzeButton.tsx` (new), `src/lib/lessons.actions.ts` (new), `src/lib/i18n/dict/lessons.ts`, `tests/integration/lessons-ui.test.ts`, `docs/log/s11.md` | O8 |
| S12 Script studio UI + Higgsfield hand-off | 2 | Opus 5.5 med | `prompts/sonnet-12-script-studio.md` | §6.S12 | `src/app/studio/**` (new), `src/components/Studio*.tsx` (new), `src/lib/studio.actions.ts` (new), `src/lib/i18n/dict/scripts.ts`, `.claude/commands/higgsfield-shots.md` (new), `docs/HIGGSFIELD.md` (new), `tests/integration/studio-ui.test.ts`, `docs/log/s12.md` | O8 |
| S9 Link pass | — | Opus 5.5 low | `prompts/sonnet-9-link-pass.md` | §6.S9 | ESLint/Prettier config + repo-wide autofix, `.github/workflows/ci.yml` (lint step), `KNOWN-ISSUES.md`, `src/components/Header.tsx` nav, the one-line mount of S11's buttons in `src/app/youtube/video/**`, `docs/log/s9.md` | S5, S6, S8, S10–S12 |

Right-sizing: every phase is one session, ≤ 90 minutes. If a phase cannot
finish in that, it was two phases — split it in this file, not in the session.

---

## §1. Decisions already made — do not re-litigate

Items 1–11 are carried from build 1 (full text in `docs/PLAN-v1-build1.md`
§1) and still hold: **1** home is Vercel + Neon; **2** no GitHub Actions
dependency at runtime; **3** `ideas.source_analysis_id` is the only cross-half
link, no `brand_id` on videos/sources; **4** no FK constraints, soft links +
drizzle `relations`; **5** the `brands` table is the source of truth;
**6** capture before processing; **7** URL + note is a clip's guaranteed
floor; **8** no audio transcription for IG/FB; **9** the caption probe gates
IG/FB/worker work; **10** one spend cap; **11** Opus and Sonnet only, never
Fable for phases.

Decided 2026-09-11 (Fable review, `docs/REVIEW-2026-09-11.md`):

12. **Verifiability is the foundation.** No feature phase starts until O4
    and O5 have run the build-1 code against a real Postgres and a Gemini
    test double in CI, and the live smoke has run at least once.
13. **Two drivers, one schema.** `src/db/index.ts` uses Neon's HTTP driver
    when `DATABASE_URL` is a Neon host (or `DB_DRIVER=neon`), and
    `drizzle-orm/node-postgres` (`pg`) otherwise. Same `schema`, same
    exports, same call sites. Production behaviour is unchanged.
14. **Migrations and seed run on deploy.** `vercel-build` =
    `db:migrate && db:seed && next build`. The seed is insert-only, so this
    is idempotent. Old §7.1 is closed by this, permanently.
15. **CI is GitHub Actions** with a `postgres:16` service container:
    typecheck → unit tests → migrate → integration tests → build. A PR that
    is red does not merge. Lint is added to the same workflow by S9.
16. **Gemini has a test double.** `GEMINI_FAKE=1` (or a missing key under
    `NODE_ENV=test`) swaps the client for `src/lib/ai-fake.ts`, which returns
    canned responses **with realistic `usageMetadata` and
    `groundingMetadata`** so the spend arithmetic is exercised, not skipped.
    The seam is the existing `geminiClient()`; nothing else in `ai.ts` learns
    about the fake.
17. **One live smoke script** (`npm run smoke`) runs against a real
    `DATABASE_URL` + `GEMINI_API_KEY`: one generate, one promote with
    `adapt`, one clip save (YouTube), one interactive analysis; prints the
    `spend_log` delta and the raw usage figures. It is the only thing that
    ever needs real credentials, and it is what re-baselines the reservation
    estimates in `ai.ts`.
18. **Vercel Cron is the scheduler.** `vercel.json` declares
    `/api/cron/poll` hourly. Vercel sends `Authorization: Bearer $CRON_SECRET`;
    `cron-auth.ts` already accepts it. The route gets `maxDuration = 300`.
19. **The poll lock is a DB lease**, not a module variable: one row in a
    `leases` table (`name` pk, `holder`, `expires_at`), acquired with a single
    `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()` statement so it
    works over Neon's single-statement HTTP driver. A dead run's lease expires
    on its own.
20. **Spend is owner-only, everywhere.** `/api/generate` requires the owner
    (same `ForbiddenError` → 403 shape as promote's `adapt`). Reading and
    editing ideas stays open to any signed-in user.
21. **Clips stuck in `ingesting` for > 15 minutes are failed by the poll
    run** with a retryable error; the inbox's existing retry covers them.
22. **One design system.** The Tailwind token system, `Header` +
    `SpendMeter`, and i18n cover the whole app. The `@layer legacy` CSS and
    the `:not([data-youtube-section] *)` scoping hack are deleted. This is a
    port, not a redesign: same information, same actions.
23. **Ideas gain a `posted` status and `posted_at`** (O6 adds both; S6
    builds the UI). Still no scheduling, no posting integration.
24. **The caption probe is an owner-only route** (S7) so the S4 verdict can
    come from the production IP. IG/FB metadata fetch and the Hostinger
    worker stay in §10 until a verdict is on file in `docs/decisions-needed.md`.
25. **ESLint (`next/core-web-vitals` + `@typescript-eslint`) and Prettier
    are adopted in S9**, sequentially, because a repo-wide autofix touches
    every file every parallel phase owns.
26. **i18n dictionary is split per feature before lane 2** (O6):
    `src/lib/i18n/dict/<feature>.ts`, spread into `dictionary.ts`. A lane 2
    phase owns its own dict file and adds exactly one import line.

27. **Local first (supersedes the Vercel parts of 1, 14, 18).** The app runs
    on Anton's PC: `npm run dev` (or `build && start`) on `localhost`,
    `DB_DRIVER=pg` against a Neon free database. `pg` supports transactions,
    which closes the O4 `db.transaction()` entry in `docs/decisions-needed.md`
    for the way the app is actually run. Scheduled polling is `npm run
    yt:poll` from Windows Task Scheduler, not Vercel Cron; no `vercel.json`
    crons. The code stays deployable to Vercel (nothing Vercel-only is
    removed), but no phase adds Vercel-specific work.
28. **S7 is dropped (supersedes 24).** Captions are fetched from Anton's home
    IP, which YouTube does not block the way it blocks datacenters. The
    probe CLI (`npm run yt:probe-captions`) stays as it is.
29. **Competitors are a link table, not a column.** `brand_sources`
    (`brand_id`, `source_id`, `role` = `competitor` | `inspiration`) — keeps
    §1.3 (no `brand_id` on sources/videos) intact. One channel can be a
    competitor for several brands.
30. **Outlier score is pure math on stored data:** a video's views divided by
    the median views of the same channel's last 30 stored videos (min 5 to
    score). No extra API calls. `src/lib/research/outlier.ts`, unit-tested.
31. **Lessons are their own table** (`lessons`: text, kind =
    `lesson` | `hook` | `title_pattern` | `fact`, optional `brand_id`,
    `video_id`, `timestamp_sec`, `source_url`). Saved by hand from a digest,
    never auto-created. Exported as Markdown per brand/kind.
32. **Scripts are for Anton on camera first.** `scripts` table with a
    versioned JSON body (`src/lib/scripts/contract.ts`, the same shape
    videoPY will read later): 3 title options, 3 thumbnail concepts, hook,
    sections (spoken lines for a teleprompter, talking points, on-screen
    text, b-roll shot with a Higgsfield image + video prompt), CTA, sources
    with URLs. Status `draft` → `ready` → `recorded` → `posted`.
33. **Language per brand, with style guides as files.** `content/style/`
    holds `en.md`, `es-PY.md` (castellano paraguayo), `jopara.md`. The script
    prompt includes the brand's file. Residency and real estate default to
    English; any script can be switched per run.
34. **Higgsfield is driven from Claude Code, not from the app.** The app
    exports a script's shot list (`/api/scripts/[id]/export?format=shots`,
    Markdown + JSON); `.claude/commands/higgsfield-shots.md` tells a Claude
    Code session with the Higgsfield MCP how to generate each shot and save
    the results to `media/<script-id>/`. No Higgsfield API key in the app.
35. **No-captions fallback is click-only.** A video without captions can be
    analysed by passing its YouTube URL to Gemini (low media resolution),
    through `withSpendCap`, only when the owner clicks, never in poll/batch.
37. **All phases run on Opus 5.5 (`claude-opus-5-5`)** — supersedes 11 and
    every "Sonnet" in the phase table, prompts, handoff and watcher. Effort:
    **medium** for O5–O8 and S12, **low** for S5, S6, S8, S10, S11, S9 and the
    watcher. Set the model explicitly on every `create_session` /
    `create_trigger`; never inherit, never Fable. Where a prompt says
    "SONNET session", read "Opus 5.5, low effort". If a newer model exists
    when a phase runs, still use `claude-opus-5-5` unless this line is edited.
38. **Subscription mode.** `AI_PROVIDER=gemini|claude|codex`. Studio writing
    (titles, scripts, reports, packs) goes through `structuredJson()` in
    `ai.ts`, which runs the logged-in Claude Code / Codex CLI locally
    (`src/lib/ai-cli.ts`) at $0 app cost, or Gemini under the spend cap.
    YouTube digests/screening stay on Gemini. See `docs/SUBSCRIPTION-MODE.md`.
36. **Out of scope for build 2:** voice, video rendering, clipping
    (videoPY, deferred), children's stories (separate build), auto-posting.

## §2. Object model

Unchanged from build 1 (see `docs/PLAN-v1-build1.md` §2 and
`src/db/schema.ts`). Build 2 adds:

- **`leases`** — `name text pk`, `holder text`, `expires_at timestamp`.
  Owned by `src/lib/lease.ts`. First user: `poll`.
- **`ideas.posted_at`** (nullable timestamp) and `posted` in
  `IDEA_STATUSES`. `posted` is terminal for the app's purposes.
- **`brand_sources`** (O7, §1.29) — `brand_id`, `source_id`, `role`,
  `added_at`; unique (`brand_id`, `source_id`).
- **`lessons`** (O7, §1.31).
- **`scripts`** (O7, §1.32) — `id`, `brand_id`, `idea_id` (nullable soft
  link), `title`, `language`, `status`, `body jsonb` (contract version
  inside), `created_at`, `updated_at`, `recorded_at`, `posted_at`.
- Everything else is test/CI scaffolding, not schema.

## §3. Feature scope, by dependency

- **A. Verifiable** (O4 → O5): driver switch, CI, integration harness,
  Gemini fake, smoke script, migrate-on-deploy.
- **B. Correct in production** (O6, needs A): cron, lease, `maxDuration`,
  owner-gated generate, clip reaper, research-note linking fix, dict split,
  `posted` status.
- **B2. Studio foundation** (O7 → O8, needs B): competitor links, outlier
  score, lessons, no-caption fallback, scripts table, title + script
  generation, style guides, shot-list export.
- **C. Surfaces** (S5, S6, S8, S10, S11, S12; need B2; parallel): design
  system port; ideas workflow; docs + local setup; competitor research;
  lessons; script studio + Higgsfield hand-off.
- **D. Link pass** (S9, needs C): lint adoption, nav, mounting S11's buttons
  on the video page, KNOWN-ISSUES prune, closing report.

## §4. Autonomy protocol

Every phase session works under these rules; each prompt re-states the ones
it most needs.

1. Work until the phase's exit criteria all pass; never ask permission for
   in-plan work.
2. One PR per phase. Branch `phase/<id>` off latest main — or the branch the
   session harness pins (`claude/…`), which is fine; note it in the log.
   Create, watch, and merge the PR when CI is green. A red build is always
   the session's own work. Lane 2 phases never wait for each other, only
   for O6.
3. Minor non-blocking issues → the phase's `docs/log/<id>.md` "Known
   issues". Only still-open, cross-phase items are promoted to the root
   `KNOWN-ISSUES.md`, by S9.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or
   a bad-foundation decision (schema, auth, money math, route contract)
   where guessing wrong forces a rewrite. "Ask" means: append the question
   to `docs/decisions-needed.md`, commit, push, end the session. Never wait
   in the session for an answer.
5. Missing env values never block: document in `.env.example`, degrade
   gracefully.
6. Every prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion. WIP commit at least every
   30 minutes.
7. Lane 2 hard limits: no schema, auth, spend-cap, ingest/analysis-pipeline,
   or `src/lib/ai.ts` changes. Data access only through `src/lib/bridge/`
   and the existing actions. Blocked by the limit → workaround + §10 note.
8. **Model cost guardrail.** Fable/Mythos-class models are never used for
   phases, subagents, spawned sessions, watchers or Routines. If one seems
   needed, write why to `docs/decisions-needed.md` and end.
9. **File ownership.** A phase writes only to its Owns column, plus: its own
   `docs/log/<id>.md`, its own new files, one import line in
   `src/lib/i18n/dictionary.ts`, one line in `docs/decisions-needed.md`.
   On `git merge main` conflicts: main wins, re-apply your change on top,
   re-run CI. Never edit a file outside Owns to resolve a conflict — log it
   in `docs/decisions-needed.md`, push, end.
10. **Handoff / spawning.** A phase is done when four gates pass: PR merged
    green; exit checklist passed; pre-handoff audit (ONE re-run of
    `npm run verify` on main + ONE adversarial re-read of the merged diff,
    findings fixed in ONE follow-up commit); phase log committed. Then per
    `prompts/_handoff.md`: lane 1 phases spawn the next lane 1 phase; O6
    creates the watcher Routine and spawns all lane 2 phases (≤ 4 running);
    lane 2 phases spawn nothing; S9 deletes the watcher and stops.
11. **Phase log** `docs/log/<id>.md`: ≤ 12 lines "Built", ≤ 8 "Decisions",
    ≤ 8 "Known issues", one line "Verification: CI green on <sha>". Add the
    index line to §9.
12. **Orientation read.** A fresh session reads: its prompt file, §1, §4, its
    own §5/§6 section, the phase table, §9's index, and `docs/log/<dep>.md`
    for its Depends on. Not the old plan, not every log.
    (§4.10 "O6 creates the watcher" now reads "O8 creates the watcher".)
13. **Polish cap.** ONE screenshot pass (≤ 5 pages × 2 widths, CI artifact,
    never committed — `docs/screenshots/` is git-ignored), PR body written
    once (≤ 25 lines). When exit criteria pass, open the PR that turn.
14. **Decisions travel by files.** To change a running phase, edit its
    prompt file on main. Never message a running session.
15. **`npm run verify`** is the one command every phase runs before opening a
    PR: `typecheck && test && test:db && build` (O4 defines it; O5 adds the
    fake-Gemini integration tests to `test:db`).

## §5. Lane 1 — Opus 5.5 phases

### O4 — Verification foundation

1. **Driver switch** (§1.13). `src/db/index.ts`: detect Neon by hostname
   (`*.neon.tech`) or `DB_DRIVER=neon`; otherwise `drizzle-orm/node-postgres`
   with a `pg` `Pool`. `closeDb()` becomes real for the pool. `migrate.ts`
   and `drizzle.config.ts` follow the same rule. Add `pg` + `@types/pg`.
   The exported `db`/`schema` surface is unchanged; grep to prove no call
   site imports the driver directly.
2. **Migrate on deploy** (§1.14). `"vercel-build": "npm run db:migrate && npm run db:seed && next build"`.
   Seed stays insert-only. Document in `.env.example` and `README` (one
   paragraph; S8 rewrites the README).
3. **Integration harness.** `tests/integration/setup.ts` (connect, migrate,
   truncate between tests) using `node:test` like the unit tests, run by
   `npm run test:db` against `DATABASE_URL`. First tests, against real SQL:
   `spend.ts` (record, reserve, cap trip, release), `clips/save.ts`
   (upsert, note coalesce, `created` flag), `promote.ts` verbatim path,
   `bridge/*` reads over seeded rows, seed idempotence (`db:seed` twice, same
   row count). No Gemini yet — anything that would call it is out of scope
   until O5.
4. **CI** (§1.15). `.github/workflows/ci.yml`: Node 22, `postgres:16`
   service, `npm ci`, `typecheck`, `test`, `db:migrate`, `test:db`, `build`
   with placeholder env (`SESSION_SECRET`, `DATABASE_URL` → the service).
   Concurrency group per branch. Plus a `screenshots` job scaffold that runs
   `tests/screenshots.mjs` (Playwright, Chromium) against `next start` and
   uploads `docs/screenshots/` as an artifact — S5 fills the page list.
5. **`npm run verify`** (§4.15) and a `docs/log/o4.md`.

Exit: CI green on the PR with `test:db` running ≥ 12 integration tests
against the service container; `npm run verify` passes locally against the
session's Postgres; `vercel-build` script present; PR merged.

### O5 — Gemini test double + live smoke

1. **The fake** (§1.16). `src/lib/ai-fake.ts` implements the subset of
   `GoogleGenAI` that `ai.ts`, `analysis/run.ts`, `analysis/batch.ts`,
   `screening/run.ts`, `analysis/outline.ts` use (`models.generateContent`,
   `models.generateContentStream`, `batches.create/get`). Responses are
   schema-valid for each JSON schema in the repo, with `usageMetadata`
   (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`,
   `cachedContentTokenCount`) and, for grounded calls, `groundingMetadata.
   webSearchQueries`. `geminiClient()` returns it when `GEMINI_FAKE=1`.
   The fake records every call so a test can assert what was sent.
2. **Integration tests through the routes**: `/api/generate` (ideas inserted,
   `spend_log` row equals the fake's usage priced by `pricing.ts`, 429 when
   the cap is 0), promote with `adapt`, `/api/clips` Bearer path with the
   fake analysis, one `pollSources()` dry run and one real run collecting a
   fake batch. Call route handlers directly (`POST(new Request(...))`).
3. **Smoke** (§1.17). `scripts/smoke.ts`: refuses to run with `GEMINI_FAKE`;
   requires `DATABASE_URL` + `GEMINI_API_KEY`; runs the four live actions
   against a brand id given on the CLI; prints `spend_log` before/after,
   each call's `usageMetadata`, `webSearchQueries.length`, and the
   reservation each call held, so `ESTIMATED_THINKING_TOKENS`,
   `MAX_GROUNDING_QUERIES` and `PROMPT_OVERHEAD_TOKENS` can be re-baselined.
   `--dry-run` prints what it would do and the estimates.
4. **Run the smoke if the session has the credentials** (§7.1). If it does,
   record the figures in `docs/log/o5.md` and adjust the three estimates in
   `ai.ts` if a real run exceeded its reservation. If it does not, write the
   exact command Anton runs to `docs/decisions-needed.md` and continue — this
   is not a §4.4 stop.

Exit: CI green with fake-Gemini integration tests covering generate,
promote-adapt, clips, poll; `npm run smoke -- --dry-run` works; smoke either
run (figures logged) or its command handed off; PR merged.

### O6 — Production hardening + lane-2 prep

1. **Local scheduler** (§1.27, replaces the Vercel cron): `npm run yt:poll`
   uses the same lease as the route; document a Windows Task Scheduler
   entry in `docs/log/o6.md` for S8 to copy. The cron route stays and keeps
   working if deployed; no `vercel.json` crons.
2. **Lease** (§1.19): `leases` table + migration; `src/lib/lease.ts`
   `withLease(name, ttlMs, fn)`; the poll route uses it instead of
   `running`. Integration test: two concurrent calls, one 409.
3. **Owner-gated generate** (§1.20): `/api/generate` → `getSession` +
   `isOwner`, 401/403 with the same JSON shape promote uses. Test.
4. **Clip reaper** (§1.21): inside `pollSources`, before ingest, rows
   `ingesting` with `saved_at`/last update older than 15 min → `failed`,
   error "Ingest timed out — retry". Test.
5. **Research-note link fix**: an idea links to a note only when the fake
   /model returned it with this brand in `relatedBrandIds`; otherwise null.
   Query notes with a `jsonb` containment on `related_brand_ids` instead of
   loading all rows.
6. **`posted` status** (§1.23): `IDEA_STATUSES` + `posted_at` column,
   migration, `PATCH /api/ideas/[id]` sets `posted_at` on transition.
7. **Dict split** (§1.26): `src/lib/i18n/dict/{app,nav,youtube,inbox,spend,…}.ts`,
   `dictionary.ts` spreads them; `TranslationKey` unchanged; i18n tests
   green. Create empty `dict/brands.ts`, `dict/ideas.ts`, `dict/admin.ts`
   with their import lines already in place, so lane 2 never edits
   `dictionary.ts`.
8. On handoff spawn O7 (Opus). The watcher moved to O8.

Exit: CI green; `yt:poll` takes the lease; lease, owner gate, reaper, notes fix
each covered by an integration test; migration 0004 generated; dict split
with zero key changes; PR merged; O7 spawned.

### O7 — Studio data foundation

1. Migration 0005: `brand_sources`, `lessons`, `scripts` (§2). Every new
   table/column commented with why. No FK constraints.
2. `src/lib/research/outlier.ts` (§1.30) + unit tests (fewer than 5 videos →
   null; zero-view median; ties).
3. Bridges (the only data access lane 2 uses): `bridge/research.ts` (link /
   unlink a channel to a brand; list a brand's competitors with channel stats;
   top outliers per brand over N days, joined with analysis summary if any),
   `bridge/lessons.ts` (create, list by brand/kind/video, delete, export
   Markdown), `bridge/scripts.ts` (create, get, list by brand/status, update
   body with contract validation, set status with timestamps).
4. `src/lib/analysis/fallback.ts` (§1.35): `analyzeWithoutCaptions(videoId)`
   → Gemini with the YouTube URL as `fileData`, low media resolution, same
   analysis output shape as the caption path, stored the same way; its call
   lives in `ai.ts` under `withSpendCap` with a reservation estimate from
   duration. Fake returns a canned analysis. Integration test.
5. Empty `dict/{research,lessons,scripts}.ts` with import lines wired.

Exit: migration 0005; outlier tests; bridge integration tests for every
function; fallback test with the fake; `npm run verify` green; PR merged;
O8 spawned.

### O8 — Titles + script generation

1. `src/lib/scripts/contract.ts`: zod-free TS type + hand-written validator
   for the §1.32 body, `version: 1`. Unit tests.
2. `content/style/en.md`, `es-PY.md`, `jopara.md` — short, concrete style
   guides (voice, words to use/avoid, voseo, when to drop a Guaraní word,
   on-camera rhythm: short sentences, one idea per line).
3. `ai.ts`: `generateTitles(brand, topic, lessons)` → 10 titles + angle each;
   `generateScript(brand, brief)` → contract body. Brief = topic, chosen
   title, target length (minutes), language, optional competitor video ids
   (their analyses go in as structure references, never copied), optional
   lessons (hooks, facts). Search grounding on; sources must carry URLs.
   Both through `withSpendCap`, both faked in `ai-fake.ts`.
4. Routes (owner-gated where they spend): `POST /api/scripts/titles`,
   `POST /api/scripts` (generate + save draft), `GET
   /api/scripts/[id]/export?format=md|json|shots` (teleprompter Markdown,
   raw JSON, Higgsfield shot list).
5. Fill `prompts/_watcher.md` ids (S5, S6, S8, S10, S11, S12, then S9).

Exit: contract tests; generate + export integration tests with the fake;
one real smoke run recorded in `docs/log/o8.md` if credentials exist (else a
§7 item); `npm run verify` green; PR merged; watcher created; lane 2 spawned.

## §6. Lane 2 — Opus 5.5 low-effort phases (parallel) and the link pass

Hard limits §4.7 apply to S5, S6, S8, S10–S12.

### S5 — One design system

1. Port `/` (brand grid) and `/brand/[id]` onto the token system:
   `surface-card`, `text-[var(--color-ink)]`, the `Header` (with
   `SpendMeter` and nav) as the one app header — `RootLayout` renders it,
   `youtube/layout.tsx` stops rendering its own. `TopNav` is folded into
   `Header`'s nav (`Content` → `/`, then the existing items).
2. `BrandIdeas.tsx` → server component for the list + small client islands
   (generate button, seed picker, idea card with edit/approve/reject/copy),
   all copy through `t()` from `dict/brands.ts`. Use `CopyTextButton` for
   the caption. Keep every existing action working.
3. Delete `@layer legacy` and every `:not([data-youtube-section] *)`; drop
   `data-youtube-section` if nothing reads it. Confirm no page regressed
   (screenshot pass: `/`, `/brand/propia`, `/inbox`, `/youtube`,
   `/youtube/video/<id>` at 390 and 1280).
4. Fill the CI screenshot job's page list.

Exit: `grep -c "legacy\|data-youtube-section" src` = 0; `npm run verify`
green; screenshots in the CI artifact; PR merged.

### S6 — Ideas workflow

1. `src/lib/bridge/ideas.ts`: list by brand with status filter + counts, get
   one, last run's cost (sum of `spend_log` is not per-run — read `costUsd`
   returned by generate and show it in the response toast only; no schema).
2. `src/lib/ideas.actions.ts` (server actions, owner-gated where they
   destroy): set status incl. `posted`; delete a rejected idea; save edits.
3. UI in `src/components/Idea*.tsx`: status filter tabs, `posted` action,
   copy caption (already from S5's card — coordinate by using the component
   S5 creates only if it is on main; otherwise ship your own `IdeaActions`
   and let S9 dedupe), citations rendered as links, visual notes collapsed.
4. Integration test `tests/integration/ideas.test.ts` for the actions.

Exit: an idea can go proposed → approved → posted and be filtered; delete
works for rejected; `npm run verify` green; PR merged.

### S7 — Caption probe route (DROPPED, §1.28 — kept for the record)

1. Move the probe's logic out of `scripts/probe-captions.ts` into
   `src/lib/youtube/captions/probe.ts` (`runProbe(videos) → ProbeReport`,
   with the outbound-IP lookup); the script becomes a thin CLI over it.
2. Owner-only `POST /api/admin/probe` (session, `requireOwner`) with
   `maxDuration = 300`; `/youtube/admin` page with a "Run caption probe"
   button showing the verdict table, outbound IP, and the
   `CAPTION_STRATEGIES=` line to paste into Vercel. Copy via `dict/admin.ts`.
3. Do not persist the verdict (no schema). The page tells the owner to
   paste the verdict line into `docs/decisions-needed.md`.

Exit: probe runs from the deployed Vercel function via the page; CLI still
works; `npm run verify` green; PR merged.

### S8 — Docs + DX

0. `docs/LOCAL-SETUP.md`: Windows, step by step, for a non-developer — install
   Node LTS + Git (`winget`), clone, `.env` (Neon `DATABASE_URL`,
   `DB_DRIVER=pg`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `SESSION_SECRET`),
   `npm install`, migrate, seed, create the owner, `npm run dev`, open
   `localhost:3000`; Task Scheduler entry for `yt:poll` (from `docs/log/o6.md`);
   a `start.bat` recipe; how to update (`git pull && npm install && npm run
   db:migrate`).
1. `README.md` rewritten for the whole app: what it is (research studio,
   YouTube digests, inbox), login, env vars, local run with `pg`,
   `npm run verify`, `npm run smoke`, the plan/prompts workflow in three
   lines. Vercel deploy is a short "optional" section.
2. `CONTRIBUTING.md`: the autonomy protocol in 15 lines, file ownership,
   how to add a dict file, how to add an integration test.
3. `docs/VERIFY.md`: what CI checks, what smoke checks, what neither can.
4. Refresh `docs/CAPTURE.md` (phone capture needs the app reachable — note
   the options: same Wi-Fi, or a tunnel; keep it short) and
   `docs/CAPTION-FETCH-RESILIENCE.md` (§1.28: home IP).

Exit: every command in the README runs as written; PR merged.

### S10 — Competitor research

1. `/research` page: pick a brand → its competitor channels (add by pasting a
   channel URL: ingest via the existing source action, then link with
   `bridge/research.ts`; remove; role toggle competitor/inspiration).
2. Outlier board: top videos by outlier score over 30/90/365 days, with
   thumbnail, title, views, score, digest summary if analysed, and buttons:
   "Analyse" (existing action), "Open digest", "Use as reference" (adds the
   video id to a new-script brief via query string to `/studio/new`).
3. "Title patterns" panel: the outliers' titles side by side, copyable.
4. Copy via `dict/research.ts` (en + sv).

Exit: link/unlink/list covered by an integration test; page renders with
seeded data; `npm run verify` green; PR merged.

### S11 — Lessons + no-caption fallback UI

1. `SaveLessonButton` (client island): given `videoId`, optional
   `timestampSec`, text prefilled from a key point; picks kind and brand;
   calls `lessons.actions.ts`. `FallbackAnalyzeButton`: shown when a video
   has no transcript; confirms the estimated cost; calls the O7 fallback.
   Both are **exported components only** — S9 mounts them on the video page.
2. `/lessons`: filter by brand/kind, search, delete, "Export Markdown".
3. Copy via `dict/lessons.ts`.

Exit: actions integration test; `/lessons` renders; `npm run verify` green;
PR merged.

### S12 — Script studio UI + Higgsfield hand-off

1. `/studio` list of scripts by brand and status. `/studio/new`: brief form
   (brand, topic, language, length, reference videos, lessons picker) →
   "Suggest titles" → pick → "Write script" → redirect to `/studio/[id]`.
2. `/studio/[id]`: section editor (spoken lines, talking points, on-screen
   text, shot + Higgsfield prompts), title/thumbnail options, sources list,
   status buttons, **teleprompter view** (big text, auto-scroll speed, full
   screen), copy/download exports (md, json, shots).
3. `.claude/commands/higgsfield-shots.md`: a Claude Code slash command that
   takes a script id or a pasted shots export, generates each shot with the
   Higgsfield MCP (image first, then image-to-video when the shot asks for
   motion), and saves results to `media/<script-id>/` with a manifest. It
   states: use the cheapest model that fits, ask before spending more than
   the credits the shot list estimates. `docs/HIGGSFIELD.md` explains the
   loop in 10 lines.
4. Copy via `dict/scripts.ts`.

Exit: create → edit → status → export covered by an integration test;
teleprompter renders; `npm run verify` green; PR merged.

### S9 — Link pass (sequential, after S5, S6, S8, S10–S12)

1. ESLint (`next/core-web-vitals`, `@typescript-eslint`) + Prettier; `npm run
   lint` in `verify` and in CI; one repo-wide autofix commit, then fix the
   remaining findings by hand (no rule disabled to get green).
2. Header nav final order (Content, Research, Studio, Lessons, YouTube,
   Inbox); dedupe any component S5 and S6 both shipped; mount
   `SaveLessonButton` (per key point) and `FallbackAnalyzeButton` on
   `/youtube/video/[id]`.
3. Prune `KNOWN-ISSUES.md`: remove every "UNVERIFIED" item that O4–O6 now
   cover with a test; promote only still-open cross-phase items from the
   `docs/log/*.md` files.
4. Delete the watcher Routine. Closing report to Anton: what shipped per
   phase (PR links), §7 items still open, exact next manual steps.

Exit: lint green in CI; KNOWN-ISSUES only holds open items; watcher gone.

## §7. Human-inputs checklist

| # | Input | First needed | Status |
|---|---|---|---|
| 1 | **Recommended:** add a Neon *dev-branch* `DATABASE_URL` and a `GEMINI_API_KEY` (billed project, own low cap) as environment variables of the Claude Code cloud environment, so O5 can run `npm run smoke` itself. Alternative: after O5 merges, run `npm run smoke -- <brandId>` once locally and paste the printed figures into `docs/decisions-needed.md`. | O5 | ☐ |
| 2 | ~~Vercel 300 s functions~~ — not needed, local first (§1.27). | — | n/a |
| 3 | ~~Vercel `CRON_SECRET`~~ — not needed (§1.27). | — | n/a |
| 4 | ~~S7 probe verdict~~ — dropped (§1.28). | — | n/a |
| 6 | YouTube Data API key (free, Google Cloud console) in `.env` as `YOUTUBE_API_KEY` — needed for channel stats and outliers. | O7 smoke / S10 | ☐ |
| 7 | On your PC, once lane 2 is merged: follow `docs/LOCAL-SETUP.md` (~20 min). | after S9 | ☐ |
| 8 | Add 3–5 competitor channels per brand in `/research`. | after S9 | ☐ |
| 9 | First real titles + script run (O8 had no credentials): with `.env` filled, suggest titles and write one ~5-min script for a brand (S12's `/studio/new`, or `POST /api/scripts/titles` then `POST /api/scripts` signed in as owner); paste `costUsd`, the `spend_log` delta and one section into `docs/log/o8.md`. | after S12 | ☐ |
| 5 | Merge this plan PR before starting O4. | now | ☐ |

## §8. Open business questions (parked)

- **Children's stories for the Paraguayan market** — a separate build (own
  plan, likely its own repo): story writing in castellano paraguayo/Jopará,
  illustrations via Higgsfield, narration once the Paraguayan voice exists.
  It needs no competitor research, so it shares nothing with this app but
  the style guides in `content/style/`.
- Paraguayan voice (Anton, week of 2026-10-05) → then videoPY voice phases.

- IG/FB metadata fetch and the Hostinger worker (old S4) — waits on §7.4.
- Audio transcription for IG/FB (~20x) — no.
- Merge `research_notes` into `topics`/`entities` — no user asking.
- Scheduled/bulk generation across brands — after S6 has shown the manual
  loop is used.

## §9. Build log index

One line per phase; detail in `docs/log/<id>.md`.

| Phase | PR | Log | State |
|---|---|---|---|
| O1–O3, S3 | #6, #8, #9, #10–#12 | `docs/PLAN-v1-build1.md` §9 | merged, unverified |
| Plan v2 | this PR | `docs/REVIEW-2026-09-11.md` | — |
| O4 | #14 | `docs/log/o4.md` | merged |
| O5 | #15 | `docs/log/o5.md` | merged — live smoke handed off |
| O6 | #18 | `docs/log/o6.md` | merged |
| S5 | #26 | `docs/log/s5.md` | merged |
| S6 | #25 | `docs/log/s6.md` | merged |
| O7 | #20 | `docs/log/o7.md` | merged |
| O8 | #22 | `docs/log/o8.md` | merged |
| S7 | — | — | dropped (§1.28) |
| S10 | #27 | `docs/log/s10.md` | merged |
| S11 | #30 | `docs/log/s11.md` | merged |
| S12 | #31 | `docs/log/s12.md` | merged |
| S8 | #24 | `docs/log/s8.md` | merged |
| S9 | #42 | `docs/log/s9.md` | merged |
| B2b-A–D | #38, #37, #39 (+#41), #40 | `docs/log/b2b-{a,b,c,d}.md` | merged |

## §6b. Build 2b — studio extras (ideas 1–8, 10)

Runs after S9. Schema landed in PR #34 (migration 0006). Four parallel Opus 5.5
sessions, disjoint Owns, each one PR:

| Phase | Prompt | Ideas |
|---|---|---|
| B2b-A | `prompts/b2b-a-competitor-report.md` | 1 weekly competitor report, 2 comment mining |
| B2b-B | `prompts/b2b-b-facts-channel.md` | 3 fact sheets + out-of-date check, 4 own channel vs competitors |
| B2b-C | `prompts/b2b-c-filming-publish-repurpose.md` | 5 filming plan, 6 post-recording pack, 7 repurposing |
| B2b-D | `prompts/b2b-d-listing-thumbnails.md` | 8 Propia listing → script, 10 thumbnails → Higgsfield |

Idea 9 (weekly implement nudge) shipped in aiinsights. Nav links for the new
pages are added by the parent session after all four merge.

## §10. Backlog

- **Build 3 — videoPY (voice, video rendering, clipping).** Waits until Anton
  picks the Paraguayan voice (week of 2026-10-05). Lives in
  `antonmarklundcom/videoPY` (its `PLAN.md` §3, §5, §6 track V), reads the
  §1.32 script contract O8 defines. Phases, all Opus 5.5:
  V1 foundation (CLI, project folders, contract loader, `voices.yaml`,
  `pronounce.yaml`) → V2 voice adapters + side-by-side voice test (Gemini
  TTS, Azure es-PY, ElevenLabs, Chatterbox, Higgsfield) → ✋ Anton picks the
  voice → V3 captions (faster-whisper) + render templates (explainer 16:9,
  short 9:16) → V4 clipping of Anton's own recordings (silence cut,
  AI-picked highlights, 9:16 reframe, captions) → V5 listing-video template.
  Plus one content-engine phase: "Send to videoPY" export button.
- Question mining from competitor comments (YouTube `commentThreads`).
- Comparing Anton's own channel stats to competitors.

- IG/FB best-effort oEmbed/OpenGraph metadata; Hostinger relay/worker —
  gated on §7.4.
- Model the 5,000/month free grounding allowance (over-reports today).
- Re-price 3.7 Flash when the intro rate lapses (2026-12-31) — the table
  already holds the standard rate, so nothing breaks; this is a note.
- Telegram-bot capture as an alternative to the PWA share target.
- Retry/backoff for failed clip ingests beyond manual retry.
- Provider abstraction behind `ai.ts` — only if a second provider arrives.
- videos→brands join table, if a query ever needs it.
