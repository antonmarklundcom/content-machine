# Build 2b · C — Filming plan, post-recording pack, repurposing (ideas 5, 6, 7). OPUS 5.5 session.

Read: this file, `PLAN.md` §1 (27–38), §4, `src/db/schema.ts` Build 2b block,
`src/lib/studio/types.ts`, `src/lib/scripts/contract.ts`, `src/lib/bridge/scripts.ts`,
`src/app/studio/**` (how pages/actions are built), `src/lib/ai.ts` (`structuredJson`,
`generateScript` for prompt style). Branch `b2b/c-publish`.

Owns: `src/lib/studio/plan.ts`, `src/lib/studio/pack.ts`, `src/lib/studio/repurpose.ts` (+ tests),
`src/lib/bridge/derivatives.ts`, `src/app/studio/plan/**`, `src/app/studio/[id]/publish/**`,
`src/app/studio/[id]/repurpose/**`, `src/components/StudioPlan*.tsx`, `src/components/Publish*.tsx`,
`src/components/Repurpose*.tsx`, `src/lib/publish.actions.ts`, `src/lib/bridge/scripts.ts`
(add setters for the four new columns only), one link row on `src/app/studio/[id]/page.tsx`
("Publish pack", "Repurpose"), and one "Plan a filming day" link on `src/app/studio/page.tsx`,
`src/lib/i18n/dict/publish.ts` + import line, `tests/integration/b2b-c.test.ts`, `docs/log/b2b-c.md`.

Build:
1. **Filming plan (idea 5)** — deterministic, no AI. `/studio/plan`: tick `ready` scripts → a printable
   page: order (group by location/props words found in talking points, then by length), per script
   spoken minutes (words ÷ 150), total time incl. 50 % retakes, a checklist of on-screen text and a
   combined b-roll list. Print CSS so it prints clean.
2. **Post-recording pack (idea 6).** `/studio/[id]/publish`: paste the YouTube URL (saved to
   `youtube_url`), "Generate pack" → `structuredJson` → `PublishPack` (description with CTA and
   sources, chapters from section word counts at 150 wpm, 10–15 tags, pinned comment, IG/FB/TikTok
   captions in the script language) → saved to `publish_pack`, editable fields, copy buttons, and
   status → posted when the URL is saved.
3. **Repurpose (idea 7).** `/studio/[id]/repurpose`: "Make shorts" → 3–5 short scripts (60 s, 9:16
   b-roll) each saved as a new `scripts` row (valid `ScriptBodyV1`, `parent_script_id` set, status
   draft); "Blog post" and "Newsletter blurb" → Markdown in `script_derivatives`, shown with copy/download.
   All AI via `structuredJson` so subscription mode works.
4. Tests: plan ordering + time math unit tests; pack/repurpose integration with the fake.

Exit: `npm run verify` green; PR merged on green (authorized) or pushed + ended. Log `docs/log/b2b-c.md`.
