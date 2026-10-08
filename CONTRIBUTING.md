# Contributing

This repo is built in phases by Claude Code sessions, one phase per session and
per PR, from the prompt files in `prompts/`. `PLAN.md` holds the decisions (§1),
the phases (§5, §6) and the build log index (§9). A human contributor follows
the same rules.

## The autonomy protocol (PLAN.md §4, short form)

1. Work until the phase's exit criteria pass; in-plan work needs no permission.
2. One PR per phase, branch `phase/<id>` off latest main. Red CI is your own work.
3. Minor issues go in your `docs/log/<id>.md` "Known issues", not in chat.
4. Stop only for a missing credential with no fallback, or a foundation decision
   (schema, auth, money math, route contract) where a wrong guess forces a rewrite.
5. Stopping means: append the question to `docs/decisions-needed.md`, commit, push, end.
6. Missing env values never block: document in `.env.example`, degrade gracefully.
7. Prompts are re-runnable: check what exists, continue from the first unmet criterion.
8. Lane 2 never changes schema, auth, the spend cap, the ingest/analysis pipeline
   or `src/lib/ai.ts`. Data access goes through `src/lib/bridge/` and existing actions.
9. Fable/Mythos-class models are never used for phases, subagents or Routines.
10. Every paid call goes through `src/lib/ai.ts` and `withSpendCap`.
11. `npm run verify` passes before a PR is opened.
12. Done = PR merged green, exit checklist checked on main, one audit pass, log committed.
13. To change a later phase, edit its prompt file on main; never message a running session.

## File ownership

Each phase writes only to the files in its **Owns** column of the PLAN.md phase
table, plus its own `docs/log/<id>.md`, its own new files, one import line in
`src/lib/i18n/dictionary.ts`, and one line in `docs/decisions-needed.md`. On a
merge conflict main wins: re-apply your change on top. Never edit a file you do
not own to resolve a conflict — log it in `docs/decisions-needed.md` instead.

## Adding a dictionary file

UI copy lives in `src/lib/i18n/dict/<feature>.ts`, one file per feature:

```ts
export const en = {
  "research.title": "Competitor research",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "research.title": "Konkurrentanalys",
};
```

Then add one `import * as <feature> from "./dict/<feature>";` to
`src/lib/i18n/dictionary.ts` and spread `<feature>.en` / `<feature>.sv` into
`en` and `sv`. Most feature files already exist and are wired — just fill them.
Prefix every key with the feature name; `sv` is typed so a missing translation
fails `npm run typecheck`. Use keys through `t()`.

## Adding an integration test

Integration tests live in `tests/integration/<name>.test.ts` and run real SQL
against the Postgres in `DATABASE_URL` (never Neon — they wipe every table):

```ts
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { resetTables, teardown } from "./setup";

beforeEach(resetTables);
after(teardown);

test("what it proves", async () => { /* … */ });
```

- Gemini is faked automatically (`GEMINI_FAKE=1`, `src/lib/ai-fake.ts`):
  `fakeGeminiClient().calls` records what was sent; `resetFakeGemini()` clears it.
- To test a route, use `callRoute`, `jsonPost` and `signIn` from
  `tests/integration/route.ts` (real signed session cookie, no server).
- Run with `npm run test:db`. Unit tests (`src/**/*.test.ts`, no database) run
  with `npm test`.

## Writing a phase log

`docs/log/<id>.md`, written before the PR merges (format in `docs/log/README.md`):

- **Built** — at most 12 lines
- **Decisions** — at most 8 lines
- **Known issues** — at most 8 lines
- **Verification:** `CI green on <sha>`

Then add or update the phase's line in PLAN.md §9.
