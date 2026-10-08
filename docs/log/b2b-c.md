# B2b-C — Filming plan, post-recording pack, repurposing (ideas 5, 6, 7)

## Built

- `/studio/plan` (idea 5, no AI): tick `ready` scripts (GET form, `?id=`), get a printable plan: order grouped
  by location/prop words in talking points, longest first; per-script words, spoken minutes (÷ 150), +50 %
  retakes; totals; on-screen text checklist; combined b-roll list. Print CSS hides header/form. `lib/studio/plan.ts`.
- `/studio/[id]/publish` (idea 6): YouTube URL (normalised, saved to `youtube_url`, status → posted);
  "Generate pack" → `structuredJson` → `PublishPack` in `publish_pack`; every field editable, copy buttons,
  "copy with chapters". Chapters are computed from section word counts; sources come from the script.
- `/studio/[id]/repurpose` (idea 7): "Make shorts" → 3–5 `ScriptBodyV1` shorts (1 min, 9:16 b-roll, parent's
  cited sources only), each a new draft `scripts` row with `parent_script_id`; blog post + newsletter blurb →
  `script_derivatives` (new row per run, newest shown), copy/download .md. `lib/studio/{pack,repurpose}.ts`.
- `publish.actions.ts`, `bridge/derivatives.ts`, 4 column setters + `listChildScripts` in `bridge/scripts.ts`,
  links on `/studio` and `/studio/[id]`, `dict/publish.ts` (en + sv).
- Tests: 19 unit (plan order/time math, chapters, tags, pack validation, URL, short assembly, prose),
  6 integration (`tests/integration/b2b-c.test.ts`).

## Decisions

- **Integration tests fake the model at the CLI seam**: `AI_PROVIDER=claude` + `CLAUDE_CLI_BIN` = a Node stub
  that answers by schema. That runs real `structuredJson` → `runCliJson` (§1.38). `ai-fake.ts` (not owned) was left alone.
- **The model never writes timestamps or URLs**: chapters come from word counts (150 wpm), the description's
  sources list and the blog's sources section come from `body.sources`.
- Generating is owner-only (spend, §1.20); saving a URL or an edited pack is any signed-in user.
- A short that fails the contract is counted and skipped, not saved; none valid → error, nothing saved.
- Clearing the URL keeps the status; the chapters in the description are joined on only when copied.

## Known issues

- `/studio/**` renders the header twice: `studio/layout.tsx` adds `<Header />` on top of the root layout's (S12's file).
- The Gemini fake has no pack/shorts/prose payloads, so under `AI_PROVIDER=gemini` + `GEMINI_FAKE` these calls throw.
- Setup detection is a fixed word list (en/es), so it can false-positive ("mate", "estudio").
- Creating a short and setting its parent are two writes (no transaction on the Neon driver).
- PLAN.md §9 index line not added (PLAN.md is not in this phase's Owns); no live model run (no credentials).

## Verification

CI green on `26e2cab` (PR #39, merged as `9982277`); `npm run verify` re-run on main after merge: unit 279, integration 149, build green.
