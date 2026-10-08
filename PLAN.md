# PLAN — content-engine build 3: the social OS (phased autonomous build)

> **Build 4** (voice, cuentos stories, video, learn, YouTube/TikTok, growth) is
> planned in [`docs/PLAN-build4.md`](docs/PLAN-build4.md). This file stays the
> build 3 contract; O14 below is still open.

Build 1 (O1–O3, S3) wired brand ideation, the YouTube tool and the clip inbox
together. Build 2 (O4–O8, S5–S12, B2b-A–D) made it verifiable and added the
research studio: competitors, digests, lessons, facts, titles, scripts and the
Higgsfield hand-off. Both plans are kept verbatim in
`docs/PLAN-v1-build1.md` and `docs/PLAN-v2-build2.md`.

**Build 3 turns content-engine into the one place where every brand's social
media lives:** brands and their accounts, a media library that ends the
Higgsfield mess, posts written for engagement and adapted across languages, a
calendar, capture from the phone via Telegram, fetched and transcribed reels
for research and fact-checking, and later Instagram stats and publishing.
It serves **every** brand Anton runs. No brand, family or market is special
in code; the Paraguay residency family is only the first large user.

Same repo, same stack: Next.js (App Router), Neon Postgres via drizzle
(`DB_DRIVER=pg`), Gemini via `@google/genai` or the logged-in Claude/Codex CLI
through `structuredJson()` (§1.38), every paid call through `withSpendCap`.

## Phase table

Lane 1 runs first, sequentially (O9 → O10 → O11). When O11 merges it spawns
every lane 2 phase at once (S13–S19). Each lane 2 phase, when it merges, checks
whether all of lane 2 has merged; the last one spawns the link pass S20
(§4.10). S20 then spawns lane 3 (O12 → O13 → O14, S21). **Amended 2026-09-27:**
lane 3 is built right away against recorded API fixtures; its live paths are marked
UNVERIFIED until Anton ticks §7 items 7–8, so no code waits on a human.

| Phase | Lane | Model | Prompt file | Plan § | Owns | Depends on |
|---|---|---|---|---|---|---|
| O9 Social schema + contracts | 1 | Opus 5.5 med | `prompts/opus-9-social-schema.md` | §2, §5.O9 | `src/db/schema.ts`, `drizzle/**`, `src/db/seed.ts`, `src/lib/posts/contract.ts` (new), `src/lib/clips/telegram.ts` (new), `src/lib/clips/url.ts`, `tsconfig.json` + `eslint.config.mjs` + `.prettierignore` (exclude `workers/**`), `src/lib/bridge/{families,accounts,assets,posts,metrics}.ts` (new), `src/lib/bridge/index.ts`, `src/lib/bridge/facts.ts` + existing call sites of `facts.brandId` (nullability only), `src/lib/i18n/dict/{accounts,media,posts,capture}.ts` (stubs), `tests/integration/**`, `docs/log/o9.md` | — |
| O10 Media storage | 1 | Opus 5.5 med | `prompts/opus-10-media-storage.md` | §1.41, §5.O10 | `src/lib/storage/**` (new), `src/lib/media/**` (new), `src/lib/studio/media.ts`, `src/app/api/media/**`, `hosting/media-upload/**` (new), `scripts/media-*.ts` (new), `package.json`, `package-lock.json`, `.env.example`, `tests/integration/**`, `docs/log/o10.md` | O9 |
| O11 Post engine | 1 | Opus 5.5 med | `prompts/opus-11-post-engine.md` | §1.46–§1.48, §5.O11 | `src/lib/ai.ts` (new calls only), `src/lib/ai-fake.ts`, `src/lib/posts/**`, `src/app/api/posts/**` (new), `src/app/api/generate/route.ts` (topic param only), `content/style/**`, `content/playbooks/**` (new), `tests/integration/**`, `docs/log/o11.md` | O10 |
| S13 Brands, families, accounts, kits | 2 | Opus 5.5 low | `prompts/sonnet-13-brands-accounts.md` | §6.S13 | `src/app/brands/**` (new), `src/app/accounts/**` (new), `src/app/brand/[id]/kit/**` (new), `src/app/families/**` (new), `src/components/{Account,Family,Kit}*.tsx` (new), `src/lib/accounts.actions.ts` (new), `src/lib/i18n/dict/accounts.ts`, `tests/integration/accounts-ui.test.ts`, `docs/log/s13.md` | O11 |
| S14 Media library + Higgsfield commands | 2 | Opus 5.5 med | `prompts/sonnet-14-media-library.md` | §6.S14 | `src/app/media/**` (new), `src/components/Media*.tsx` (new), `src/lib/media.actions.ts` (new), `src/lib/i18n/dict/media.ts`, `.claude/commands/higgsfield-post.md` (new), `.claude/commands/higgsfield-import.md` (new), `docs/HIGGSFIELD.md`, `tests/integration/media-ui.test.ts`, `docs/log/s14.md` | O11 |
| S15 Posts, calendar, post pack | 2 | Opus 5.5 med | `prompts/sonnet-15-posts-calendar.md` | §6.S15 | `src/app/posts/**` (new), `src/app/calendar/**` (new), `src/components/{Post,Calendar}*.tsx` (new), `src/lib/posts.actions.ts` (new), `src/lib/i18n/dict/posts.ts`, `tests/integration/posts-ui.test.ts`, `docs/log/s15.md` | O11 |
| S16 Telegram capture | 2 | Opus 5.5 low | `prompts/sonnet-16-telegram-capture.md` | §1.43, §6.S16 | `workers/telegram-capture/**` (new, own `package.json`), `src/app/inbox/**`, `src/app/share/**`, `src/app/api/clips/route.ts`, `src/lib/clips/save.ts`, `src/components/{ClipRow,ClipFilters,QuickAddClipForm}.tsx`, `src/lib/clips.actions.ts`, `src/lib/i18n/dict/{inbox,capture}.ts`, `docs/CAPTURE.md`, `tests/integration/capture-ui.test.ts`, `docs/log/s16.md` | O11 |
| S17 Clip fetch + transcript | 2 | Opus 5.5 low | `prompts/sonnet-17-clip-fetch.md` | §1.44, §6.S17 | `src/lib/clips/fetch/**` (new), `scripts/clips-fetch.ts` (new), `src/app/clips/[id]/**` (new), `src/components/ClipMedia*.tsx` (new), `src/lib/clip-fetch.actions.ts` (new), `tests/integration/clip-fetch.test.ts`, `docs/log/s17.md` | O11 |
| S18 Facts import + hooks library | 2 | Opus 5.5 low | `prompts/sonnet-18-facts-hooks.md` | §1.48, §6.S18 | `scripts/facts-import.ts` (new), `src/lib/facts/import.ts` (new), `src/app/facts/**`, `src/app/hooks/**` (new), `src/components/{Fact,Hook}*.tsx`, `src/lib/facts.actions.ts`, `src/lib/i18n/dict/facts.ts`, `tests/integration/facts-import.test.ts`, `docs/log/s18.md` | O11 |
| S19 Docs + local setup | 2 | Opus 5.5 low | `prompts/sonnet-19-docs.md` | §6.S19 | `README.md`, `docs/LOCAL-SETUP.md`, `docs/STORAGE.md` (new), `docs/SOCIAL-OS.md` (new), `setup.ps1`, `.env.example` (comments only), `docs/log/s19.md` | O11 |
| S20 Link pass | — | Opus 5.5 low | `prompts/sonnet-20-link-pass.md` | §6.S20 | `src/components/Header.tsx`, `src/app/page.tsx` (home cards), `src/lib/i18n/dict/{nav,header,app}.ts`, `KNOWN-ISSUES.md`, one-line mounts of lane 2 components in other lane 2 pages, `docs/log/s20.md` | S13–S19 |
| O12 Meta connect + insights | 3 | Opus 5.5 med | `prompts/opus-12-meta-insights.md` | §5.O12 | `src/lib/meta/**` (new), `src/lib/crypto.ts` (new), `src/app/api/meta/**` (new), `src/app/settings/**` (Meta section), `scripts/meta-sync.ts` (new), `src/lib/posts/what-worked.ts` (new), `src/lib/ai.ts` (prompt input only), `tests/integration/**`, `docs/log/o12.md` | S20 |
| O13 Publishing | 3 | Opus 5.5 med | `prompts/opus-13-publishing.md` | §5.O13 | `src/lib/publish/**` (new), `scripts/publish-due.ts` (new), `src/app/api/cron/publish/**` (new), `src/components/PublishNow*.tsx` (new), `tests/integration/**`, `docs/log/o13.md` | O12 |
| O14 Hostinger EU deploy | 3 | Opus 5.5 med | `prompts/opus-14-hostinger-deploy.md` | §5.O14 | `docs/DEPLOY-HOSTINGER.md` (new), `next.config.ts`, `src/db/driver.ts` (IPv4 only), `src/lib/storage/drive.ts` (new), `package.json` scripts, `.env.example`, `docs/log/o14.md` | O13 |
| S21 IG competitors + weekly report | 3 | Opus 5.5 low | `prompts/sonnet-21-ig-competitors.md` | §6.S21 | `src/lib/meta/discovery.ts` (new), `src/app/research/instagram/**` (new), `src/components/IgCompetitor*.tsx` (new), `scripts/ig-competitors.ts` (new), `tests/integration/ig-competitors.test.ts`, `docs/log/s21.md` | O12 |

Right-sizing: every phase is one session, ≤ 90 minutes. A phase that cannot
finish in that was two phases: split it here, not in the session.

---

## §1. Decisions already made — do not re-litigate

Items **1–38** are carried from build 2 (`docs/PLAN-v2-build2.md` §1) and still
hold, except where an item below supersedes one. Code comments cite them as
`PLAN.md §1.<n>`, so the numbering continues.

39. **Scope: every brand.** content-engine is the content system for all of
    Anton's brands and markets. No code path is specific to one brand, family
    or market; behaviour comes from `brands`, `brand_families`,
    `social_accounts` and `brand_kits` rows. New brands are added in the UI
    (S13), not in code.
40. **Object model: Family → Brand → Account → Post → Assets** (§2). A
    *family* groups brands that share facts, research and inspiration (for
    example the seven Paraguay residency brands, one per language or angle).
    An *account* is one handle on one platform in one language. A *post*
    belongs to one account, grows from an optional idea, and holds ordered
    assets. Ideas stay brand-level; posts are account-level.
41. **Storage: three tiers, one adapter** (`src/lib/storage/`).
    - **Primary: local disk under `MEDIA_ROOT`**, meant to be an external
      drive in the office (e.g. `E:\ContentEngine`). The app reads and writes
      here. When `MEDIA_ROOT` is missing or unplugged, the app says "media
      drive not connected" and keeps working on metadata.
    - **Backup + phone access: Google Drive for desktop** backing up that
      folder, bandwidth-limited or paused during work. This is setup, not app
      code (S19 documents it). The app stores a Drive link only once O14 adds
      the read-only Drive driver.
    - **Public: Hostinger EU disk** via a small token-protected PHP upload
      endpoint (`hosting/media-upload/`) on a `media.` subdomain. It holds only
      what must be public: the finished files of posts being published, and
      thumbnails. Public copies are pruned N days after posting
      (`MEDIA_PUBLIC_RETENTION_DAYS`, default 90).
    - **Neon stores text and links only**, never binaries.
    - **Folder layout** (`src/lib/storage/paths.ts`, the contract):
      `<brand>/<account-handle|_brand>/<YYYY-MM>/<post-id>-<slug>/NN-<slug>.<ext>`,
      plus `_inbox/higgsfield/<YYYY-MM-DD>/` for unsorted imports and
      `captures/<clip-id>/` for fetched reels.
42. **Hosting: local first, Hostinger EU slot later** (amends §1.27). Anton's
    PC runs the app now. The online target is one Node.js slot on the **EU**
    Hostinger account (O14), never the Brazil account, whose process limit is
    already the bottleneck for live client sites. Everything except YouTube
    caption polling (§1.28) and CLI subscription mode (§1.38) must work
    online. Neon moves to a new, empty project in **Frankfurt**
    (`aws-eu-central-1`) to sit next to that slot; it holds no data yet, so
    the move is free.
43. **Telegram capture runs on a free Cloudflare Worker**
    (`workers/telegram-capture/`), not on Hostinger and not on the PC, so it
    works while the PC is off.
    - Telegram webhook with `secret_token`; only chat ids in
      `TELEGRAM_ALLOWED_CHAT_IDS` are served.
    - It writes to Neon with `@neondatabase/serverless` in **one** `INSERT …
      ON CONFLICT` statement, using the same URL canonicalisation as the app
      (`src/lib/clips/url.ts`, bundled into the Worker).
    - Message grammar (`src/lib/clips/telegram.ts`, pure, unit-tested):
      first URL is the clip; `#<brand-id or alias>` sets the brand;
      `#inspo #competitor #factcheck #own` set the purpose; any other `#tag`
      goes to `tags`; the remaining text is the note.
    - A video or photo sent *as a file* stores its Telegram `file_id`. S17
      downloads it later (Bot API limit 20 MB).
    - It replies "Saved ✓ (<brand>, <purpose>)" or "Already saved, note
      updated".
44. **IG/TikTok/FB media fetch + transcript is in scope** (supersedes §1.8).
    - A PC-side job (`npm run clips:fetch`) downloads the media with `yt-dlp`
      (optional cookies file for Instagram) into `captures/<clip-id>/` and
      registers it as an asset.
    - Then **one** Gemini Flash-Lite call through `withSpendCap` returns the
      transcript, the post's on-screen text, a summary and the claims made.
    - Runs only for clips with purpose `fact_check` or `competitor`, or when
      the owner clicks. Never automatically for `inspo`.
    - Failure leaves the URL + note floor (§1.7) and sets `clips.error`.
    - Research use only: other people's media is never republished.
45. **Higgsfield stays driven by Claude Code, extended from scripts to posts**
    (extends §1.34).
    - `/api/posts/[id]/export?format=brief` gives a generation brief: every
      visual in the post with prompt, target filename and brand kit
      references.
    - `.claude/commands/higgsfield-post.md` generates it and saves files +
      `manifest.json` into the post's folder (§1.41).
    - `.claude/commands/higgsfield-import.md` pulls existing Higgsfield
      history into `_inbox/higgsfield/` with a manifest.
    - `npm run media:scan` (and a button) registers manifests and loose files
      as `assets`, idempotent by sha256.
    - **These commands run in Claude Code on Anton's PC**, because they write
      to `MEDIA_ROOT`; a cloud session cannot reach the external drive.
46. **Posts have a versioned body contract** (`src/lib/posts/contract.ts`,
    `PostDraft` v1, §2), like the script contract (§1.32).
    - Generation writes for engagement: a hook, an engagement mechanic
      (question, poll, comment keyword, save, share, quiz, series), carousel
      slides with a visual prompt each, reel shots with image and video
      prompts, caption, CTA, hashtags, optional first comment, alt text, and
      sources for every claim.
    - The patterns live in editable files, `content/playbooks/<platform>.md`,
      not in code.
    - Generation reads the brand kit, the account's language, the family's
      facts and the brand's `hook`/`cta` lessons.
47. **Family adaptation, not translation.** "Adapt to family" creates one
    sibling post per other active account in the same family and platform,
    rewritten for that brand's language, voice and audience.
    `posts.parent_post_id` links them. New style guides: `es.md` (neutral
    Spanish), `pt-BR.md`, `de.md`, `nl.md`, `sv.md` (closes the `sv` →
    English fallback known issue).
48. **Facts are shareable per family and importable.**
    - `facts.brand_id` becomes nullable; `facts.family_id`,
      `facts.external_key`, `facts.language` and `facts.verified` are added.
    - `npm run facts:import` reads a source file into a family. The first
      source is `content/shared/facts.ts` in `antonmarklundcom/paraguayresidency`,
      whose `facts` object literal is JSON-shaped, with per-locale `display`
      and `hedged` text.
    - Unverified facts import with their hedged wording and `verified=false`.
      Generation may cite them only as hedged.
49. **Posting: manual first, then Meta.**
    - Build 3 lane 2 ships a phone "post pack": copy caption, download assets
      in order, mark posted, paste permalink.
    - Lane 3 adds Meta Graph API **insights** (O12), then **publishing** (O13)
      for Instagram (image, carousel, reel) and Facebook Pages, from the
      Hostinger public copies (§1.41).
    - Requires Professional IG accounts linked to FB Pages and a Meta app in
      development mode with Anton as admin, so no app review is needed for
      his own accounts.
    - TikTok and YouTube publishing are §10.
50. **Tokens are encrypted at rest.** `integrations.token_ciphertext` uses
    AES-256-GCM with `ENCRYPTION_KEY` (32 bytes, hex), in `src/lib/crypto.ts`
    (O12). A missing key disables integrations with a clear message (§4.5).
51. **Metrics feed generation.** `post_metrics` are append-only snapshots.
    "What worked" (O12) sends the top posts of the last 90 days per account,
    ranked by (saves + shares + comments) / reach, as context into post and
    idea generation.
52. **Seeded brands.** The seed adds the family `paraguay-residency` and its
    seven brands with the SiteKeys used in `antonmarklundcom/paraguayresidency`
    (`residency` paraguayresidency.co.uk, `investorpass`, `guide`, `frontier`,
    `residenciaes`, `residenciapt`, `flytta`, languages en/en/en/en/es/pt-BR/sv).
    The build 2 row `residency-guide` is renamed to `guide` by migration,
    including every `brand_id` that points at it. German and Dutch brands, and
    every social account, are added by Anton in the UI (§7).
53. **No watcher Routine in build 3.** The build 2 watcher fired without the
    repo checkout (`docs/decisions-needed.md`, O8). Instead O11 spawns all of
    lane 2 with `create_session` (with `source_url`), and the last lane 2
    phase to merge spawns S20 (§4.10). A stalled phase is re-started by
    pasting its prompt line; prompts are re-runnable.
54. **No new GitHub Actions workflows.** The existing CI job gains at most
    new test files. Deploys run on Hostinger's GitHub integration (O14).

## §2. Object model

Everything below is created by **O9 in one migration**. It is the complete
contract; lane 2 and lane 3 never change the schema (§4.7). Soft links, no
FK constraints (§1.4). Timestamps default `now()`.

- **`brand_families`**: `id text pk` (slug), `name`, `notes text null`.
- **`brands`** + `family_id text null`.
- **`brand_kits`** (1:1 with a brand): `brand_id text pk`,
  `colors jsonb` (`[{name, hex}]`), `fonts jsonb` (`[{role, family}]`),
  `logo_asset_id int null`, `higgsfield jsonb`
  (`{elementIds[], characterIds[], styleNotes}`), `ctas jsonb` (string[]),
  `hashtags jsonb` (string[]), `dos text`, `donts text`, `updated_at`.
- **`social_accounts`**: `id` identity, `brand_id`,
  `platform` enum `instagram|facebook|tiktok|youtube|threads|x|linkedin|pinterest`,
  `handle`, `language varchar(8) null` (null = the brand's),
  `status` enum `planned|active|paused`, `is_professional bool`,
  `external_id varchar null` (IG user id / FB page id),
  `integration_id int null`, `notes`, `created_at`; unique (`platform`, `handle`).
- **`integrations`**: `id`, `provider` enum `meta|tiktok|google_drive|telegram`,
  `label`, `account_ref varchar`, `token_ciphertext text null`,
  `token_expires_at null`, `scopes jsonb`, `status` enum `ok|expired|error|disabled`,
  `last_error varchar null`, `created_at`, `updated_at`.
- **`assets`** (the media library): `id`, `brand_id null`, `account_id null`,
  `kind` enum `image|video|audio|document`, `mime`, `bytes bigint`,
  `sha256 char(64)` unique, `width`, `height`, `duration_sec real null`,
  `local_path varchar(1024) null` (relative to `MEDIA_ROOT`),
  `public_url varchar(1024) null` (Hostinger copy), `public_expires_at null`,
  `drive_file_id varchar null`, `thumb_path varchar null`,
  `source` enum `higgsfield|upload|capture|telegram|import|camera`,
  `source_ref varchar(1024) null` (Higgsfield job id or URL, clip id),
  `prompt text null`, `model varchar null`, `tags jsonb` (string[]),
  `status` enum `new|approved|rejected|used|archived`, `alt_text`, `notes`,
  `created_at`; indexes (`brand_id`, `status`), (`created_at`).
- **`posts`**: `id`, `account_id` not null, `brand_id` (denormalised for
  filters), `idea_id null`, `parent_post_id null`,
  `format` enum `reel|carousel|image_post|story|video|text`,
  `status` enum `idea|drafting|ready|scheduled|publishing|published|failed|archived`,
  `title` (internal), `body jsonb` (PostDraft), `caption text`,
  `first_comment text null`, `scheduled_for null`, `published_at null`,
  `permalink varchar null`, `external_media_id varchar null`,
  `publish_error varchar null`, `publish_attempts int default 0`,
  `created_at`, `updated_at`; indexes (`account_id`, `status`), (`scheduled_for`).
- **`post_assets`**: `post_id`, `asset_id`, `position smallint`,
  `role` enum `slide|cover|clip|thumbnail|audio`; pk (`post_id`, `position`).
- **`post_metrics`**: `id`, `post_id`, `captured_at`, `reach`, `impressions`,
  `plays`, `likes`, `comments`, `saves`, `shares`, `follows`,
  `profile_visits` (all int null), `raw jsonb`; index (`post_id`, `captured_at`).
- **`account_metrics`**: `account_id`, `date`, `followers`, `reach`,
  `profile_visits`, `raw jsonb`; pk (`account_id`, `date`).
- **`social_competitors`**: `id`, `brand_id`, `platform`, `handle`,
  `role` enum `competitor|inspiration`, `external_id null`,
  `last_synced_at null`; unique (`brand_id`, `platform`, `handle`).
- **`competitor_posts`**: `id`, `competitor_id`, `external_id` unique,
  `permalink`, `caption text`, `media_type`, `posted_at`, `likes`,
  `comments`, `views` (int null), `captured_at`.
- **`clips`** + `brand_id null`, `purpose` enum
  `inspo|competitor|fact_check|own|other` (default `other`),
  `tags jsonb`, `source` enum `share|shortcut|telegram|web` (default `web`),
  `post_text text null`, `transcript text null`, `summary text null`,
  `claims jsonb null` (`[{claim, timestampSec?}]`), `media_asset_id int null`,
  `telegram_file_id varchar null`, `fetched_at null`.
- **`lessons`**: `LESSON_KINDS` + `cta`, `caption_pattern`; + `family_id null`.
- **`facts`**: `brand_id` nullable; + `family_id null`,
  `external_key varchar null`, `language varchar(8) default 'en'`,
  `verified bool default false`; unique (`family_id`, `external_key`, `language`)
  where `external_key` is not null.

**`PostDraft` v1** (`src/lib/posts/contract.ts`, a zod-free TS type plus a
validator in the same style as `src/lib/scripts/contract.ts`):
`{ version: 1, format, language, hook, caption, cta, hashtags: string[],
firstComment?, altText?, engagement: { mechanic, detail },
slides?: [{ n, headline, body, visual: { prompt, textOverlay } }],
shots?: [{ n, seconds, onScreenText, voiceover?, visual: { imagePrompt, videoPrompt } }],
storyFrames?: [{ n, text, sticker?: 'poll'|'quiz'|'question'|'link', visual: { prompt } }],
sources: [{ claim, url }], notes? }`.

## §3. Feature scope, by dependency

- **A. Foundation** (O9 → O10 → O11): schema + seed + contracts; storage
  adapter + Hostinger endpoint + media scan; post generation, family
  adaptation, clip transcription call, topic-first research, playbooks and
  style guides.
- **B. Surfaces** (S13–S19, need A, parallel): brands/families/accounts/kits;
  media library + Higgsfield commands; posts + calendar + post pack; Telegram
  capture + inbox tags; clip fetch; facts import + hooks library; docs +
  setup.
- **C. Link pass** (S20): nav, home, cross-mounts, KNOWN-ISSUES, closing report.
- **D. Online** (lane 3, fixtures first; live once §7 items 7–8 are done): Meta insights → publishing → Hostinger
  EU deploy; IG competitors + weekly report.

## §4. Autonomy protocol

Every phase session works under these rules; each prompt restates the ones it
most needs. Unchanged from build 2 except §4.10 (no watcher, §1.53).

1. Work until the phase's exit criteria all pass; never ask permission for
   in-plan work.
2. One PR per phase. Branch `phase/<id>` off latest main, or the branch the
   harness pins (`claude/…`; note it in the log). Create, watch and merge the
   PR when CI is green. A red build is always the session's own work. Lane 2
   phases never wait for each other, only for O11.
3. Minor non-blocking issues go to the phase's `docs/log/<id>.md` "Known
   issues". Only still-open, cross-phase items are promoted to the root
   `KNOWN-ISSUES.md`, by S20.
4. Stop and ask ONLY for a missing credential with no graceful fallback, or a
   bad-foundation decision (schema, auth, money math, route contract) where
   guessing wrong forces a rewrite. "Ask" means: append the question to
   `docs/decisions-needed.md`, commit, push, end the session.
5. Missing env values never block: document them in `.env.example` and degrade
   gracefully with a clear message.
6. Every prompt is re-runnable: check what exists on the branch first, continue
   from the first unmet exit criterion. WIP commit at least every 30 minutes.
7. **Lane 2 and 3 hard limits:** no schema, migration, auth or spend-cap
   changes. Lane 2 also makes no `src/lib/ai.ts` changes. Data access goes
   through `src/lib/bridge/` and actions. Blocked by a limit → workaround + §10
   note.
8. **Model cost guardrail.** Fable/Mythos-class models are never used for
   phases, subagents, spawned sessions or Routines. Every spawn sets
   `model: claude-opus-5-5` explicitly (§1.37). If Fable seems needed, write
   why to `docs/decisions-needed.md` and end.
9. **File ownership.** A phase writes only to its Owns column, plus: its own
   `docs/log/<id>.md`, its own new files, one import line in
   `src/lib/i18n/dictionary.ts`, and one line in `docs/decisions-needed.md`.
   On `git merge main` conflicts: main wins, re-apply your change on top,
   re-run verify. Never edit a file outside Owns to resolve a conflict: log it
   in `docs/decisions-needed.md`, push, end.
10. **Handoff / spawning** per `prompts/_handoff.md`. A phase is done when four
    gates pass: PR merged green; exit checklist passed; pre-handoff audit (ONE
    `npm run verify` on main + ONE adversarial re-read of the merged diff,
    findings fixed in ONE follow-up commit); phase log committed. Then:
    O9 → O10 → O11 spawn the next lane 1 phase; **O11 spawns S13–S19 at once**;
    each lane 2 phase, after its gates, spawns S20 **only if** every other lane
    2 PR is merged and S20 has no branch or PR yet; S20 spawns O12. Lane 3:
    O12 → O13 → O14 in sequence; O12 also spawns S21; O14 and S21 end with a report.
11. **Phase log** `docs/log/<id>.md`: ≤ 12 lines "Built", ≤ 8 "Decisions",
    ≤ 8 "Known issues", one line "Verification: CI green on <sha>". Add the
    index line to §9.
12. **Orientation read.** A fresh session reads its prompt file, §1 (items 39+
    in full; 1–38 only when its prompt cites one), §2, §4, its own §5/§6
    section, the phase table, §9's index, and `docs/log/<dep>.md` for its
    Depends on. Not the old plans, not every log.
13. **Polish cap.** ONE screenshot pass (≤ 5 pages × 2 widths, CI artifact,
    never committed); PR body written once (≤ 25 lines). When the exit
    criteria pass, open the PR that turn.
14. **Decisions travel by files.** To change a running phase, edit its prompt
    file on main. Never message a running session.
15. **`npm run verify`** (`typecheck && lint && test && test:db && build`) is
    the one command every phase runs before opening a PR.

## §5. Lane 1 and lane 3 — Opus 5.5, medium effort

### O9 — Social schema + contracts

1. The whole of §2 in one migration (`npm run db:generate`), plus a data
   migration renaming brand `residency-guide` → `guide` in `brands` and every
   `brand_id` column (§1.52).
2. Seed (§1.52): family `paraguay-residency`, the seven brands with domains,
   languages, niches and voices taken from `antonmarklundcom/paraguayresidency`
   (`CLAUDE.md` domain table and `plan.md` §11), insert-only as today.
3. `src/lib/posts/contract.ts`: `PostDraft` v1 type + `validatePostDraft()` +
   unit tests (valid, missing hook, carousel without slides, bad mechanic).
4. `src/lib/clips/telegram.ts`: pure `parseCaptureMessage(text, brandAliases)`
   per §1.43 + unit tests. `src/lib/clips/url.ts`: strip `utm_*` (closes the
   known issue) + test.
5. `src/lib/storage/paths.ts` is O10's; O9 only exports `slugify()` from
   `src/lib/format.ts` if one is missing.
6. Bridge readers: `families`, `accounts`, `assets`, `posts`, `metrics`
   (list/get with filters the UIs need: by brand, family, account, status,
   date range). Re-export from `src/lib/bridge/index.ts`.
7. `facts.brandId` nullability: fix every existing call site's types; facts
   pages keep working for brand-scoped facts.
8. i18n dict stubs `accounts`, `media`, `posts`, `capture` + import lines.
9. Integration tests: migration applies on an empty DB and on a build 2 DB
   with a `residency-guide` brand + idea + script (all renamed); seed is
   idempotent; bridge readers return seeded rows.

Exit: verify green; `npm run db:migrate && npm run db:seed` twice on a fresh
DB is clean; the rename test passes; PR merged.

### O10 — Media storage

1. `src/lib/storage/`: `StorageDriver` interface (`put`, `get`, `exists`,
   `remove`, `publicUrl?`), `local` driver (MEDIA_ROOT; the existing
   `MEDIA_ROOT` default stays for back-compat), `hostinger` driver (HTTP POST
   to `MEDIA_UPLOAD_URL` with `MEDIA_UPLOAD_TOKEN`, returns the public URL
   under `MEDIA_PUBLIC_BASE`), `paths.ts` (§1.41 layout), and a
   `mediaRootStatus()` that returns `ok | missing | unwritable`.
2. `hosting/media-upload/`: `upload.php` (bearer token from `config.php`,
   `hash_equals`, size cap, extension + MIME allowlist, writes under the
   docroot's `files/`, returns JSON `{url}`), `delete.php`, `.htaccess`
   (no listing, no PHP execution under `files/`), `config.example.php`,
   `README.md` (upload to the EU account's `media.` subdomain). Tested in CI
   with `php -S` if PHP is on the runner, otherwise skipped with a log line.
3. `src/lib/media/`: `registerFile(path, meta)` (sha256, MIME sniff, image
   size via `sharp`, video duration via `ffprobe` when present, thumbnail
   `thumb_path` via `sharp`), `scanMediaRoot()` (reads `manifest.json` files
   written by the Higgsfield commands and loose files, idempotent), and
   `publishCopy(assetId)` / `prunePublic()` (§1.41 retention).
4. `scripts/media-scan.ts`, `scripts/media-prune.ts` + `package.json` scripts
   `media:scan`, `media:prune`.
5. `/api/media/**` generalised to serve any asset by id (owner-only, the same
   path-safety rules as today) and thumbnails; the old script-media paths
   keep working.
6. `.env.example`: `MEDIA_ROOT`, `MEDIA_UPLOAD_URL`, `MEDIA_UPLOAD_TOKEN`,
   `MEDIA_PUBLIC_BASE`, `MEDIA_PUBLIC_RETENTION_DAYS`.

Exit: verify green; integration tests for register (dedupe by sha256), scan
(manifest + loose file), missing-root behaviour, and the hostinger driver
against a stub server; PR merged.

### O11 — Post engine

1. `ai.ts` new calls through `structuredJson()` + `withSpendCap`:
   `draftPost({ idea | topic, account, kit, facts, lessons, playbook })` →
   `PostDraft`; `adaptPost(post, targetAccount)` → `PostDraft` (§1.47);
   `transcribeClip(assetPath | url)` → `{ transcript, postText, summary,
   claims }` on Gemini Flash-Lite (§1.44; Gemini only, even in CLI mode,
   because it needs the media). Fake payloads for all three in `ai-fake.ts`
   (also closes "fake has no pack/shorts/prose payloads" if cheap).
2. `src/lib/posts/`: `createPostFromIdea`, `regenerateSection`,
   `adaptToFamily`, `exportBrief(postId)` (Markdown + JSON, §1.45),
   `setStatus` with legal transitions.
3. `src/app/api/posts/**`: `POST /api/posts` (from idea or topic),
   `POST /api/posts/[id]/adapt`, `GET /api/posts/[id]/export?format=brief|pack`,
   `PATCH /api/posts/[id]`. Owner-only for anything that spends.
4. `/api/generate` accepts an optional `topic` (topic-first research across
   a brand, grounded as today).
5. `content/playbooks/instagram.md`, `tiktok.md`, `facebook.md`: engagement
   patterns (hooks, carousel arcs, comment-keyword CTAs, save/share prompts,
   series, story stickers), written as instructions the prompt includes.
   `content/style/`: add `es.md`, `pt-BR.md`, `de.md`, `nl.md`, `sv.md`.
6. Tests: each route under the fake, spend is logged, a failed validation
   is reported, adapt creates one sibling per target account.

Exit: verify green; one post drafted from an idea and one adapted under the
fake in an integration test; PR merged; then spawn S13–S19 (§4.10).

### O12 — Meta connect + insights (lane 3; live needs §7 item 7)

`src/lib/crypto.ts` (§1.50); Meta OAuth (Facebook Login for Business) in
Settings, storing a long-lived token in `integrations`; link IG Professional
accounts and FB Pages to `social_accounts.external_id`; `npm run meta:sync`
pulls per-post insights into `post_metrics` and daily account metrics into
`account_metrics`, matching published posts by `external_media_id` or
permalink; `what-worked.ts` (§1.51) feeds `draftPost`. Exit: sync tested
against recorded Graph API fixtures; token expiry sets `status=expired` with
a Settings banner; PR merged; spawn O13 and S21.

### O13 — Publishing (lane 3)

`src/lib/publish/`: IG single image, carousel (child containers), reel
(container + status polling), FB Page photo/video; media from
`publishCopy()` public URLs (§1.41); `first_comment` posted after publish;
`npm run publish:due` (Task Scheduler every 5 min locally, a cron route
online) publishes `scheduled` posts whose time has come, with the lease
(§1.19) and `publish_attempts` backoff; "Publish now" button. Exit:
fixture-based tests for every media type and the failure paths; PR merged;
spawn O14.

### O14 — Hostinger EU deploy (lane 3; live needs §7 item 8)

*Amended 2026-09-27:* Anton deploys to the EU slot early. `docs/DEPLOY-HOSTINGER.md` and
`DB_FORCE_IPV4` already exist; O14 extends them.

`docs/DEPLOY-HOSTINGER.md` per the `nextjs-deploy-hostinger` skill (EU
account, GitHub integration, env vars, migrations run from the PC, cron jobs
calling `/api/cron/poll` without captions and `/api/cron/publish`); force IPv4
in the `pg` driver if needed; the read-only `drive` storage driver
(`drive_file_id` links for files the online app cannot see locally, §1.41).
Exit: the deploy doc is walked through on a scratch deploy, or every step is
marked UNVERIFIED with the exact command Anton runs; verify green; PR merged.

## §6. Lane 2 — Opus 5.5 (parallel), and the link pass

Hard limits for every lane 2 phase (§4.7): no schema, migration, auth,
spend-cap or `src/lib/ai.ts` changes; data only through `src/lib/bridge/`, the
O10 storage/media modules and the O11 posts modules.

### S13 — Brands, families, accounts, kits

`/brands` list + brand create/edit (id, name, domain, niche, market, language, voice,
platforms, family, active); families list/create; accounts per brand (add,
edit, status, professional flag); brand kit editor (colours with swatches,
fonts, logo picked from the media library, Higgsfield element/character ids,
CTAs, hashtags, dos/don'ts). Owner-only writes. Exit: create a brand + family
+ account + kit in an integration test; verify green; PR merged.

### S14 — Media library + Higgsfield commands

`/media`: grid with thumbnails, filters (brand, account, status, source, kind,
tag, date), bulk tag/assign/approve/reject/archive, detail drawer (prompt,
model, source link, where used), the "media drive not connected" state, a
"Scan now" button (`scanMediaRoot`), and an unsorted-inbox view for
`_inbox/higgsfield`. `.claude/commands/higgsfield-post.md` and
`higgsfield-import.md` per §1.45 (`models_explore` recommend first, batch +
`jobs_wait`, manifest, resume on re-run, runs locally). Update
`docs/HIGGSFIELD.md`. Exit: integration tests for filters and bulk actions;
verify green; PR merged.

### S15 — Posts, calendar, post pack

`/posts` list (by account, status, date); `/posts/new` (from idea or topic,
pick account); `/posts/[id]` editor: hook, caption, slides/shots/story frames,
engagement mechanic, sources, assets attached and reordered from the library,
"Export brief" for Higgsfield, "Adapt to family", status buttons;
`/calendar` week and month views per account or family, drag to reschedule;
`/posts/[id]/pack`: phone-first page with copy-caption, assets in order with
download links, "Mark posted" + permalink. Exit: integration tests for create,
attach/reorder, schedule, mark posted; verify green; PR merged.

### S16 — Telegram capture

`workers/telegram-capture/` (Wrangler project with its own `package.json` and
`tsconfig.json`, excluded from the root typecheck): webhook handler per §1.43,
a `setup` script that registers the webhook, and a README (BotFather, chat id,
`wrangler secret put`). Inbox gains brand, purpose and tag filters and inline
edit of brand/purpose/tags; the share page and the Shortcut path accept them
too. Exit: Worker unit tests with a mocked Neon client (parse, allowlist,
duplicate reply); inbox integration test for the new filters; verify green;
PR merged.

### S17 — Clip fetch + transcript

`src/lib/clips/fetch/`: yt-dlp runner (binary from `YTDLP_PATH` or PATH,
optional `YTDLP_COOKIES_FILE`, timeout, 200 MB cap), Telegram `file_id`
download via the Bot API, registration through O10's `registerFile`, then
O11's `transcribeClip`. `npm run clips:fetch` handles eligible clips (§1.44).
A clip detail page `/clips/[id]` (video player, transcript, claims, summary,
"Fetch + transcribe", "Save claim as fact", "Save hook"); S20 mounts the
link to it in the inbox (the inbox is S16's). Exit:
integration test with a fake yt-dlp binary and the Gemini fake; verify green;
PR merged.

### S18 — Facts import + hooks library

`src/lib/facts/import.ts` + `npm run facts:import -- --family <id> --source
<path|url>` for the paraguayresidency facts shape (§1.48: extract the object
literal, JSON-parse, one row per key × locale, hedged text when unverified,
upsert by `(family_id, external_key, language)`); an "Import facts" button on
`/facts` and a family filter. `/hooks`: a library of `hook`, `cta` and
`caption_pattern` lessons with brand/family filters, quick add, and a copy
button. Exit: import test against a fixture copy of the facts file; verify
green; PR merged.

### S19 — Docs + local setup

`docs/STORAGE.md` (external drive with a fixed letter, `MEDIA_ROOT`, Drive for
desktop backup with a bandwidth limit, the Hostinger media endpoint, retention);
`docs/SOCIAL-OS.md` (the daily loop: capture → research → idea → post →
Higgsfield → pack → posted → metrics); `docs/LOCAL-SETUP.md` updated (Neon in
Frankfurt, yt-dlp + ffmpeg, Telegram Worker, Task Scheduler for `yt:poll` and
later `publish:due`); `setup.ps1` installs yt-dlp and ffmpeg via winget with
the existing fallback; README feature list updated. Exit: docs reference only
commands and env vars that exist on main; verify green; PR merged.

### S20 — Link pass

Header nav (Posts, Calendar, Media, Accounts, Hooks, Inbox, Research, Studio,
Facts), active-link highlight, wordmark "Content Engine" (closes the `YT
Intel` known issue); home page cards per family with this week's scheduled and
posted counts; cross-mounts (inbox row → `/clips/[id]`, clip → "Make post",
idea → "Make post", media detail → "Used in"); hide Generate from non-owners (closes the known issue);
prune `KNOWN-ISSUES.md`. Closing report to Anton with the §7 checklist state.

### S21 — IG competitors + weekly report (lane 3)

Business Discovery API through Anton's token: track competitor and
inspiration IG accounts per brand (`social_competitors`), store their recent
posts (`competitor_posts`), rank them by engagement against each account's
median (same idea as §1.30), and a weekly per-account report page (own posts'
metrics, best competitor posts, three suggested next posts). Exit: fixture
tests; verify green; PR merged.

## §7. Human-inputs checklist

| # | Input | First needed | Status |
|---|---|---|---|
| 1 | Create a Neon project `content-engine` in **AWS Europe Central 1 (Frankfurt)**; delete the two empty Ohio `content-engine` projects; put the URL in `.env` with `DB_DRIVER=pg`. | before using the app | ☐ |
| 2 | External drive: give it a fixed letter in Disk Management, create `E:\ContentEngine`, set `MEDIA_ROOT`. Install Google Drive for desktop and back that folder up, with an upload bandwidth limit. | O10 (local use) | ☐ |
| 3 | German and Dutch residency brands: names, domains, languages. Add them in the UI once S13 merges. | S13 | ☐ |
| 4 | Every social account per brand: platform, handle, language, and whether it is Business/Creator. Add in the UI. | S13 | ☐ |
| 5 | Telegram: create a bot with @BotFather, send it a message, note your chat id; free Cloudflare account; `npx wrangler login`. | S16 (to use it) | ☐ |
| 6 | Hostinger EU: a `media.<domain>` subdomain, upload `hosting/media-upload/`, set the token in `config.php` and `.env`. | O10 (to publish) | ☐ |
| 7 | Meta: switch IG accounts to Professional, link each to a Facebook Page, create a Meta developer app (Business type) with Anton as admin. | O12 | ☐ |
| 8 | Hostinger EU Node.js slot for the app, and access to set its env vars. | O14 | ☐ |
| 9 | Run `npm run smoke -- guide --dry-run`, then live once (carried from build 2 §7.1). | anytime | ☐ |
| 10 | Merge this plan PR before starting O9. | now | ☐ |

## §8. Open business questions (parked)

- Comment-keyword CTAs need auto-DMs (ManyChat or an own Meta webhook). The
  playbook writes the CTA either way; the tool choice is Anton's.
- TikTok publishing needs a TikTok developer app audit before public posting.
- Google Workspace (mailbox + Drive) vs Google One (Drive only): no code
  depends on it.
- Children's stories and the Paraguayan voice: unchanged from build 2 §8.

## §9. Build log index

One line per phase; detail in `docs/log/<id>.md`. Build 1 and 2 rows are in
their archived plans.

| Phase | PR | Log | State |
|---|---|---|---|
| Plan v3 | #46, #47 | — | merged |
| O9 Social schema + contracts | #48 | `docs/log/o9.md` | merged (seed filled by parent session) |
| O10 Media storage | #50 | `docs/log/o10.md` | merged |
| O11 Post engine | #52 | `docs/log/o11.md` | merged; lane 2 (S13–S19) spawned 2026-09-27 |
| S13 Brands, families, accounts, kits | #54 | `docs/log/s13.md` | merged |
| S14 Media library + Higgsfield commands | #58 | `docs/log/s14.md` | merged |
| S15 Posts, calendar, post pack | #59 | `docs/log/s15.md` | merged |
| S16 Telegram capture | #56 | `docs/log/s16.md` | merged |
| S17 Clip fetch + transcript | #57 | `docs/log/s17.md` | merged |
| S18 Facts import + hooks library | #55 | `docs/log/s18.md` | merged |
| S19 Docs + local setup | #53 | `docs/log/s19.md` | merged |
| Fix: Neon transactions, reaper start time | #63 | — | merged |
| S20 Link pass | #64 | `docs/log/s20.md` | merged |
| O12 Meta connect + insights | #66 | `docs/log/o12.md` | merged; O13 + S21 spawned 2026-09-27 |
| S21 IG competitors + weekly report | #68 | `docs/log/s21.md` | merged; spawns nothing (lane 3 end) |
| O13 Publishing | #69 | `docs/log/o13.md` | merged; O14 not spawned yet (Anton starts it) |
| O14 Hostinger EU deploy | (branch `claude/determined-heisenberg-qeuw86`) | `docs/log/o14.md` | merged; hPanel steps UNVERIFIED until Anton deploys (§7 item 8) |

## §10. Backlog

- TikTok, YouTube Shorts, Threads, LinkedIn, Pinterest publishing.
- Comment and DM reply assistant (drafts, never auto-sends).
- Drive read-write driver (upload from the app instead of Drive for desktop).
- videoPY hand-off ("Send to videoPY") and clipping of Anton's own recordings
  (build 2 §10, unchanged).
- Model the 5,000/month free grounding allowance; re-price 3.7 Flash after
  2026-12-31 (carried).
- Retry/backoff for failed clip ingests beyond manual retry (carried).
- A/B hook testing across sibling accounts.
