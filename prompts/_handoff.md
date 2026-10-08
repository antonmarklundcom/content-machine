# Handoff — the four gates, then spawn (PLAN.md §4.10, build 3)

A phase is done only when ALL of these hold:

1. **PR merged green** — CI (typecheck, lint, unit, integration, build) passed on the merged head.
2. **Exit checklist passed** — every line of the phase's Exit, checked against main after the merge.
3. **Pre-handoff audit** — ONE `npm run verify` on main, ONE adversarial re-read of the merged
   diff. Findings fixed in ONE follow-up commit (a second PR if the first is merged). No second round.
4. **Phase log committed** — `docs/log/<id>.md` per `docs/log/README.md`, plus the index line in PLAN.md §9.

**Never end your turn while CI is running.** An idle spawned session is never woken again, so a
phase that stops to "wait for CI" stalls the whole chain. Re-check the PR's check runs in the same
turn (a short `sleep` loop in Bash, a Monitor, or `send_later` if you have it) until they finish,
then merge and spawn. Cloud sessions cannot clone other repos (e.g. paraguayresidency); use what
is committed here.

**Never ask for a go-ahead.** When the four gates pass, spawn the next phase(s) in that same turn.
Nobody reads a spawned session's questions; a "reply go to continue" stalls the build.

Every spawn uses the claude-code-remote `create_session` tool with: `source_url`
`https://github.com/antonmarklundcom/content-engine`, inherited environment and permission mode
(never `plan`), `model` exactly `claude-opus-5-5` (§1.37, never inherit, never Fable), and `prompt`
exactly `Read prompts/<file>.md in this repo and execute it.`

Then, by phase:

- **O9** → spawn `prompts/opus-10-media-storage.md`.
- **O10** → spawn `prompts/opus-11-post-engine.md`.
- **O11** → spawn ALL of lane 2 at once (seven `create_session` calls):
  `sonnet-13-brands-accounts.md`, `sonnet-14-media-library.md`, `sonnet-15-posts-calendar.md`,
  `sonnet-16-telegram-capture.md`, `sonnet-17-clip-fetch.md`, `sonnet-18-facts-hooks.md`,
  `sonnet-19-docs.md`.
- **S13–S19** → check the PRs of the other six lane 2 phases (by branch `phase/s<n>-…`, or `S<n>` /
  the prompt file name in the PR title or body). If ALL are merged AND no branch or PR for S20
  exists yet → spawn `prompts/sonnet-20-link-pass.md`. Otherwise spawn nothing.
- **S20** → spawn `prompts/opus-12-meta-insights.md`, then end with the lane 2 closing report.
- **Lane 3** (built against recorded fixtures; live paths UNVERIFIED until §7 items 7–8): **O12** → spawn `opus-13-publishing.md` AND `sonnet-21-ig-competitors.md`;
  **O13** → spawn `opus-14-hostinger-deploy.md`; **O14**, **S21** → spawn nothing, report.

Fallback when `create_session` is unavailable (local CLI): continue in this window with the next
lane 1 phase, or stop and report the exact line Anton pastes.

There is no watcher (§1.53). Never message a running session. To change what a later phase does,
edit its prompt file on main (§4.14).
