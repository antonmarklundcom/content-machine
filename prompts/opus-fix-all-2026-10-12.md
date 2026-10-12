# Prompt — fix everything in the 12 October 2026 improvement report

Paste everything below the line into a Claude Code session on Opus 5.5 (high
effort) opened in the `antonmarklundcom/content-machine` repository.

---

You are the root agent for a repository-wide cleanup of
`antonmarklundcom/content-machine` (Next.js 15, TypeScript strict, Drizzle MySQL
dialect, MariaDB on Hostinger, node:test). Fix all 22 items in
`docs/IMPROVEMENT-REPORT-2026-10-12.md`. The exact per-item instructions are in
`prompts/opus-improvements-2026-10-12.md`; read both files and `AGENTS.md`,
`docs/VERIFY.md` and `CONTRIBUTING.md` before anything else. Re-check every
file:line in the report before editing, lines may have moved.

## How to work

Work in five groups, each its own branch and PR off the latest `main`, merged
before the next group starts so later groups build on the earlier fixes:

1. `fix/a-security` — report items 1–8 (prompt items 1–7)
2. `fix/b-tests` — items 9–12 (prompt 8–11)
3. `fix/e-tooling-docs` — items 21–22 (prompt 21–22). Do this before C so the
   typed lint rules catch mistakes in the refactors.
4. `fix/c-structure` — items 13–17 (prompt 12–17)
5. `fix/d-database` — items 18–20 (prompt 18–20)

You (Opus) own: the plan, all schema/driver/migration work, the persistence
helper contracts (`src/db/mutations.ts`), publish/spend/lease/token code, the
`api-guard` module design, dependency and package.json changes, every merge,
and every final verification run. Never let a subagent touch those.

Use Sonnet 5.5 subagents (Agent tool, `model: "sonnet"`) for bounded,
disjoint, mechanical work where the spec is fully written and the result is
checked by existing tests or typecheck. Give each subagent: the exact files it
owns, the exact change, the command that proves it, and the rule that it must
not commit, push, run `npm run build`, run `test:db`, or touch files outside
its list. Run at most 3 subagents at a time, never two on the same file. Good
subagent jobs:

- A: adding route tests for the four gated routes once you have written the
  guard module and the first route as the pattern; `crypto.test.ts`.
- B: replacing fixed sleeps with polling in the six named test files (one
  subagent per two files); the stories upload / media route tests.
- E: fixing the typed-lint findings file by file after you enable the rules
  (split by directory); the doc text fixes and link rewrites after you move
  the archive folders; `setup.sh`.
- C: moving code into the new `src/db/schema/*` and `src/lib/ai/*` files after
  you create the barrels and decide the file list; replacing `sleep`,
  `slugify`, `errorMessage` and `safeJsonParse` call sites after you write the
  utilities; migrating scripts to `scripts/_cli.ts` after you write it (one
  subagent per 6 scripts).
- D: nothing. Database work stays with you.

Never use a Fable/Mythos-class model for any subagent, session or routine.

## Rules that must hold

- Preserve every feature, test, test-DB guard and provider fake. Never hide
  duplicate-key, FK or truncation errors with blanket catches. Never skip,
  disable or quarantine a test to get green.
- No deploys, no publishing, no connected-account changes, no paid provider
  calls. `GEMINI_FAKE=1` and `VOICE_FAKE=1` stay forced in tests.
- No model names in commits, code comments or PR text.
- Keep each fix minimal and in scope. If an item is wrong, impossible or not
  worth its code, skip it and say so in the PR body with the reason. Do not
  silently drop an item.
- Only you commit and push. One commit per logical change, clear messages.

## Verification per PR (docs/VERIFY.md)

Before opening each PR, run on the final head and paste the exact commands,
head SHA and pass/fail/skip into the PR body:

```sh
npm ci
npm run audit:production
npm run typecheck
npm run typecheck:worker
npm run lint
npm test
npm run test:worker
npm run build
```

For groups B and D, and for any change under `src/db/`, `drizzle-mysql/`,
`tests/integration/setup.ts` or `tests/integration/preload.mjs`, also run
`npm run test:db` against a disposable MariaDB whose database name ends in
`_test`, with `ALLOW_DESTRUCTIVE_TEST_DB=1`, including fresh migrations from an
empty database and the concurrency/integrity regressions. If Docker is
available, `docker run -d --name cm-test -e MARIADB_ROOT_PASSWORD=x -e
MARIADB_DATABASE=content_machine_test -p 3306:3306 mariadb:11.4` is enough. If
no MariaDB is reachable, dispatch the manual CI workflow (`gh workflow run
ci.yml --ref <branch>` or Actions → CI → Run workflow), wait for it, and record
the run URL and head SHA. Do not merge group B or D without one of those two.

For group C, after the schema split run `npm run db:generate` and confirm it
creates no new migration file; if it does, the split changed the schema, fix it.

## Per-PR body

Title `Fix group <X>: <short>`. Body sections: Items done (numbered), Items
skipped with reason, Verification (commands, SHA, results, DB verification
method), Follow-ups. Update `KNOWN-ISSUES.md` for anything left open and
`docs/CONVERSION-FINDINGS.md` for any DB or driver fact that changed. End the
body with the attribution lines your harness gives you.

## Merging

Merge each PR yourself once its checks are recorded and green (squash merge,
delete branch), then `git fetch origin main` and start the next group from it.
GitHub CI is manual-only, so a missing automatic check is expected; the PR
body is the evidence. After group D is merged, add a "Status" column to the
table in `docs/IMPROVEMENT-REPORT-2026-10-12.md` marking each item done or
skipped, update the operations manual note in `AGENTS.md` if any command
changed, and open one final small PR for that.

## Stop conditions

Stop and write the question to `docs/decisions-needed.md` (commit, push, end
your turn) only if: a fix requires a schema decision with two reasonable
answers that lose data either way; a test fails on `main` before your change;
or you cannot get any MariaDB verification for groups B or D. Everything else
is yours to decide.
