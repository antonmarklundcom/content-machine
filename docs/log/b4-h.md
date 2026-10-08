# B4-H — Higgsfield bridge (Claude Code + Higgsfield MCP)

Worktree branch from 991ef68 (foundation with `higgsfield_jobs`, migration 0010). Opus 5.5, medium.

## Built
- `src/lib/higgsfield/run.ts` — runner: `startJob` (row queued → spawn `claude -p --output-format
  stream-json --verbose` in the repo, prompt on stdin → running with pid → done/failed/cancelled),
  `cancelJob`, `retryJob`, `reapJobs`, `listJobs`, `getJob`, `jobsForTarget`, `settleRuns`.
  Timeout `HIGGSFIELD_JOB_TIMEOUT_MIN` (30) kills the process tree; media scan after every run.
- One run per target: active-row check + lease `higgsfield:<targetRef>` (`higgsfield:import` for
  imports; free prompts are not serialised). The reaper fails dead-pid/stale rows and drops their lease.
- `prompt.ts` — slash command + inline brief + run rules (verbatim ceiling text, MEDIA_ROOT, curl
  form, `HF_*` lines) and the `--allowedTools` set; `brief.ts` builds the brief with
  `exportBrief`/`shotList`/`thumbnailList` (no session cookie needed); `stream.ts` incremental
  stream-json parser (bounded 12k log tail, job ids, files, credits, permission denials).
- `preflight.ts` — MEDIA_ROOT, `claude --version`, a one-word `claude -p` ping (login), `claude mcp
  list` (local servers or a `claude.ai …` connector); each failure maps to a plain fix in the dict.
- `/higgsfield` page: preflight panel (on demand), free-prompt form, history import, runs list
  (kind, target link, status, credits used/ceiling, times, thumbnails via `/api/media/<path>`, job
  ids, error, log tail, prompt, cancel/run again), auto-refresh while a run is active.
- `HiggsfieldGenerateButton` (kind, targetRef, brandId, defaultMaxCredits): asks for the ceiling,
  starts, polls `GET /api/higgsfield/jobs/[id]` (owner-only, prompt omitted).
- `src/lib/higgsfield.actions.ts` (owner-only preflight/start/cancel/retry), `dict/higgsfield.ts`
  (en + sv), `scripts/higgsfield-run.ts` (`--kind --target --max-credits`, `--preflight`, Ctrl+C
  cancels), `scripts/higgsfield-reap.ts`.
- Commands: `HF_*` progress lines, the curl download form and "run rules win" added to all four;
  new `/higgsfield-free` (inbox folder + manifest with optional brandId). `docs/HIGGSFIELD.md`
  "Generate from the app".
- Tests: 18 unit (prompt, config, stream-json with a sample run, preflight parsing + fake CLI) and
  11 integration (`b4-h-runner`: done, post brief inline, failed result, crash, timeout, cancel,
  busy target, lease race, reaper, missing binary/drive, retry, owner gate on actions + route).

## Decisions
- Prompt goes on **stdin**, not as `claude -p "<prompt>"`: briefs are long and cmd.exe has an
  8191-char limit and no safe quoting; ai-cli.ts does the same. The prompt still starts with the
  slash command; a fallback line says to read the command file if it was not expanded.
- Permissions: `mcp__<server>` (all tools of that server), `Read/Write/Edit(//<MEDIA_ROOT>/**)`,
  `Read(.claude/commands/higgsfield-*.md)`, `Bash(curl -fsSL --create-dirs -o "<MEDIA_ROOT>/:*)`.
  Server names come from `HIGGSFIELD_MCP_SERVER`, else `claude mcp list`, else `higgsfield`.
- The CLI's env drops the app's secrets (`*SECRET*`, `*TOKEN*`, `DATABASE_URL`, `*_KEY`) but keeps
  `CLAUDE_*`/`ANTHROPIC_*`. Binary: `CLAUDE_CLI_PATH` → `CLAUDE_CLI_BIN` → `claude`; a `.mjs`
  path runs under Node (the fake). Spawn helper copied into `process.ts` (ai-cli.ts untouched).
- The login check is a real one-word ping (only on "Check now"), not a credentials-file guess.
- The scan after a run is the whole-root `scanMediaRoot()` (idempotent; scan.ts has no folder
  parameter and is not this phase's file).
- `free` runs land in `_inbox/higgsfield/<date>/` with `brandId` in the manifest when a brand is
  picked, so they are registered for that brand (and so are not listed as unsorted).
- Imports take ceiling 0 (they spend nothing); other kinds need > 0, max 2000.
- `node_modules/next/dist/docs/` does not exist in this install (Next 15.5.24); routes/actions follow
  the repo's existing patterns.

## Known issues
- **Live run UNVERIFIED**: no Claude login or Higgsfield MCP here. Unverified against the real CLI:
  slash-command expansion from stdin in `-p` mode, the `mcp__<server>` / `//path` / `Bash(prefix:*)`
  rule matching (incl. the quote in the curl prefix), `claude mcp list` output format and whether
  it lists claude.ai connectors, the `get_cost` tool name (the prompt allows the MCP's quote/price).
- The ceiling is an instruction to Claude plus a post-hoc check of what it reports; Higgsfield does
  not enforce it. Overspend is only logged.
- Your own Claude Code allow rules (user/project settings) still apply on top of `--allowedTools`.
- Reaper uses pid liveness: a reused pid keeps a dead run `running` until the timeout grace.
- A run killed by an app restart is not resumed; the commands resume from their manifest on retry.
- Build 2 script paths (`media/<id>/…`) are relative to the repo when run by hand; the run rules map
  them onto MEDIA_ROOT. With MEDIA_ROOT elsewhere, hand runs and app runs write to different places
  (pre-existing; `/api/media/…` serves from MEDIA_ROOT).

## Link pass
- `package.json` scripts: `"higgsfield:run": "tsx --conditions=react-server scripts/higgsfield-run.ts"`,
  `"higgsfield:reap": "tsx --conditions=react-server scripts/higgsfield-reap.ts"`.
- Header nav: link `/higgsfield` (label key `higgsfield.title`), owner only; optional home card.
- Mount `<HiggsfieldGenerateButton kind="post" targetRef={`post:${id}`} brandId={post.brandId}
  defaultMaxCredits={defaultMaxCredits()} />` on `/posts/[id]` (owner only), and
  `kind="script_shots"` / `kind="script_thumbnails"` with `targetRef={`script:${id}`}` on
  `/studio/[id]` and `/studio/[id]/thumbnails`. `defaultMaxCredits` from `@/lib/higgsfield/config`.
- `.env.example`: `CLAUDE_CLI_PATH`, `HIGGSFIELD_JOB_TIMEOUT_MIN=30`,
  `HIGGSFIELD_DEFAULT_MAX_CREDITS=20`, `HIGGSFIELD_MCP_SERVER=` (optional), `HIGGSFIELD_CLAUDE_MODEL=`.
- KNOWN-ISSUES: "Higgsfield bridge live run UNVERIFIED" (see above).
- Optional: a folder-scoped variant of `scanMediaRoot()` so a run only scans what it wrote.

## Verification
`npm run typecheck` and `npm run lint` clean; `npm test` 379/379; `npm run test:db` 269/269
(DB `content_engine_h`). `npm run build` not run (per instructions).
