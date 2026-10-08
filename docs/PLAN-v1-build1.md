> **Archived 2026-09-11.** This is build 1's plan, kept verbatim. Code comments that cite `PLAN.md §…` for O1–O3/S3 decisions refer to the section numbers in THIS file. The live plan is the root `PLAN.md` (build 2); the review that produced it is `docs/REVIEW-2026-09-11.md`.

# PLAN — content-engine: wire the two halves + clip inbox (phased autonomous build)

One Next.js app on Vercel + Neon, two halves: the brand ideation tool
(`brands`/`research_notes`/`ideas`, `/api/generate`) and the YouTube research
tool (`/youtube/*`, `sources`→`videos`→`transcripts`→`analyses`→`topics`/
`entities`). They share a repo, deploy, login, and Gemini client — and no
data. This plan wires them together and adds the save-clip inbox, as a
sequence of autonomous phases: one PR each, all Opus phases first, then all
Sonnet phases.

| Phase | Model | Prompt file | Plan sections |
|---|---|---|---|
| O1 | Opus | `prompts/opus-1-foundation.md` | §5.O1 |
| O2 | Opus | `prompts/opus-2-capture-bridge.md` | §5.O2 |
| S3 | Sonnet | `prompts/sonnet-3-inbox-ui.md` | §6.S3 |
| O3 | Opus | `prompts/opus-3-gemini-migration.md` | §5.O3 (decided 2026-08-29 — see §8) |
| S4 | Sonnet | `prompts/sonnet-4-worker-igfb.md` | §6.S4 (conditional — see §1.9) |

---

## §1. Decisions already made — do not re-litigate

1. **Home is Vercel + Neon.** Hostinger's existing Node slot is only a
   background worker (webhook-triggered from the app, never cron-polling),
   and only if/when a job needs it. Not a second app.
2. **No GitHub Actions dependency at runtime.** Actions is CI only
   (typecheck/build on push). Nothing the app needs to function may require
   an Actions run.
3. **Linkage is asymmetric.** `ideas.source_analysis_id` (nullable, →
   `analyses.id`) is the only new cross-half link. Pointing at the analysis,
   not the video, records exactly which payload grounded the idea (analyses
   are append-only/versioned). **No `brand_id` on `videos`/`sources`** —
   nothing writes it, nothing reads it, and one-to-one contradicts the
   `relatedBrandIds`-array precedent. If videos→brand is ever needed, it's a
   join table added then.
4. **House convention: no FK constraints.** Soft links + drizzle `relations`
   only (see the comment above `sourcesRelations` in `src/db/schema.ts`).
   Ingest is idempotent and out-of-order; keep it that way.
5. **The `brands` DB table becomes the single source of truth.** The
   hardcoded `BRANDS` constant in `src/lib/brands.ts` is retired; a seed
   script owns initial rows. `/api/generate` reads the table.
6. **Capture before processing.** The clips inbox (capture, time-sensitive —
   unlogged clips are lost forever) ships before/alongside seed-from-video
   (processing over stored data, which doesn't decay). The inbox lives or
   dies on phone ergonomics: share-sheet/shortcut capture, not
   "open the app and paste".
7. **A clip saved with zero fetched metadata must still be useful**: the
   save payload includes an optional one-line `note` ("why I saved this").
   IG/FB metadata fetch is best-effort (Meta gates oEmbed; scraping from
   datacenter IPs is unreliable) — the URL + note is the guaranteed floor.
8. **No audio transcription for IG/FB clips in this build** (~20x the cost
   of a captions-based analysis). Metadata + note only; revisit later (§10).
9. **The caption probe is a decision gate for S4 only.** O1–S3 do not depend
   on it. S4 (Hostinger worker) is built only if the probe run from Vercel
   comes back blocked, or a job genuinely needs the worker.
10. **Spend goes through one cap.** `/api/generate`'s paid web-search calls
    join the YouTube half's `spend_log`/`withSpendCap` machinery.
11. **Model rule:** phases run on Opus or Sonnet exactly as the table says.
    Fable/Mythos-class models are never used for phases, subagents, or
    spawned sessions — if one ever seems needed, stop and ask Anton.

## §2. Roles & object model

Unchanged from what exists: `yt_users` with `owner`/`employee` roles guards
the whole app (`src/middleware.ts`); owner spends money and deletes. New
objects this build adds:

- **`clips`** — one row per saved link. `id`, `url` (unique), `platform`
  (`youtube` | `instagram` | `facebook` | `other`, derived from the URL),
  `note` (nullable text), `title`/`author`/`thumbnail_url` (nullable,
  best-effort fetched), `status` (`unprocessed` | `ingesting` | `analyzed` |
  `promoted` | `failed`), `video_id` (nullable soft link once a YouTube clip
  is ingested), `idea_id` (nullable soft link once promoted), `error`
  (nullable), `saved_at`. Indexed on `status`, `saved_at`.
- **`ideas.source_analysis_id`** — nullable integer, soft link to
  `analyses.id`. Sits beside the existing `researchNoteId` precedent.
- Identifiers in English; UI copy matches the app's existing conventions.

## §3. Feature scope

Dependency-grouped:

- **A. Foundation** (O1): brands table as source of truth; `clips` table +
  `ideas.source_analysis_id` migration; unified spend cap.
- **B. Capture + bridge** (O2, needs A): token-authed save-clip route;
  YouTube clips auto-route through existing ingest; "promote" endpoint
  (marked unit / analysis idea → `ideas` row for a chosen brand); optional
  seed-from-analysis path in `/api/generate`.
- **C. Surfaces** (S3, needs B): inbox list view; promote/seed UI; PWA
  `share_target` + iOS Shortcut capture path.
- **D. Worker + IG/FB** (S4, needs C; conditional per §1.9): Hostinger
  webhook worker; best-effort IG/FB metadata fetch (worker-side, since
  Meta blocks datacenter IPs even harder than YouTube does).

## §4. Autonomy protocol

Every phase session works under these rules; each prompt re-states the ones
it most needs.

1. Work until the phase's exit criteria all pass; never ask permission for
   in-plan work.
2. One PR per phase: branch `phase/<id>` off latest main; create, watch, and
   merge the PR when green. A red build is always this session's own work.
   Never start on top of an unmerged previous phase.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or
   a bad-foundation decision (schema shape, auth, money math) where guessing
   wrong forces a rewrite. Everything else: choose reasonably, record in §9,
   continue.
5. Missing env values never block: document in `.env.example`, degrade
   gracefully.
6. Every prompt is re-runnable: check what exists on the branch first,
   continue from the first unmet exit criterion.
7. Sonnet phases (S3/S4) hard limits: no schema, auth, spend-cap, or
   ingest/analysis-pipeline changes. Data access only through the query/
   action layer O1/O2 built. Blocked by the limit → workaround + §10 note.
8. Model cost guardrail: Opus and Sonnet only, per §1.11. Spawning anything
   on a Fable/Mythos-class model without Anton's explicit approval is
   treated like a destructive action.
9. Phase handoff — only when four gates pass: PR merged green; exit
   checklist passed; pre-handoff audit done (re-run build/lint/typecheck,
   adversarially re-read your own merged diff, fix findings); §9 build-log
   entry committed. Then spawn the next phase as a NEW session via the
   claude-code-remote `create_session` tool: inherit environment and
   permission mode (never `plan`), set `model` per the phase table, prompt
   exactly `Read prompts/<next-file>.md in this repo and execute it.`
   Fallback without `create_session` (local CLI): same model → continue in
   this window; model switch → stop and report.
10. Build log: before merging, append a 5–10 line dated entry to §9 — phase
    id + PR, what now exists, decisions/deviations, where the next phase
    should look first. Fresh sessions orient from this file + §9 +
    `KNOWN-ISSUES.md` only.

## §5. Opus phases

### O1 — Foundation: one source of truth, the migration, one spend cap

1. **Brands reconciliation.** Retire the `BRANDS` constant: `/api/generate`
   (and anything else importing `src/lib/brands.ts`) reads the `brands`
   table. Move the constant's data into `src/db/seed.ts` (idempotent
   upsert). Keep the exported `Brand` type where the prompt-building code
   needs it.
2. **Migration** (drizzle-kit, one migration): `clips` table per §2;
   `ideas.source_analysis_id`. No FK constraints (§1.4); add drizzle
   `relations` (clip→video, clip→idea, idea→analysis).
3. **Unified spend.** Route `/api/generate`'s Anthropic call through the
   same `withSpendCap`/`spend_log` path the YouTube half uses
   (`src/lib/.../spend.ts`). Its cost lands in the same daily log and
   respects the same cap.
4. **Query layer.** Small server-side module (e.g. `src/lib/bridge/`)
   exposing exactly what later phases need: list clips by status; get an
   analysis payload + its marked units for a video; list a user's
   `video_unit_marks` with video context. S3 may only read through this.

Exit: migration applied to Neon; `npm run build` + lint + typecheck green;
seed script run against dev DB; `/api/generate` works with the constant gone
and logs spend; PR merged.

### O2 — Capture + bridge

1. **Save-clip route** `POST /api/clips`: body `{ url, note? }`. Auth:
   existing session cookie OR `Authorization: Bearer <CLIP_TOKEN>` (new env
   var, documented in `.env.example`) so share-sheet/Shortcut flows work
   without a cookie. Dedupe on URL (re-save updates `note`, doesn't
   duplicate). Derive `platform` from the URL.
2. **YouTube wiring.** A YouTube clip immediately reuses the existing
   by-URL ingest path (captions + screening/analysis as configured) —
   status `ingesting` → `analyzed`, `video_id` set. Never a second
   pipeline. Non-YouTube: store with metadata floor per §1.7, stay
   `unprocessed`.
3. **Promote endpoint.** `POST /api/ideas/promote`: from a
   `video_unit_mark` or one entry of `analyses.ideas`, plus a `brandId` and
   format/platform, insert an `ideas` row (status `proposed`,
   `source_analysis_id` set). One cheap Anthropic call MAY adapt the copy to
   the brand's voice/language (through the spend cap); no web search.
4. **Seed-from-analysis in `/api/generate`.** Optional `analysisId` in the
   body: the stored payload (summary/takeaways/topics) goes into the prompt
   as grounding, replacing or supplementing web search. Ideas produced this
   way carry `source_analysis_id`.

Exit: build/lint/typecheck green; saving a YouTube URL via Bearer token ends
`analyzed` with a linked video (verified against dev DB); promote inserts a
correctly-linked idea; `/api/generate` with `analysisId` produces grounded
ideas; PR merged.

### O3 — Provider migration: Anthropic → Gemini

**Decided 2026-08-29** (resolves the §8 parked question — Anton confirmed:
move off Anthropic, on cost). Opus, not Sonnet: this touches money math and
every paid-call path at once, the same bar O1 was held to.

Every paid call in the app moves from the Anthropic API to Gemini. Money math
must stay at least as trustworthy after the swap as before it — a wrong rate
here silently under-reports spend and the cap trips too late.

1. **Client swap.** Replace `src/lib/anthropic.ts`'s `@anthropic-ai/sdk`
   client with the Gemini SDK (`@google/genai` or current first-party
   equivalent — check `claude-api`-adjacent docs/the Gemini API docs for the
   current package name before installing). Both call sites it exports —
   `generateContentPlan` (brand ideation, `/api/generate`) and
   `adaptIdeaToBrand` (promote) — keep their existing signatures; only what's
   inside changes. Env var renamed `ANTHROPIC_API_KEY` → `GEMINI_API_KEY`
   (or the SDK's expected name), `ANTHROPIC_MODEL` → `GEMINI_MODEL`,
   `ANTHROPIC_PROMOTE_MODEL` → `GEMINI_PROMOTE_MODEL`. Update every reference
   (`src/lib/anthropic.ts`, `src/app/api/generate/route.ts`, `promote.ts`)
   and consider whether the module is worth renaming (`src/lib/anthropic.ts`
   → `src/lib/ai.ts` or similar) — a rename is fine here since every call site
   already goes through this one module (that discipline is why O2 flagged
   not to deepen the coupling further).
2. **Analysis/screening pipeline.** `src/lib/analysis/run.ts`,
   `src/lib/analysis/batch.ts`, `src/lib/screening/run.ts` and
   `src/lib/screening/sql.ts` currently call the Anthropic client directly
   (`anthropic` export from `run.ts`) for the YouTube summarise/screen paths,
   and `batch.ts` specifically relies on Anthropic's Batch API for its flat
   50% discount. Gemini has its own batch API with a comparable discount —
   confirm the current rate and request/response shape before wiring it in;
   do not assume feature parity, verify against the docs.
3. **Web search → Search grounding.** `/api/generate`'s research step uses
   Anthropic's server-side `web_search` tool (`web_search_20260209`,
   `MAX_WEB_SEARCHES = 8`, billed via `WEB_SEARCH_USD_PER_REQUEST` in
   `pricing.ts`). Replace with Gemini's Search grounding tool. Its billing
   model differs from Anthropic's per-request fee — read the current pricing
   page, don't guess, and update `WEB_SEARCH_USD_PER_REQUEST` (rename if the
   unit changes, e.g. per-grounded-query vs per-request) to match.
4. **Pricing table.** `src/lib/analysis/pricing.ts`'s `MODEL_RATES`,
   `IDEATION_MODEL_RATES`, and `ideationRates()`'s unknown-model fallback all
   assume Anthropic model names/rates. Replace with the Gemini models
   actually used (research current model + pricing pages, for whichever tier
   maps to today's Opus/Sonnet/Haiku roles) and their real per-million-token
   rates. Keep the "unknown model
   bills at the most expensive rate on file" safety behavior — the direction
   to be wrong in doesn't change with the provider. Re-verify
   `pricing.test.ts` still asserts real numbers, not stale Anthropic ones.
5. **Response shape differences.** Anthropic's tool-use flow
   (`tool_choice`, `ToolUseBlock`, `stop_reason`, streaming via
   `.messages.stream()`, `thinking: { type: "adaptive" }`) has a Gemini
   equivalent (function calling / structured output) but not an identical
   shape — port `IDEAS_TOOL`/`ADAPT_TOOL`'s JSON schemas faithfully rather
   than approximating them, and confirm the 5-10 item ideas array and
   required citations still validate the same way on the far side.
6. **`.env.example` + Vercel.** This is the part Anton actually asked for:
   once the swap is done, `.env.example` at repo root must list the new
   Gemini var names (not the old Anthropic ones) so that importing this repo
   fresh into Vercel pre-populates the correct env var keys immediately —
   Vercel reads `.env.example` to build that import screen. Remove
   `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`ANTHROPIC_PROMOTE_MODEL` entirely;
   add the Gemini equivalents with the same explanatory comment style the
   file already uses. Every other var (`DATABASE_URL`, `CLIP_TOKEN`,
   `SESSION_SECRET`, `YOUTUBE_API_KEY`, `MONTHLY_SPEND_CAP_USD`,
   `CRON_SECRET`, etc.) is untouched by this phase — do not reorganize or
   rewrite unrelated sections.
7. **Package.json / lockfile.** Remove `@anthropic-ai/sdk` if nothing else
   in the app needs it (grep first — do not assume); add the Gemini SDK
   dependency.

Exit: `npm run build`, `npm run typecheck`, `npm test` green; a real
`/api/generate` call against the dev DB returns ideas grounded via Gemini
Search and logs a non-zero, plausible cost to `spend_log`; a real promote
call (adapt=true) returns adapted copy and logs cost; `.env.example` contains
no Anthropic var names, only Gemini ones, and a fresh Vercel import of this
repo shows the correct keys; `pricing.test.ts` passes against real Gemini
rates; §9 build-log entry recorded (rates used, package name chosen, any
feature-parity gap found and how it was handled); PR merged green.

## §6. Sonnet phases

Hard limits per §4.7 apply to both.

### S3 — Surfaces: inbox UI + capture ergonomics

1. **Inbox page** (`/inbox` or similar, matching the app's existing UI
   conventions/styles): clips newest-first, filter by status/platform,
   showing note + fetched metadata; a clip links to its video page when
   ingested; inline actions: promote (opens brand/format picker → calls
   O2's endpoint), dismiss/delete, retry failed.
2. **Promote/seed touchpoints** in the existing YouTube views: on an
   analysis page, "promote to idea" on each takeaway/idea/marked unit; on
   the brand ideas page, "seed from a video" (picker over analyzed videos →
   `/api/generate` with `analysisId`).
3. **Capture path**: web app manifest with `share_target` pointing at a
   thin page that posts to `/api/clips`; plus `docs/CAPTURE.md` with exact
   steps for an iOS Shortcut hitting the route with the Bearer token.
4. Quick-add form on the inbox page (paste URL + note) as the fallback.

Exit: build/lint/typecheck green; share-target manifest validates; full
manual flow works on dev (save → appears in inbox → promote → idea appears
for the brand); PR merged.

### S4 — Hostinger worker + IG/FB metadata (conditional)

**Gate first:** read §9 for the probe verdict (§7.2). No verdict recorded →
stop and ask Anton to run it. Verdict PASS and no other job needs the
worker → skip the worker, build only the IG/FB fetch below Vercel-side,
note the skip in §9.

1. **Worker** (if gated in): minimal Node service for the existing Hostinger
   slot (deploy per the `nextjs-deploy-hostinger` skill): one authed webhook
   endpoint the Vercel app calls with a job (`fetch_captions` | `fetch_clip_
   metadata`); worker calls back to a Vercel callback route with the result.
   Shared secret in env both sides. No polling, no queue infra beyond a
   simple in-process queue.
2. **IG/FB metadata fetch**: best-effort oEmbed/OpenGraph fetch for
   title/author/thumbnail on saved IG/FB clips, run worker-side when the
   worker exists, else Vercel-side. Failure is normal: clip stays useful on
   URL + note (§1.7); record the failure on the clip row, no retry storms.

Exit: build green both apps; a saved IG clip gains metadata when fetchable
and degrades cleanly when not; worker (if built) deployed and round-trips a
job; PR merged; final closing report to Anton (live URLs, manual-steps list).

## §7. Human-inputs checklist

| Input | First needed | Status |
|---|---|---|
| 1. Confirm the app is actually deployed on Vercel + Neon env vars set, then run `npm run db:migrate && npm run db:seed` | before O1 merge (migration hits Neon) — **still open, O1 could not reach a database** | ☐ |
| 2. Caption probe verdict from Vercel (`npm run yt:probe-captions` from the deployed env, or ask a session to add a probe route) | S4 gate | ☐ |
| 3. `CLIP_TOKEN` value set in Vercel env (session generates, Anton stores) | O2 | ☐ |
| 3b. `GEMINI_API_KEY` from a **billed** Google project (aistudio.google.com/apikey) set in Vercel env — Search grounding and the Batch API are not on the free tier. Replaces the Anthropic key entirely. | O3 (blocks every paid call) | ☐ |
| 4. iOS Shortcut created on the phone per `docs/CAPTURE.md` | after S3 | ☐ |
| 5. Hostinger SSH/panel access for the worker slot | S4, only if gated in | ☐ |

## §8. Open business questions (parked)

- ~~Move the app's paid model calls from the Anthropic API to Gemini?~~
  **Decided 2026-08-29: yes, on cost.** Now §5.O3
  (`prompts/opus-3-gemini-migration.md`) — its own Opus phase, not folded
  into O2/S3/S4, because it touches money math and every generation path at
  once. What it actually involves (kept here for O3 to read):
  - Two paid paths: the YouTube analysis/screening pipeline (Haiku 4.5,
    ~$0.02/video, uses the Batch API's 50% discount) and `/api/generate`
    (Opus 5 + up to 8 paid web searches — the expensive one by an order of
    magnitude).
  - Portable: `spend_log`, `withSpendCap`, the reservation row, and the
    per-model rate tables in `src/lib/analysis/pricing.ts`. None of that is
    Anthropic-specific; only the numbers in it are.
  - Not portable without work: tool-use/response shapes, the Batch API
    discount the analysis pipeline is priced around, prompt caching, and the
    server-side `web_search` tool (Gemini's equivalent is Search grounding,
    billed differently).
  - **The cheap lever first:** `ANTHROPIC_MODEL` already switches the
    ideation call, and `IDEATION_MODEL_RATES` already prices Sonnet 5 and
    Haiku 4.5. Dropping that one call from Opus to Sonnet cuts its token cost
    ~60% with no code change at all. Measure a few real runs against the cap
    before deciding a provider swap is what the bill needs.
- Pay for audio transcription of IG/FB clips later? (~20x captions-based.)
- Merge `research_notes` with `topics`/`entities` into one signal table, or
  keep the soft link? (~20 writer call-sites in `/youtube` make this a real
  refactor — not this build.)

## §9. Build log & handoff

*(append-only; every phase adds an entry before merging its PR)*

### 2026-08-29 — O3 follow-up: ideation defaults to Flash, not Pro

- **Exists now:** `GEMINI_MODEL` defaults to `gemini-3.7-flash` instead of
  `gemini-3.1-pro-preview`. Anton's call, made while setting up the Vercel env:
  Flash across the board. Nothing else changed — the rate row for 3.7 Flash was
  already in `IDEATION_MODEL_RATES`, so this is a one-line default plus the
  comments and docs that named the old one.
- **Decisions/deviations:** the Pro row stays in `IDEATION_MODEL_RATES` even
  though nothing defaults to it — it is the ceiling `ideationRates()` falls back
  to for an unrecognised model, and dropping it would make Flash the most
  expensive rate on file and let a Pro-class unknown under-report.
- **Worth knowing:** 3.7 Flash is priced in the table at its standard
  $1.50/$7.50, not the $0.75/$3.75 introductory rate that runs to 2026-12-31,
  so until New Year `spend_log` reads about double the real invoice for
  ideation. Deliberate (the cap trips early rather than late), but it is now on
  the main cost path — see KNOWN-ISSUES.md before reacting to the figure.
- **Next phase looks first at:** unchanged — S4 is still gated on §1.9's caption
  probe, and O3's live verification is still outstanding.

### 2026-08-29 — O3 Provider migration: Anthropic → Gemini — code complete, UNVERIFIED

- **Exists now:** every paid call in the app runs on Gemini through
  `@google/genai` **2.19.0** (the current first-party Node SDK — `googleapis/js-genai`;
  `@google/generative-ai` is the retired one and was not used).
  `src/lib/anthropic.ts` is now `src/lib/ai.ts`, still the one module every paid
  call goes through: `generateContentPlan` and `adaptIdeaToBrand` keep their
  exact signatures, so `/api/generate` and `promote.ts` changed by one import
  line each. Ideation grounds through Google Search and returns the same
  `IDEAS_TOOL` schema — ported verbatim, as `responseJsonSchema` rather than a
  function declaration, which Gemini 3 allows alongside a built-in tool in one
  request and which removes the old "researched, then answered in prose without
  calling the tool" failure. The analysis/screening/outline paths and the
  nightly poller's batch all moved with it; `batch.ts` uses Gemini's inlined
  Batch API, keyed on request metadata rather than position.
- **Rates used** (Google's own pricing page, read 2026-08-29, global endpoint;
  the Developer API bills the same per-token figures): ideation
  `gemini-3.1-pro-preview` $2/$12 per 1M under 200k input tokens and $4/$18
  above it (the long-context tier is now honoured by `costUsdAtRates`);
  analysis default `gemini-3.1-flash-lite` $0.25/$1.50; analysis opt-in
  `gemini-3.7-flash` priced at its **standard** $1.50/$7.50, not the $0.75/$3.75
  introductory rate that lapses 2026-12-31 — the same call the old table made
  about Sonnet 5, and it means nothing starts silently under-reporting on New
  Year's Day. Search grounding is $14 per 1,000 **queries** (not per request —
  the unit changed, so `WEB_SEARCH_USD_PER_REQUEST` became
  `GROUNDING_USD_PER_QUERY`), counted from the response's own
  `webSearchQueries`. `pricing.test.ts` asserts these numbers directly rather
  than reading them out of the module.
- **Feature parity:** the Batch API's flat 50% discount survives the swap
  intact, so no §4.4 stop was needed. Prompt caching does not: Gemini's is
  implicit, needs a shared 4,096-token prefix nothing here has, and its
  discount is only clearly documented for the 2.5 family — cached tokens are
  therefore billed at the full input rate (over-reports, the safe direction).
  Grounding lost `max_uses`, so `MAX_GROUNDING_QUERIES = 8` is now a reservation
  estimate and a prompt line, not a cap. All in KNOWN-ISSUES.md.
- **Decisions/deviations:** (a) `readUsage` moved into `src/lib/ai.ts` and is
  re-exported from `analysis/run.ts` — Gemini's counters differ from
  Anthropic's in three ways that each under-report if missed (`promptTokenCount`
  includes the cached prefix, `thoughtsTokenCount` is billed as output and sits
  outside `candidatesTokenCount`, and grounding's `toolUsePromptTokenCount` is
  not charged at all), so that mapping now exists once and is pinned by a new
  `src/lib/ai.test.ts`; (b) `Rates` gained an optional `longContext` tier —
  the only structural change to `pricing.ts`, and it closes a real
  under-report on the one model that has such a tier; (c) reasoning is
  MINIMAL across analysis/screening/outline, because Gemini counts reasoning
  against `maxOutputTokens` and the screening call's 400-token ceiling has no
  room to think first — the models this replaced were called without extended
  thinking at all; (d) `UPGRADE_MODEL` was added beside `DEFAULT_MODEL` so no
  page or script carries a model literal (a literal in a page is how a provider
  swap gets missed) — this renamed two dictionary keys and the copy they render,
  which said "Sonnet"; (e) the branch is `claude/code-or-deploy-status-s0hiqx`,
  not `phase/o3-gemini-migration` — the session harness pins the branch name,
  as it did for O1.
- **NOT DONE — the whole verification half.** No `GEMINI_API_KEY` and no
  `DATABASE_URL` in the build session, so no Gemini request has actually been
  sent and no cost row written. The two live exit criteria (a grounded
  `/api/generate` logging a plausible cost, and an adapted promote call) are
  outstanding. `.env.example` IS done and is the thing Anton was waiting on: it
  contains zero Anthropic names, so a fresh Vercel import pre-populates
  `GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_PROMOTE_MODEL`. §7 item 3b is the new
  human input: the key must be on a **billed** project or grounding and batch
  both fail.
- **Next phase (S4, conditional) looks first at:** §1.9's gate — the caption
  probe still has no recorded verdict (§7 item 2), so S4 cannot start. Whoever
  runs the first real generation should re-baseline
  `ESTIMATED_THINKING_TOKENS`/`MAX_GROUNDING_QUERIES` in `src/lib/ai.ts` against
  the `usageMetadata` that comes back.

### 2026-08-29 — O3 phase spec written (no code changed)

- **Exists now:** `prompts/opus-3-gemini-migration.md`, §5.O3 above, and §8's
  Gemini question flipped from parked to decided. No app code touched — this
  is only the phase definition, written from Anton asking (in a Vercel-setup
  conversation) to move off the Anthropic API onto Gemini, and asking which
  model should do it (Opus, per the O1 precedent: money math + every
  generation path at once).
- **Decisions/deviations:** none — this is plan/prompt authoring only,
  following the exact §5/prompts pattern O1/O2 already use.
- **Not done:** the migration itself. `.env.example` still lists
  `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`ANTHROPIC_PROMOTE_MODEL` — a fresh
  Vercel import will show the OLD (Anthropic) var names until O3 lands.
  `DATABASE_URL` (Neon) was provided by Anton directly in chat for Vercel
  env setup; not committed to the repo.
- **Next phase (O3) looks first at:** `src/lib/anthropic.ts` (the one module
  every paid call goes through — O2 was explicit that a provider swap should
  stay this module's job) and `src/lib/analysis/pricing.ts` for the rate
  tables. `.env.example` last, once the new var names are settled.

### 2026-08-28 — S3 Inbox UI + capture ergonomics (PR #9) — code complete, UNVERIFIED

- **Exists now:** `/inbox` — filterable (status/platform), paginated clip
  list matching `/youtube/marks`'s layout, with a quick-add form (paste URL +
  note → `POST /api/clips`, same route the share sheet and the Shortcut use),
  a status-counts line, retry (YouTube, owner, failed clips only) and dismiss
  (owner, deletes the inbox row, leaves any linked video/idea alone) actions,
  and a promote button per analysed clip offering each idea in that video's
  latest analysis. `PromoteButton` (`src/components/PromoteButton.tsx`) is
  the one promote UI, reused on `/youtube/video/[id]` next to every star
  (summary/takeaways/hook/timeline/gaps/ideas — unit-kind sources) and on the
  inbox (analysis-idea-kind sources); both call `POST /api/ideas/promote`.
  `/brand/[id]` gained a "seed from a video" picker over
  `bridge.listAnalyzedVideos()` that calls `/api/generate` with `analysisId`.
  Capture: `src/app/manifest.ts` (GET `share_target` → `/share`) and
  `/share`, a thin page that best-guesses the shared URL/note and posts to
  `/api/clips`; `docs/CAPTURE.md` covers both the PWA share-sheet path and
  the iOS Shortcut/Bearer-token path in full, copy-pasteable detail.
- **Decisions/deviations:** (a) promote reads went through
  `bridge.analysisBundleForVideo` (already exported for exactly this) rather
  than adding a new bridge function — the inbox calls it once per analysed
  clip on the page (bounded by `CLIPS_PAGE_SIZE`, an internal single-user
  tool); (b) dismiss and retry are new writes straight to `clips` /
  `processYouTubeClip` in `src/lib/clips.actions.ts`, not new O2 endpoints —
  the same pattern `sources.actions.ts`'s `removeSource` already uses for
  `sources`, and §4.7 restricts S3 from schema/ingest/pipeline changes, not
  from a small owner-gated row delete or from calling O2's own exported
  `processYouTubeClip` again; (c) GET `share_target` (not POST) — POST needs
  a service worker to read the multipart body, which nothing else in this app
  uses, so GET's query-param form (parsed server-side on `/share`) was the
  one thin page could handle with no new infra; (d) checked whether a local
  Postgres could stand in for the missing Neon `DATABASE_URL` (postgresql-16
  is installed in this session) — it can't without changing
  `src/db/index.ts`'s Neon-HTTP driver, which is a foundation-layer decision
  this phase should not make just to get a local test rig, so verification
  stayed blocked on the same missing credential as O1/O2 (see KNOWN-ISSUES.md).
- **NOT DONE — the whole verification half**, same reason as O1/O2: no
  `DATABASE_URL` in the build session. `npm run build` + `typecheck` + `test`
  (177 tests) are green; no clip has actually been saved, promoted, or
  seeded through the real UI. §0 checklist for whoever has DB access: run the
  two O1 commands, then click through `/inbox` — quick-add a URL, promote an
  analysed clip's idea, confirm it lands on the brand's page; hit `/share?
  url=https://youtube.com/watch?v=...` directly to simulate a share-sheet
  POST.
- **Next phase (S4, conditional) looks first at:** §1.9's gate — the caption
  probe from Vercel has not been run (§7 item 2 still ☐), so S4 cannot start
  until that verdict is recorded. `PromoteButton` and `ClipRow` are the
  components to extend if IG/FB metadata fetch changes what an inbox row
  shows.

### 2026-08-28 — O2 Capture + bridge (PR #8) — code complete, UNVERIFIED

- **Exists now:** `POST /api/clips` (cookie OR `Authorization: Bearer
  CLIP_TOKEN`, deduped on a canonical URL, platform derived from the host);
  YouTube clips route straight through the existing `ingestUrl` + `analyzeVideo`
  behind the same spend cap, driving `ingesting → analyzed | failed`.
  `POST /api/ideas/promote` turns a marked unit or an `analyses.ideas` entry
  into an `ideas` row with `source_analysis_id` set, verbatim for free or
  adapted to the brand's voice by one cheap Haiku call (owner only).
  `/api/generate` takes an optional `analysisId` and grounds the run in that
  stored payload. `src/lib/bridge/` gained `listAnalyzedVideos` for S3's picker.
- **Decisions/deviations:** (a) `/api/clips` had to be excluded from the session
  middleware — a share sheet has no cookie and a 307 to the login page reads as
  success to a Shortcut; the route authenticates itself and fails closed;
  (b) a playlist/channel link is stored but never auto-ingested — one clip is
  one link, and quietly pulling 200 videos from a saved link is not what saving
  a link means; (c) `adapt` is opt-in per request and owner-only, so the common
  promote is free; (d) this phase was built in the same session as O1 at Anton's
  request, on the O1 branch, rather than as a fresh session — the §4.9 handoff
  gates were not met (see below) and pretending otherwise would have been worse.
- **NOT DONE — the whole verification half.** Still no `DATABASE_URL` in the
  session, so nothing here has touched Postgres: no clip saved, no ingest, no
  promote, no grounded generation. Every O2 exit criterion is outstanding.
  `prompts/opus-2-capture-bridge.md` §0 is the checklist to work through once
  the database is reachable.
- **Next phase (S3) looks first at:** `src/lib/bridge/` for every read it is
  allowed to make, `POST /api/clips` and `/api/ideas/promote` for the two
  endpoints it wires buttons to, and `KNOWN-ISSUES.md` for what is unverified.
  S3 must not start until O2's exit criteria actually pass.

### 2026-08-28 — O1 Foundation (PR #6)

- **Exists now:** `brands` is the single source of truth — `src/lib/brands.ts`
  and the `BRANDS` constant are deleted, seed data lives in `src/db/seed.ts`
  (insert-only by default, `--overwrite` to push edits back, never duplicates).
  Migration `0003` adds the `clips` table and `ideas.source_analysis_id`, no FK
  constraints, with relations for clip→video, clip→idea, idea→analysis.
  `/api/generate` runs inside `withSpendCap` and logs its real cost (tokens +
  $10/1k web searches) to `spend_log`; it answers 429 when the cap refuses.
  `src/lib/bridge/` is the read-only query layer S3 must go through.
- **Decisions/deviations:** (a) the seed no longer overwrites existing rows —
  §5.O1 said "idempotent upsert", but an upsert that re-applies file literals
  clobbers a voice edited in the database, so insert-only is the default and
  overwrite is a flag; (b) retiring the constant meant touching `/` and
  `/brand/[id]` despite the phase's "no UI" rule — the markup is unchanged,
  only the data source, and both are now `force-dynamic`; (c) the ideation call
  streams now (16k output on a thinking model exceeds the non-streaming
  timeout); (d) the branch is `claude/opus-1-foundation-prompt-io65cd`, not
  `phase/o1-foundation` — the session harness pins the branch name.
- **Not done:** migration not applied and seed not run — no `DATABASE_URL` in
  the build session (§7 item 1, still ☐). `/api/generate` therefore never
  executed end-to-end. Two commands: `npm run db:migrate && npm run db:seed`.
- **Next phase looks first at:** `src/lib/bridge/` (add O2's reads there, not
  in the routes), `src/db/schema.ts`'s `clips` state machine for the statuses
  O2 must drive, and `generateContentPlan` in `src/lib/anthropic.ts` for how a
  paid call is wrapped — the promote endpoint's cheap adaptation call and the
  `analysisId` grounding path both go through the same cap. `KNOWN-ISSUES.md`
  is new; read it before assuming the dev DB has the tables.

## §10. Backlog

- videos→brands join table, if a query ever needs it (§1.3).
- Provider abstraction for paid calls (one module behind which Anthropic or
  Gemini sits), if §8's Gemini question is answered yes. Until then: new call
  sites go through the existing helpers, never their own client.
- Telegram-bot capture path as an alternative to the PWA share target.
- Retry/backoff policy for failed clip ingests beyond manual retry.
