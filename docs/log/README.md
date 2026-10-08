# Phase logs

One file per phase, `<id>.md` (e.g. `o4.md`, `s6.md`). Written before the
phase's PR merges (PLAN.md §4.11):

- **Built** — ≤ 12 lines
- **Decisions** — ≤ 8 lines
- **Known issues** — ≤ 8 lines
- **Verification:** CI green on `<sha>`; screenshots in the PR's CI artifact

Add the index line to PLAN.md §9. A fresh session reads only the logs named
in its prompt's "Depends on".
