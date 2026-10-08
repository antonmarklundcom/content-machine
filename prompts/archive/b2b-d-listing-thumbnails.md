# Build 2b · D — Propia listing → script, thumbnails → Higgsfield (ideas 8, 10). OPUS 5.5 session.

Read: this file, `PLAN.md` §1 (27–38), §4, `src/lib/scripts/contract.ts`, `src/lib/bridge/scripts.ts`,
`src/lib/ai.ts` (`structuredJson`, `generateScript`), `src/lib/scripts/export.ts`,
`.claude/commands/higgsfield-shots.md`, `docs/HIGGSFIELD.md`. Branch `b2b/d-listing`.

Owns: `src/lib/studio/listing.ts` (+ test), `src/app/studio/listing/**`, `src/components/Listing*.tsx`,
`src/lib/listing.actions.ts`, `src/lib/scripts/export.ts` (add `format=thumbnails` only),
`src/app/api/scripts/[id]/export/**` (accept the new format), `src/app/api/media/**` (new),
`src/app/studio/[id]/thumbnails/**`, `src/components/Thumbnail*.tsx`, one "Thumbnails" link on
`src/app/studio/[id]/page.tsx`, one "From a listing" link on `src/app/studio/page.tsx`,
`.claude/commands/higgsfield-thumbnails.md` (new), `docs/HIGGSFIELD.md` (append a section),
`src/lib/i18n/dict/listing.ts` + import line, `tests/integration/b2b-d.test.ts`, `docs/log/b2b-d.md`.

Build:
1. **Listing → script (idea 8).** `/studio/listing`: paste a propia.com.py (or any) listing URL →
   server fetch with a 10 s timeout, parse og:title/description/image and any JSON-LD
   (`RealEstateListing`/`Offer`/`Product`: price, currency, address, rooms, area, images) into editable
   fields; or fill the form by hand. "Write short" (60–90 s, 9:16) or "Write tour" (3–5 min) →
   `structuredJson` → valid `ScriptBodyV1` for brand `propia` by default, b-roll shots referencing the
   listing's own photo URLs first, Higgsfield prompts only for extra shots; price/fees flagged
   verifyBeforeRecording. Saved as a draft script → redirect to `/studio/[id]`.
2. **Thumbnails (idea 10).** Export `format=thumbnails`: the 3 concepts as numbered prompts (16:9) with
   text overlay and suggested file `media/<id>/thumbnails/<n>.png`. `.claude/commands/higgsfield-thumbnails.md`:
   same rules as higgsfield-shots (recommend step, cheapest fitting model, batch, `jobs_wait`, manifest), 2
   variants per concept, saves into that folder. `/api/media/[...path]`: owner-only, serves files under
   `<repo>/media` only (reject `..`, absolute paths, symlinks outside). `/studio/[id]/thumbnails` shows
   the images found, "Use this one" sets `scripts.thumbnail_file`.
3. Tests: listing HTML/JSON-LD parser unit tests (fixtures), media route path-traversal tests, export test.

Exit: `npm run verify` green; PR merged on green (authorized) or pushed + ended. Log `docs/log/b2b-d.md`.
