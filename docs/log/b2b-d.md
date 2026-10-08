# B2b-D — Propia listing → script, thumbnails → Higgsfield (ideas 8, 10)

Branch `b2b/d-listing` (Opus 5.5).

## Built

- `/studio/listing` (`ListingForm`): paste a listing URL → `readListing` fetches it (10 s timeout, manual redirects with every hop's host checked, LAN/localhost refused, HTML only, 3 MB cap) and parses og:/twitter: tags + JSON-LD (`RealEstateListing`/`Offer`/`AggregateOffer`/`Product` and the accommodation types they nest; never the seller's/agency's address) into editable fields; or fill by hand.
- "Write short" (1.5 min, 9:16) / "Write tour" (4 min, 16:9) → `writeListingScript`: owner-only, `structuredJson` with O8's `SCRIPT_JSON_SCHEMA`, no web search (the listing is the source), `assembleScriptBody` → `finishListingScript` → contract-valid draft for `propia` by default → `/studio/<id>`.
- `finishListingScript` (pure): "PHOTO Pn" → `LISTING PHOTO (download, do not generate): <url>`; listing photos are used first, Higgsfield prompts only beyond them; one aspect ratio per mode; the listing is source `listing` with `verifyBeforeRecording`, cited by every section that mentions a price/fee (no URL → a VERIFY talking point instead).
- Export `format=thumbnails` (`thumbnailList`/`thumbnailListMarkdown`): 3 numbered 16:9 prompts with the text overlay built in, files `media/<id>/thumbnails/<n>.png` + `<n>-2.png`; Markdown + fenced JSON, `&as=json`, `&download=1`.
- `.claude/commands/higgsfield-thumbnails.md` (recommend → cheapest that renders text → one batch + `jobs_wait` → manifest, 2 variants/concept); `docs/HIGGSFIELD.md` sections for thumbnails and listing photos.
- `/api/media/[...path]` (owner-only) via `src/lib/studio/media.ts`: segment checks, root containment, realpath containment (symlinks out → 404), regular files, image/video/manifest types only, streamed.
- `/studio/[id]/thumbnails`: prompts copy/download, images found, "Use this one"/"Clear choice" → `chooseThumbnail` (owner-only, name must be in the folder listing) → `bridge/thumbnails.ts` → `scripts.thumbnail_file`.
- Links: "Thumbnails" on `/studio/[id]`, "From a listing" on `/studio`. Copy in `dict/listing.ts` (en + sv).
- Tests: `src/lib/studio/listing.test.ts` (parser fixtures, fetch/timeout/redirects, post-processing), `src/lib/scripts/export-thumbnails.test.ts`, `tests/integration/b2b-d.test.ts` (listing → draft via fake Gemini, owner gates, export route, 15 media traversal cases, thumbnail pick).

## Decisions

- Photo shots are marked inside `imagePrompt` (the v1 contract has no URL field; a new field would be contract v2).
- New own files for what Owns did not cover: `src/lib/studio/media.ts`, `src/lib/bridge/thumbnails.ts`, `src/lib/thumbnails.actions.ts`, `src/components/ThumbnailExport.tsx`.
- Picking a thumbnail is owner-only, like viewing the media; the stored value is always `media/<id>/thumbnails/<name>` built from a listed name.
- `MEDIA_ROOT` env overrides `<repo>/media` (tests; a media folder elsewhere on the PC).

## Known issues

- `/higgsfield-shots` (S12's file, not owned) does not yet know the `LISTING PHOTO` prefix; `docs/HIGGSFIELD.md` says to tell it. Worth one line in that command.
- The LAN check is on the literal host; a public name resolving to a private IP is not caught (signed-in only, local app).
- `/studio/**` renders the header twice (root layout + studio layout) — pre-existing, seen on `/studio` too.
- `StudioExports` (S12) does not list the thumbnails format; it lives on `/studio/[id]/thumbnails` instead.
- No §9 index line: `PLAN.md` is not in this phase's Owns.
- No live listing fetch or live model run here; verified with fixtures and the Gemini fake.

## Verification

`npm run verify` green locally against Postgres 16; Playwright pass over `/studio`, `/studio/listing` → Write short → `/studio/<id>` → Thumbnails → "Use this one" (stored `media/<id>/thumbnails/…`).
