# Handoff — the four gates, then spawn (PLAN.md §4.10)

A phase is done only when ALL of these hold:

1. **PR merged green** — CI (typecheck, unit, integration, build; lint once
   S9 adds it) passed on the merged head.
2. **Exit checklist passed** — every line of the phase's Exit in its prompt,
   checked against main after the merge, not against the branch.
3. **Pre-handoff audit** — ONE `npm run verify` on main, ONE adversarial
   re-read of the merged diff. Findings fixed in ONE follow-up commit (a
   second PR if the first is merged). No second round.
4. **Phase log committed** — `docs/log/<id>.md` per `docs/log/README.md`,
   plus the index line in PLAN.md §9.

Then, by lane:

- **Lane 1 (O4–O7):** spawn the next lane 1 phase with the claude-code-remote
  `create_session` tool — inherit environment and permission mode (never
  `plan`), `model` set explicitly to `claude-opus-5-5` (§1.37; never inherit, never Fable), `prompt` exactly
  `Read prompts/<next-file>.md in this repo and execute it.`
- **O8 (last lane 1 phase):** first create the watcher Routine with
  `create_trigger`: hourly cron, `create_new_session_on_fire: true`, model
  `claude-opus-5-5` (§1.37), prompt exactly
  `Read prompts/_watcher.md in this repo and execute it.` Then spawn S5, S6,
  S8, S10 — up to 4 concurrent sessions (the watcher starts S11, S12 as
  slots free), each on Opus 5.5 (`claude-opus-5-5`), same `prompt`
  pattern with its own file.
- **Lane 2 (S5, S6, S8, S10–S12):** spawn nothing. End with the phase report.
- **S9:** delete the watcher Routine (`delete_trigger`), then STOP with the
  closing report to Anton.

Fallback when `create_session` is unavailable (local CLI): same model → the
next phase may continue in this window; model switch → stop and report the
line Anton pastes.

Never message a running session. To change what a later phase will do, edit
its prompt file on main (§4.14).
