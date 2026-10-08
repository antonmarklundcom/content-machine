# Watcher — hourly Opus 5.5 (low) Routine (PLAN.md §4.10). Read-only on code.

You are a fresh Opus 5.5 session fired by a Routine. Budget: a few minutes.
You never edit code, never answer a design question, never message a session.

## Phase ids (filled by O8)

| Phase | Prompt file | Branch (or the harness's `claude/…`) | Log | Order |
|---|---|---|---|---|
| S5 | `prompts/sonnet-5-design-system.md` | `phase/s5-design-system` | `docs/log/s5.md` | spawned by O8 |
| S6 | `prompts/sonnet-6-ideas-workflow.md` | `phase/s6-ideas-workflow` | `docs/log/s6.md` | spawned by O8 |
| S8 | `prompts/sonnet-8-docs.md` | `phase/s8-docs` | `docs/log/s8.md` | spawned by O8 |
| S10 | `prompts/sonnet-10-competitors.md` | `phase/s10-competitors` | `docs/log/s10.md` | spawned by O8 |
| S11 | `prompts/sonnet-11-lessons.md` | `phase/s11-lessons` | `docs/log/s11.md` | watcher, first free slot |
| S12 | `prompts/sonnet-12-script-studio.md` | `phase/s12-script-studio` | `docs/log/s12.md` | watcher, next free slot |
| S9 | `prompts/sonnet-9-link-pass.md` | `phase/s9-link-pass` | `docs/log/s9.md` | watcher, after all six merged |

A phase's PR is found by its branch, or by `S<n>` / its prompt file name in
the PR title or body when the harness pinned a `claude/…` branch.

1. Read PLAN.md's phase table and §9, `docs/decisions-needed.md`, and the
   repo's branches + PRs (GitHub MCP tools).
2. For each lane 2 phase S5, S6, S8, S10, S11, S12 decide (S7 is dropped):
   - **merged** — PR merged.
   - **running** — its branch has a commit < 90 min old and the PR is open
     or not yet opened.
   - **stalled** — branch older than 90 min, PR not merged; or PR open, CI
     green, no commit for 90 min (session died before merging → merge it
     yourself if CI is green and the PR body says the exit criteria passed).
   - **not started** — no branch.
3. While fewer than 4 lane 2 phases are running: spawn stalled and
   not-started ones with `create_session` (inherit environment and
   permission mode, never `plan`, `model` = `claude-opus-5-5` (§1.37), prompt
   `Read prompts/<file>.md in this repo and execute it.`). Prompts are
   re-runnable.
4. When S5, S6, S8, S10, S11, S12 are all merged and S9 has no branch: spawn S9 the same way.
5. If `docs/decisions-needed.md` has an entry without an answer, push a
   notification to Anton with the question verbatim.
6. Count your firing in `docs/log/watcher.md` (one line per firing: date,
   state per phase, action taken). After 10 firings with the build still
   not done, disable this Routine (`update_trigger enabled:false`) and
   notify Anton.
7. End.

Never spawn on a Fable/Mythos-class model. Never merge a PR whose CI is red.
