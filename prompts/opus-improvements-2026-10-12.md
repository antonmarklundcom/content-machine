# Prompt — repository improvements (12 October 2026)

Copy everything below the line into a Claude Code session running Opus 5.5 on
the `antonmarklundcom/content-machine` repository. Delete any numbered item you
do not want done; the items are independent unless a note says otherwise.

---

You are working in the `antonmarklundcom/content-machine` repository (Next.js 15,
TypeScript strict, Drizzle MySQL dialect, MariaDB on Hostinger, node:test).
Read `AGENTS.md`, `docs/VERIFY.md` and `docs/IMPROVEMENT-REPORT-2026-10-12.md`
first. The report has file:line evidence for every item below; re-check each
location before editing because lines may have moved.

## Rules

- Branch from latest `main`. Make one PR per group (A, B, C, D, E) below, in
  that order, so each PR stays reviewable. Do not open a PR until its group's
  checks pass locally.
- Preserve all existing features, tests, test-DB guards and mocked providers.
  Never hide duplicate-key, FK or truncation errors with blanket catches.
- Do not deploy, publish, change connected accounts or make paid provider
  calls. `GEMINI_FAKE=1` and `VOICE_FAKE=1` stay forced in tests.
- Validation per `docs/VERIFY.md`: for every PR run `npm run typecheck`,
  `npm run typecheck:worker`, `npm run lint`, `npm test`, `npm run test:worker`
  and `npm run build`. For any schema or test-harness change also run
  `npm run test:db` against a disposable MariaDB whose name ends in `_test`
  with `ALLOW_DESTRUCTIVE_TEST_DB=1`, and run fresh migrations from empty. If
  you cannot get a MariaDB locally, dispatch the manual CI workflow and record
  the run URL and head SHA. Record exact commands, revision and pass/fail/skip
  in each PR body.
- Keep each change minimal and in scope. If an item turns out to be wrong or
  not worth it, skip it and say why in the PR body instead of forcing it.
- Do not include model names in commits, code or PR text.
- Update `docs/CONVERSION-FINDINGS.md` when a DB or driver fact changes, and
  add a short line to `KNOWN-ISSUES.md` for anything you leave open.

## Group A — security and correctness (one PR)

1. Add the per-request session/role gate to `GET /api/brands`,
   `GET /api/ideas`, `PATCH /api/ideas/[id]` and `POST /api/ingest`. Use the
   same pattern as `src/app/api/ideas/promote/route.ts`. `/api/ingest` spends
   YouTube quota, so it gets the owner/spend gate used by other spend routes.
   Add an integration test per route (401/403 without a session, 200 with
   one) using `callRoute`/`jsonPost`/`signIn` from `tests/integration/route.ts`.
2. Harden `PATCH /api/ideas/[id]`: parse the body with
   `request.json().catch(() => null)`, return 400 on non-object bodies, require
   `ideaId > 0`. Add tests for a non-JSON body, `null`, and id `0`.
3. Create `src/lib/auth/api-guard.ts` exporting `requireOwnerApi(what?: string)`
   and `requireAuthoringApi()`. Migrate every route that imports `ownerOnly`
   from `src/lib/media/serve.ts` or `src/lib/scripts/owner-gate.ts`, and
   `authoringOnly`, to the new module. Delete the old helpers once nothing
   imports them. Behaviour must be identical (same status codes and messages);
   existing tests prove it.
4. SSRF guard for `fetchFactsSource` in `src/lib/facts/import.ts`: resolve the
   host, reject loopback, private, link-local and metadata ranges (IPv4 and
   IPv6), reject non-http(s) redirects, and enforce `MAX_SOURCE_BYTES` while
   streaming instead of after `res.text()`. Add unit tests with a stubbed
   fetch. Keep file-path sources working.
5. Replace silent `.catch(() => {})` on state-changing DB writes with a
   `logAndSwallow(tag)` helper in a new `src/lib/log.ts` (leveled, tagged,
   never prints secrets). Targets: `src/lib/video/render.ts` (`markFailed`),
   `src/lib/spend.ts` (hold heartbeat), `src/lib/higgsfield/run.ts`,
   `src/lib/video.actions.ts`, `src/lib/stories.actions.ts`. Leave the `rm`
   cleanup catches silent. Route the existing `console.error`/`console.warn`
   calls in `src/lib/ai.ts`, `src/lib/analysis/run.ts`,
   `src/lib/analysis/batch.ts`, `src/lib/higgsfield.actions.ts` and
   `src/lib/higgsfield-voice.actions.ts` through the same logger.
6. Audit the `failure(err)` / `{ ok: false }` wrappers in
   `src/lib/higgsfield-voice.actions.ts`, `src/lib/comments.actions.ts`,
   `src/lib/report.actions.ts` and `src/lib/video.actions.ts`. Make them log
   (via item 5) any error that is not a known domain error class, so duplicate
   key and FK errors are visible. Add one test that a thrown generic `Error`
   is logged and still returns `{ ok: false }`.
7. Send the Gemini key in the `x-goog-api-key` header instead of `?key=` in
   `src/lib/settings.actions.ts`. Check every error message in that file and
   in `src/lib/clips/fetch/telegram.ts` so a URL containing a key or token can
   never be echoed. Add a test that the error text does not contain the key.

## Group B — test safety and coverage (one PR)

8. In `tests/integration/setup.ts`, call `requireDisposableTestDatabase()` from
   `src/db/test-database-guard.ts` inside both `prepareDatabase()` and
   `resetTables()` so a direct `tsx --test` run without the preload cannot
   truncate a non-test database. Read `ALLOW_DESTRUCTIVE_TEST_DB` and
   `TEST_DATABASE_HOSTS` only from the real shell environment (snapshot
   `process.env` before `dotenv/config` loads in `preload.mjs`). Update
   `.env.example` so it no longer suggests a permanent opt-in, and document
   `TEST_DATABASE_HOSTS` in `tests/integration/README.md`.
9. Speed up `resetTables()`: one module-level pool reused across calls, truncate
   only tables that are non-empty (one `information_schema` query, or track
   tables touched since the last reset), migrate once per run. Add a
   `GET_LOCK('cm_test_db', 5)` held for the process so an accidental parallel
   run fails loudly. Keep FK checks re-enabled in `finally`.
10. Add missing tests: `src/lib/crypto.test.ts` (round-trip, tampered
    ciphertext, wrong key, empty input); route tests for
    `src/app/api/stories/upload/[slug]/route.ts` (good upload, oversize,
    wrong type, bad slug), `src/app/api/media/[...path]/route.ts` and
    `src/app/api/media/asset/[id]/route.ts` (traversal attempts return 404,
    valid file streams, unauthenticated denied).
11. Remove flake risks: replace fixed sleeps in `audit-media-recovery.test.ts`,
    `ideas-posted.test.ts`, `lease.test.ts`, `b4-h-runner.test.ts`,
    `b5-e-render.test.ts` and `media-storage.test.ts` with condition polling
    or `mock.timers`; add `{ skip: !hasFfmpeg }` where ffmpeg is required.
    Delete `tests/screenshots.mjs` (it imports an undeclared `playwright`
    and nothing runs it) or add the dependency and a script, your call, but
    say which in the PR.

## Group C — structure and duplication (one PR, mechanical)

12. Split `src/db/schema.ts` into `src/db/schema/{brand,clips,youtube,spend,
    scripts,facts,social,voice,stories}.ts` following the existing banner
    comments, with `src/db/schema/index.ts` re-exporting everything so
    `import { schema } from "@/db"` and `drizzle.config.ts` keep working.
    Run `npm run db:generate` and confirm it produces NO new migration (the
    schema must be byte-identical in effect). Do the same for `src/lib/ai.ts`
    into `src/lib/ai/{client,usage,content-plan,adapt,video-url,titles,
    script,post,transcribe}.ts` + barrel, and mirror it for
    `src/lib/ai-fake.ts`. Every existing import path must keep resolving.
13. Extract `publishPost` in `src/lib/publish/index.ts` into named steps
    (lease, provider dispatch, state transition, reporting) in sibling files.
    No behaviour change; the publishing-safety tests must pass unchanged.
14. Create `src/lib/env.ts` with typed getters and one place per default. Move
    the duplicated `GEMINI_MODEL` default (`src/lib/ai.ts`, `src/lib/gaps/find.ts`)
    and the "secret at least 32 chars" rule (`src/lib/auth/session.ts`,
    `src/middleware.ts`) there. Middleware runs on the edge-compatible path,
    so keep `env.ts` free of Node-only imports. Migrate the ~25 non-test
    `process.env` readers; leave test files alone.
15. Shared utilities: `src/lib/util/sleep.ts`, `src/lib/util/errors.ts`
    (`errorMessage(e: unknown)`), `src/lib/util/json.ts` (`safeJsonParse<T>`),
    and `src/lib/http.ts` (`fetchWithTimeout`, `withRetry({ attempts, backoff,
    retryOn })`). Replace the five `sleep` copies, the three `slugify`
    copies (keep `slugifyTag` only if its NFKD form is intentional; say so),
    the `err instanceof Error ? err.message : String(err)` pattern, and the
    provider fetch wrappers in `youtube/data-api.ts`, `youtube/captions/http.ts`,
    `voice/providers/{chatterbox,azure,elevenlabs}.ts`, `publish/provider-error.ts`,
    `meta/graph.ts`, `storage/hostinger.ts`. Add timeouts to the fetches that
    have none (`settings.actions.ts`, `storage/hostinger.ts`, `learn/send.ts`).
    Keep the retry semantics each provider has today (add a unit test per
    provider if one is missing).
16. `src/lib/bridge/family-facts.ts`: wrap the import in `db.transaction`,
    batch inserts with `INSERT ... ON DUPLICATE KEY UPDATE` through the
    existing helpers in `src/db/mutations.ts`, and fix the stale "neon-http"
    comment. `src/lib/higgsfield/run.ts`: fetch leases with one `inArray`
    query instead of per row. Existing facts-import and runner tests prove
    equivalence.
17. Scripts: add `scripts/_cli.ts` with `parseArgs`-based `flags()` and
    `runMain(fn)` that calls `closeDb()` and sets `process.exitCode`. Migrate
    the scripts that define their own `arg()`/`flag()` and
    `main().then(...)` tails. Add a uniform `--dry-run` (rename `gaps-find`'s
    `--dry`) to `analyze.ts`, `clips-fetch.ts`, `higgsfield-run.ts`,
    `media-prune.ts`, `video-render.ts` that prints the plan and estimated
    cost and makes no provider call or deletion. Make `seed-yt-owner.ts` and
    `src/db/seed.ts` close the DB. Fix stale comments (`C:\path\to\content-engine`,
    "Neon dev branch" in `smoke.ts`, "once the script line is in package.json").
    Add `package:hostinger` and `verify:recovery` script aliases.

## Group D — database (one PR; needs disposable native MariaDB verification)

18. Add secondary indexes: `ideas (brand_id, status, created_at)`,
    `ideas (research_note_id)`, and whatever `src/lib/bridge/ideas.ts`,
    `src/lib/gaps/find.ts` and the hot queries on `research_notes`, `yt_users`,
    `leases`, `spend_reservation` need. Add foreign keys with
    `ON DELETE RESTRICT` only for strictly ordered tables (`post_assets` →
    `posts`/`assets`, `story_scenes` → `stories`, `narrations` →
    `voice_profiles`); keep the soft links on ingest tables as `schema.ts`
    explains. Generate the migration with `npm run db:generate`, run it fresh
    from empty and on top of the existing migrations, and run the full
    `test:db` suite plus the concurrency regressions. Document the decision
    in `docs/CONVERSION-FINDINGS.md`.
19. Add `updated_at ... ON UPDATE current_timestamp(3)` to the mutable tables
    without one (`brands`, `ideas`, `videos`, `social_accounts`, `narrations`,
    `video_renders`, `content_gaps`, `higgsfield_jobs`, and any other that
    `src/lib` updates). Write a short "column conventions" section in
    `docs/CONVERSION-FINDINGS.md` (when varchar vs longtext, allowed varchar
    lengths, booleans, timestamps, collation). Confirm login-email and slug
    lookups lowercase their input under `utf8mb4_bin`, or switch those
    columns to a `_ci` collation in the same migration, and test both.
    Do not change `title`/`topic` column types unless a query needs an index
    on them; if you do, measure the longest existing value first.
20. `src/db/migrate.ts`: hold `GET_LOCK('cm_migrate', 30)` around `migrate()`.
    `src/db/driver.ts`: warn at startup when the host is not loopback and
    `ssl=true` is absent; support a `DATABASE_SSL_CA` env for a CA file.
    Document both in `.env.example` and `docs/DEPLOY-HOSTINGER.md`.

## Group E — tooling, docs, hygiene (one PR)

21. ESLint: switch to `tseslint.configs.recommendedTypeChecked` with
    `parserOptions.projectService: true`, scoped to `src/**` and `scripts/**`.
    Fix every new finding properly (no blanket disables); `no-floating-promises`
    and `no-misused-promises` findings are real bugs to fix. Lint and
    prettier-check `workers/telegram-capture` too (remove the ignores, add a
    small override for its tsconfig). Add `typecheck:worker` and `test:worker`
    to `npm run verify`. Add `.nvmrc` (`22.13.0`) and `.npmrc` with
    `engine-strict=true`; make `ci.yml` use `node-version-file`. Add `knip` as
    a dev dependency with a `knip` script that reports only (do not fail CI on
    it yet) and remove the unused exports it finds that are not used by tests.
22. Documentation: create `docs/archive/` with a one-line "historical, not
    current" banner at the top of each moved file and move `docs/PLAN-v1-build1.md`,
    `docs/PLAN-v2-build2.md`, `docs/PLAN-build4.md`, `docs/PLAN-build5.md`,
    `docs/log/` and `prompts/archive/` into it; fix every link. Update
    `prompts/_handoff.md` to the manual-only CI policy from `AGENTS.md` and
    `docs/VERIFY.md`. Fix wrong commands: `docs/LEARN.md` (`npm run setup`,
    `npm run deploy`, "Keep its Neon database"), `src/lib/analyze.actions.ts`
    and `scripts/poll-sources.ts` (`npm run poll|backfill|ingest` →
    `yt:poll|yt:backfill|yt:ingest`). Explain the 50 vs 51 table count in
    `README.md` and `docs/CONVERSION-REPORT.md`. Rename "Content Engine" to
    "Content Machine" in `start.bat`/`setup.bat`. In `setup.ps1`, back up
    `.env` to `.env.bak` before rewriting and preserve comments and quoted
    values; add an equivalent `setup.sh` for Linux/macOS (no winget, same
    prompts). Add `PROXY_URL`, `HIGGSFIELD_WORKER_HOST`, `TEST_DATABASE_HOSTS`
    to `.env.example`; remove the `process.env.VERCEL` check in
    `src/lib/settings.actions.ts`. Fix `hosting/media-upload/README.md` step 5
    (a GET returns 405, not 503) and add a small failed-auth delay in
    `upload.php`/`delete.php`. In `tools/chatterbox-server/server.py`, cap
    `text` length and clamp `exaggeration`/`cfg_weight`. In
    `workers/telegram-capture`, bump `wrangler` to the current major and add a
    lockfile. Move the dead PostgreSQL `drizzle/` folder to
    `docs/archive/drizzle-postgres/` and drop the `pg` devDependency if
    `scripts/learn-import-aiinsights.ts` can read a JSON export instead
    (otherwise make `pg` optional and say so).

## Finish

For each PR body: list the items done, the items skipped with a reason, the
exact revision, the commands run and their results, and anything that still
needs the manual native CI run or a human decision. Update
`docs/IMPROVEMENT-REPORT-2026-10-12.md` with a status column when all five
groups are merged.
