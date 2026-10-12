# Repository improvement report — 12 October 2026

Reviewed revision: `550dda9` (main) on branch `claude/trusting-newton-gkm61h`.
Reviewer: Claude Code session, with two bounded read-only subagents (application code; tests/scripts/DB/tooling). No repository code was changed for this report.

## What was verified in this session

| Check | Result |
|---|---|
| `npm ci` (Node 22.22, npm 10.9 in the review container) | OK |
| `npm run typecheck` / `typecheck:worker` | OK, no errors |
| `npm run lint` (eslint + prettier) | OK |
| `npm test` | 684 unit tests pass in ~30 s |
| `npm run test:worker` | 25 tests pass |
| `npm run audit:production` | 0 advisories |
| `npm audit` (all) | 9 dev-only advisories (4 moderate, 5 high) via `drizzle-kit → @esbuild-kit → esbuild` and `eslint-config-next → @next/eslint-plugin-next` |
| `npm run test:db` | **Not run**: no MariaDB or Docker daemon in the container |
| `npm run build` (+ postbuild `prepare-hostinger.mjs`) | OK, standalone output prepared |

The repo is in good shape: strict TypeScript, no `@ts-ignore`, no raw SQL interpolation, no empty catch blocks, cookie flags correct, middleware fails closed, cron secret compared in constant time. The items below are improvements, not emergencies, ordered by value.

## Findings (22)

### A. Security and correctness

**1. Three API routes rely on middleware alone and skip the per-request session check.**
`src/app/api/brands/route.ts`, `src/app/api/ideas/route.ts`, `src/app/api/ideas/[id]/route.ts` never call `getSession()` or a role gate. Middleware verifies only the cookie signature (no DB lookup), so a deleted or demoted user keeps access until the token expires. Other routes (e.g. `src/app/api/ideas/promote/route.ts:50`) do the check. Fix: add the same gate.

**2. `POST /api/ingest` has no session or role check but spends YouTube API quota and writes to the DB.**
`src/app/api/ingest/route.ts:57`. Gate it with the owner/spend gate used by other spend routes.

**3. `PATCH /api/ideas/[id]` crashes with a 500 on a malformed body.**
`src/app/api/ideas/[id]/route.ts:12` calls `request.json()` unguarded; a non-JSON body throws, `null` makes `body.status` throw. `Number.isInteger` also accepts `0` and negative ids. Fix: `request.json().catch(() => null)` + 400, require `ideaId > 0`, and reuse the pattern in `src/app/api/posts/route.ts:25`.

**4. Server-side fetch of a user-supplied URL (SSRF) in the facts import.**
`src/lib/facts/import.ts:204` fetches any `http(s)` URL with `redirect: "follow"`, no private/loopback IP block, and reads the whole body with `res.text()` before the 2 MB check. It is owner-gated, which limits impact. Fix: block private/link-local ranges after DNS resolution, cap the body while streaming, and prefer an allow-list (the documented source is a raw GitHub URL).

**5. Two different `ownerOnly` helpers with different signatures.**
`src/lib/media/serve.ts:20` (`ownerOnly()`) and `src/lib/scripts/owner-gate.ts:11` (`ownerOnly(what)`), plus `authoringOnly` at `serve.ts:28`. Routes import whichever is nearest, so policy can drift. Fix: one `src/lib/auth/api-guard.ts` exporting `requireOwnerApi(what?)` and `requireAuthoringApi()`; migrate all routes.

**6. Silent `.catch(() => {})` on state-changing DB writes.**
`src/lib/video/render.ts:318` (`markFailed(...).catch(() => {})`) can leave a render "running" forever; `src/lib/spend.ts:452` can drop a spend-hold heartbeat; `src/lib/higgsfield/run.ts:335, 361, 371, 504, 506`; `src/lib/video.actions.ts:142`; `src/lib/stories.actions.ts:238`. Silent catches are fine only for `rm` cleanup. Fix: a `logAndSwallow(tag)` helper that logs with context, and use it for all non-cleanup writes.

**7. Action wrappers that turn every thrown error into `{ ok: false }`.**
`src/lib/higgsfield-voice.actions.ts`, `src/lib/comments.actions.ts:55,108`, `src/lib/report.actions.ts:46,70`, `src/lib/video.actions.ts:193,224`. This can hide duplicate-key and FK errors, which AGENTS.md forbids. Fix: make `failure(err)` rethrow (or at least log) anything that is not a known domain error class.

**8. API keys sent in the URL.**
`src/lib/settings.actions.ts:113` (Gemini `?key=`), `:123` (YouTube), `src/lib/clips/fetch/telegram.ts:46` (bot token in path, required by Telegram). Fix: use the `x-goog-api-key` header for Gemini, and audit every error path so URLs never reach logs or UI.

### B. Test safety and coverage

**9. The disposable-DB guard is enforced only by `preload.mjs`, not by `tests/integration/setup.ts`.**
`setup.ts:15-19` only checks that `DATABASE_URL` exists; `resetTables()` then truncates all 50 tables. Running a single test file with `tsx --test` directly (without the `--import ./tests/integration/preload.mjs` from `npm run test:db`) would truncate whatever `.env` points at. Also `.env.example:6-8` suggests storing `ALLOW_DESTRUCTIVE_TEST_DB=1` permanently in `.env`, and `TEST_DATABASE_HOSTS` is undocumented. Fix: call `requireDisposableTestDatabase()` inside `prepareDatabase()` and `resetTables()` as defence in depth; read the opt-in from the real shell env only; document `TEST_DATABASE_HOSTS`.

**10. `resetTables()` is slow: 50 `TRUNCATE`s and a new pool per call, 48 call sites; migrator re-runs per test file.**
`tests/integration/setup.ts:37-60`. Fix: one module-level pool, truncate only non-empty tables (query `information_schema.TABLES` once, or track dirty tables), migrate once per run.

**11. Missing tests for sensitive code.**
No test imports `src/app/api/brands/route.ts`, `src/app/api/ingest/route.ts`, `src/app/api/stories/audio/.../route.ts`, `src/app/api/stories/upload/[slug]/route.ts` (file upload), or the media path/asset routes. `src/lib/crypto.ts` (AES-GCM token encryption) has no unit test. Fix: add route tests via `callRoute`/`jsonPost` for upload, media and the gated routes from items 1–3; add `crypto.test.ts` (round-trip, tamper, wrong key).

**12. Flake risks and a dead screenshot script.**
Fixed sleeps in `audit-media-recovery.test.ts:94`, `ideas-posted.test.ts:55`, `lease.test.ts:98`, `b4-h-runner.test.ts:293`, `b5-e-render.test.ts:98`, `media-storage.test.ts:493`; ffmpeg required with no skip. `tests/screenshots.mjs` imports `playwright`, which is not a dependency, and nothing runs it. Fix: condition-poll or `mock.timers`; `{ skip: !hasFfmpeg }`; delete or wire up the screenshot script.

### C. Code structure and duplication

**13. Split the two giant modules.**
`src/db/schema.ts` (2234 lines) has clear banner seams (brand content, clips, YouTube research, spend, scripts, competitors/facts, posts/social, voice, stories/render). `src/lib/ai.ts` (1908 lines) splits by feature (client/usage, content-plan, adapt, video-url, titles, script, post, transcribe), each already with its own `*_JSON_SCHEMA` and `estimate*CostUsd`. `src/lib/ai-fake.ts` (1132) mirrors it. `src/lib/publish/index.ts` has one ~650-line `publishPost` function. Fix: `src/db/schema/*.ts` + barrel; `src/lib/ai/*.ts` + barrel; extract `publishPost` steps.

**14. No central env module; defaults duplicated.**
`process.env.*` read in ~25 non-test files. `GEMINI_MODEL ?? "gemini-3.7-flash"` is duplicated in `src/lib/ai.ts:110` and `src/lib/gaps/find.ts:43`; the "secret ≥ 32 chars" rule is duplicated in `src/lib/auth/session.ts:15` and `src/middleware.ts:28`. Fix: `src/lib/env.ts` with typed getters and one place per default.

**15. Shared utilities copy-pasted.**
`sleep` ×5 (`publish/meta.ts:52`, `publish/provider-error.ts:99`, `ingest/captions.ts:148`, `youtube/data-api.ts:490`, `voice/providers/chatterbox.ts:415`); `slugify` ×3 (`format.ts:84`, `scripts/export.ts:124`, `tags.ts:29`); `err instanceof Error ? err.message : String(err)` ×67; `try { JSON.parse } catch` pattern ×~55; separate fetch+timeout+retry wrappers in `youtube/data-api.ts`, `youtube/captions/http.ts`, `voice/providers/{chatterbox,azure,elevenlabs}.ts`, `publish/provider-error.ts`, `meta/graph.ts`, `storage/hostinger.ts`. Fix: `src/lib/util/{sleep,errors,json}.ts` and `src/lib/http.ts` (`fetchWithTimeout`, `withRetry`); add timeouts to the calls lacking one (`settings.actions.ts:112-123`, `storage/hostinger.ts`, `learn/send.ts:45`).

**16. Per-row awaited writes and a stale Neon comment.**
`src/lib/bridge/family-facts.ts:38-95` loops `insertIfAbsent`/`db.update` per row with the comment "No transaction: neon-http has none". The MySQL driver supports transactions. `src/lib/higgsfield/run.ts:648` does a `select` per row for leases. Fix: wrap in `db.transaction`, batch with `INSERT ... ON DUPLICATE KEY UPDATE`, fetch leases with one `inArray`.

**17. Scripts: 36 files with copy-pasted CLI boilerplate and missing `--dry-run`.**
The same `arg(name)` helper appears in ~9 scripts (`clips-fetch.ts:19`, `comments-sync.ts:18`, `gaps-find.ts:16`, `meta-sync.ts:15`, `publish-due.ts:14`, …); `gaps-find` uses `--dry` while others use `--dry-run`. Paid or destructive scripts with no dry-run: `analyze.ts`, `clips-fetch.ts`, `higgsfield-run.ts` (only `--preflight`), `media-prune.ts` (deletes remote files), `video-render.ts`. `seed-yt-owner.ts` and `src/db/seed.ts:332` never call `closeDb()`. Fix: `scripts/_cli.ts` with `parseArgs` + `runMain(fn)` (closes DB, sets `process.exitCode`), a uniform `--dry-run`, and comment fixes (`C:\path\to\content-engine`, "Neon dev branch" in `smoke.ts:21,268`).

### D. Database schema

**18. No foreign keys at all, and `ideas` has no secondary index.**
`drizzle-mysql/*.sql` contains zero `FOREIGN KEY`; `schema.ts:982` explains it is deliberate for out-of-order ingest, but it applies to all 50 tables including `post_assets`, `story_scenes`, `narrations`. `ideas` (`schema.ts:99-192`) has no index although `src/lib/bridge/ideas.ts:28-62` and `src/lib/gaps/find.ts:137` filter on `brand_id, status` and order by `created_at, id`. `brands`, `research_notes`, `yt_users`, `leases`, `spend_reservation`, `brand_families` also have only a primary key. Fix: FKs with `ON DELETE RESTRICT` on the strictly ordered tables; `index(ideas_brand_status_created_idx)`; indexes on `research_note_id` and other hot filters. Requires a migration and the disposable native MariaDB verification from AGENTS.md.

**19. Column-type and audit-column consistency.**
Short queryable fields (`title`, `topic`, `domain`, `niche`) are `longtext` (`schema.ts:66-69`); varchar lengths vary 8/16/255/512/1024 without a rule. ~37 of 50 tables have no `updated_at`, including mutable `brands`, `ideas`, `videos`, `social_accounts`, `narrations`, `video_renders`, `higgsfield_jobs`. All collations are `utf8mb4_bin` (case-sensitive): confirm that login email and slug lookups lowercase their input, or use `_ci` for those columns. Fix: a short "column conventions" section in `docs/CONVERSION-FINDINGS.md`, then one migration.

**20. Migration and pool hardening.**
`src/db/migrate.ts` has no advisory lock, so two concurrent deploys can race; nothing warns when a non-loopback host is used without `?ssl=true`; `?ssl=true` has no CA option. Fix: `GET_LOCK('cm_migrate', 30)` around `migrate()`, a startup warning for remote-without-TLS, and a `DATABASE_SSL_CA` option.

### E. Tooling, docs, hygiene

**21. Lint and verify gaps.**
ESLint uses `tseslint.configs.recommended` without type information, so `no-floating-promises`, `no-misused-promises`, `await-thenable`, `consistent-type-imports` are off in a heavily async codebase. `npm run verify` excludes `typecheck:worker` and `test:worker`; `workers/**` is ignored by eslint and prettier. No `.nvmrc`/`.node-version`, no `.npmrc` with `engine-strict=true` (the review container had npm 10.9 and nothing complained). `knip`/`ts-prune` is not configured; a sample found ~15 exports used in only one file. Fix: `recommendedTypeChecked` with `projectService: true` for `src` and `scripts`; add worker checks to `verify`; lint the worker; add `.nvmrc` + `.npmrc`; add `knip` as a reporting script.

**22. Documentation sprawl and stale commands.**
31 docs + 45 phase logs + 42 KB `PLAN.md` + two historical 36–41 KB plans; the three CONVERSION-* files total ~55 KB. `prompts/_handoff.md` still requires "PR merged green — CI passed" and "never end your turn while CI is running", contradicting the manual-only CI policy in `AGENTS.md` and `docs/VERIFY.md`. `docs/LEARN.md:77,111` say `npm run setup` / `npm run deploy` (worker-only scripts); `src/lib/analyze.actions.ts:151` and `scripts/poll-sources.ts:52` tell users to run `npm run poll|backfill|ingest` but the scripts are `yt:poll|yt:backfill|yt:ingest`; `LEARN.md:114` says "Keep its Neon database". README says 50 tables, CONVERSION-REPORT says 51 (migrations table, unexplained). `start.bat`/`setup.bat` still say "Content Engine"; `setup.ps1:73-83` rewrites `.env` dropping comments and quotes with no backup; there is no POSIX `setup.sh`. `.env.example` lacks `PROXY_URL`, `HIGGSFIELD_WORKER_HOST`, `TEST_DATABASE_HOSTS`; `src/lib/settings.actions.ts:25` still checks `process.env.VERCEL`. Fix: move historical plans, `docs/log/` and `prompts/archive/` under `docs/archive/` with a banner; fix the listed commands and text; update `_handoff.md`; `.env.bak` before rewrite; add `setup.sh`.

### F. Smaller items worth folding into the above

- `hosting/media-upload/README.md` step 5 says a GET returning 503 means missing config, but `upload.php:9-11` rejects GET with 405 first. No failed-auth throttling; `lib.php:85-92` trusts `X-Forwarded-Proto`/`Host` when `public_base` is empty.
- `tools/chatterbox-server/server.py`: binds loopback (good) but no cap on `text` length and no range check on `exaggeration`/`cfg_weight`; `requirements.txt` pins are marked UNVERIFIED.
- `workers/telegram-capture`: `wrangler ^3` (old major), own `mysql2`/`tsx` copies, no lockfile.
- 13 `eslint-disable @next/next/no-img-element` comments could become one `<MediaImg>` component; 5 `react-hooks/exhaustive-deps` disables could move to refs/`useEffectEvent`.
- `lower(x) like lower(?)` in `src/lib/videos.ts:129`, `glossary/store.ts:48`, `learn/query.ts:93` defeats indexes; `json_contains(..., json_quote(...))` in `src/app/api/generate/route.ts:76` and `src/lib/media/music.ts:101` should be verified on MariaDB's JSON-as-LONGTEXT.
- Legacy PostgreSQL `drizzle/` folder (~1.2 MB of snapshots) is dead; `pg` devDependency is used only by an optional legacy importer in `scripts/learn-import-aiinsights.ts:54`.
- Dev-only `npm audit` advisories: `drizzle-kit`'s bundled esbuild and `eslint-config-next`. Re-check when drizzle-kit ≥ 0.32 and eslint-config-next 15.5.x publish fixes; do not `npm audit fix --force`.

## Suggested order of work

1. A: items 1–8 (small, high value, each with a route test).
2. B: items 9–12.
3. E: item 21 (typed lint will surface more of items 6–7), then item 22.
4. C: items 13–17 (mechanical, lint/test-verified).
5. D: items 18–20 (needs disposable native MariaDB verification before merge).

The companion prompt for an implementation session is `prompts/opus-improvements-2026-10-12.md`.
