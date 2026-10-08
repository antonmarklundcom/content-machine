# PLAN — content-engine build 4: voice, stories, video, learn, growth

Build 3 (`PLAN.md`) made content-engine the social OS for every brand. Build 4
makes it the **one** content app: Paraguayan voice (castellano paraguayo with
voseo, Jopará, Guaraní), cuentos.com.py story production, video rendering with
captions, the aiinsights "learn" inbox, YouTube/TikTok publishing, and growth
tools. videoPY's voice/render/clip track moves here (Node + ffmpeg), so voice
setup is done once, in one program.

Same stack and rules as build 3: Next.js App Router, Neon/Postgres via drizzle,
`structuredJson()` for model calls, every paid call through `withSpendCap`,
media bytes under `MEDIA_ROOT`, Neon holds text and links only.

## §1. Decisions — do not re-litigate

1. **One app.** Voice, video and stories live in content-engine. Rendering is
   ffmpeg/ffprobe via `child_process` (already used by clip fetch). No Python.
2. **Never invent Guaraní.** The script writer may only use Guaraní words that
   are in `glossary_terms` with `review_status = approved` and `jopara_ok`
   (plus the safe list in `content/style/jopara.md`). Pure Guaraní text is
   written or approved by a person, never generated.
3. **Approved text only.** A story scene is narrated in a language only when
   its text status for that language is approved (`approved`, `final`,
   `reviewed`, `locked`, or the in-app `approved-in-app`). Unknown or pending
   status refuses. Text that contains a pending-review notice
   (`PENDIENTE`, `pending review`, `TODO`, `[??]`, `REVISAR`) always refuses.
   A missing language is never filled from another language.
4. **Guaraní audio is recorded by people.** No TTS service speaks Guaraní. The
   `manual` provider uploads a recording (native speaker) as a take. TTS
   providers refuse `gn` with `language_not_supported`.
5. **Consent before cloning.** A profile whose voice is a cloned or recorded
   person (`consent_status` ≠ `not_needed`) makes takes only while `signed`
   and not expired. `pending`/`revoked` refuse with `consent_missing`.
6. **Every take is kept.** `narrations` is the take history: WAV master + MP3
   playback (both registered `assets`), measured duration, word timings when
   the provider gives them, review status, one `selected` take per
   (owner, scene, language, speaker).
7. **Never time-stretch narration.** Scene length = measured narration +
   padding. Each language is timed from its own audio, so runtimes differ.
8. **Frame, don't crop.** Portrait (4:5) art sits whole inside 16:9 over a
   blurred, darkened copy of itself. Camera moves are gentle (≤ 8% zoom).
9. **Captions are separate files** (SRT + VTT) per language; burning them in is
   an option, never the only copy.
10. **The cuentos repo stays the source of truth** for manuscript text, art and
    review status. Import is read-only on `CUENTOS_ROOT`; audio and video
    outputs go to `MEDIA_ROOT/stories/<slug>/…`. An "export to cuentos" step
    copies selected takes into the book's `audio/` folder only on click.
11. **Comment replies are drafts.** Nothing is ever sent automatically.
12. **YouTube and TikTok publishing** are built against recorded API fixtures;
    live paths are UNVERIFIED until Anton connects the accounts (TikTok public
    posting also needs an audited developer app).
13. **Learn (aiinsights merge):** `#learn`/`#ai` in a Telegram capture sets
    purpose `learn`. `npm run learn:process` summarises learn clips (what it
    is, why it matters, how to start, category) with `structuredJson`; GitHub
    links are grounded with their README; screenshots go through Gemini vision.
    Weekly nudge = one unimplemented item, no model call.
14. **Higgsfield through Claude Code.** The app never holds a Higgsfield key.
    A "Generate with Higgsfield" job spawns the logged-in `claude` CLI on
    Anton's PC with a slash command (`/higgsfield-post` …), the inline brief
    and a hard credit ceiling; the Higgsfield MCP spends his subscription
    credits; files land under `MEDIA_ROOT` and are registered by the media
    scan. Table `higgsfield_jobs` (migration 0010) tracks every run.
15. **Build models:** Opus subagents at low/medium effort. Never Fable.

## §2. Schema and contracts (foundation, already merged)

Migration `drizzle/0009_build4_voice_stories.sql` adds `voice_profiles`,
`pronunciations`, `glossary_terms`, `narrations`, `stories`, `story_scenes`,
`video_renders`, `comment_drafts`, `content_gaps`; columns
`clips.{learn_category, how_to_start, implemented_at, committed_at}`,
`posts.{lead_url, publish_options}`, `brand_kits.lead_base_url`; purpose
`learn`; integration provider `youtube`.

Contracts: `src/lib/voice/contract.ts` (`NarrateRequest/Result`,
`NarrationRefusedError`, `WordTiming`, `VoiceSettings`),
`src/lib/video/contract.ts` (`RenderRequest/Result`, `RenderScene`). Public
entry points `narrate()` (`src/lib/voice/index.ts`) and `renderVideo()`
(`src/lib/video/index.ts`) are stubs until phases A and B land. Folders:
`narrationFolder()`, `storyVideoFolder()`, `renderFolder()` in
`src/lib/storage/paths.ts`. Settings fields and `.env.example` entries for
every new key are in place. Empty i18n dicts are wired for each phase.

## §3. Phases

All phases branch from the foundation commit and run in parallel. A phase
writes only to its **Owns** paths plus its own tests and `docs/log/b4-<id>.md`.
Shared files (`package.json`, `Header.tsx`, home page, other phases' pages,
`dictionary.ts`, schema) are edited only in the link pass; a phase lists what
it needs there in its log under "Link pass".

| Id | Phase | Effort | Owns |
|---|---|---|---|
| A | Voice engine + voice studio | medium | `src/lib/voice/**` (contract additive only), `src/lib/voice.actions.ts`, `src/app/voice/**`, `src/app/api/voice/**`, `src/components/{Voice,Narration,Pronunciation}*.tsx`, `src/lib/i18n/dict/voice.ts`, `scripts/voice-*.ts`, `docs/VOICE.md` |
| B | Video render + captions | medium | `src/lib/video/**` (contract additive only), `src/lib/video.actions.ts`, `src/app/video/**`, `src/app/api/video/**`, `src/components/Render*.tsx`, `src/lib/i18n/dict/videoRender.ts`, `scripts/video-*.ts`, `docs/VIDEO.md` |
| C | Cuentos story studio | medium | `src/lib/stories/**`, `src/lib/stories.actions.ts`, `src/app/stories/**`, `src/app/api/stories/**`, `src/components/Story*.tsx`, `src/lib/i18n/dict/stories.ts`, `scripts/stories-*.ts`, `tests/fixtures/cuentos/**`, `docs/CUENTOS.md` |
| D | Guaraní glossary + language rules | low | `src/lib/glossary/**`, `src/lib/glossary.actions.ts`, `src/app/glossary/**`, `src/components/Glossary*.tsx`, `src/lib/i18n/dict/glossary.ts`, `content/style/gn.md`, `content/style/jopara.md`, `content/glossary/**`, `src/lib/posts/guides.ts`, `src/lib/scripts/language.ts`, prompt-assembly lines in `src/lib/ai.ts` |
| E | Learn (aiinsights merge) | medium | `src/lib/learn/**`, `src/lib/learn.actions.ts`, `src/app/learn/**`, `src/app/api/learn/**`, `src/components/Learn*.tsx`, `src/lib/i18n/dict/learn.ts`, `scripts/learn-*.ts`, `workers/telegram-capture/**`, `docs/LEARN.md` |
| F | YouTube + TikTok publishing | medium | `src/lib/publish/**`, `src/lib/google/**`, `src/lib/tiktok/**`, `src/app/api/youtube/**`, `src/app/api/tiktok/**`, `src/app/settings/**` (new sections only), `src/components/{YouTube,TikTok}*.tsx`, `src/lib/i18n/dict/publishVideo.ts`, `docs/PUBLISH-VIDEO.md` |
| G | Growth: comments, gaps, results, lead links | medium | `src/lib/{comments,gaps,results,leads}/**`, `src/lib/{comments,gaps,leads}.actions.ts`, `src/app/{comments,results}/**`, `src/app/research/gaps/**`, `src/components/{Comment,Gap,Results,LeadLink}*.tsx`, `src/lib/i18n/dict/growth.ts`, `scripts/{comments,gaps}-*.ts`, `docs/GROWTH.md` |
| H | Higgsfield bridge (Claude Code + Higgsfield MCP) | medium | `src/lib/higgsfield/**`, `src/lib/higgsfield.actions.ts`, `src/app/higgsfield/**`, `src/app/api/higgsfield/**`, `src/components/Higgsfield*.tsx`, `src/lib/i18n/dict/higgsfield.ts`, `scripts/higgsfield-*.ts`, `.claude/commands/higgsfield-*.md`, `docs/HIGGSFIELD.md` |
| L | Link pass (orchestrator) | — | everything shared: nav, home cards, `package.json` scripts, mounts, KNOWN-ISSUES, README |

Tests: unit tests next to the code (`*.test.ts`, run by `npm test`),
integration tests in `tests/integration/b4-<id>-*.test.ts` (run by
`npm run test:db` against Postgres). Providers and ffmpeg calls sit behind
small seams so tests run without keys. Tests that need ffmpeg use the real
binary and skip (with a message) when it is not on PATH.

## §4. Human inputs (Anton)

1. Keys in Settings: ElevenLabs and/or Azure Speech (es-PY), Gemini already.
2. Voice gate: open /voice → "Voice test", render the same 45 s script with
   3–4 voices, pick per language.
3. A Guaraní speaker: records the `gn` takes in /stories (upload per scene)
   and reviews `glossary_terms` and `pronunciations` in /glossary.
4. Signed consent for any cloned/recorded voice, uploaded on its profile.
5. `CUENTOS_ROOT=C:\dev\cuentos`, then `npm run stories:import`.
6. YouTube: Google OAuth client; TikTok: developer app (audit for public posts).

## §5. Build log index

| Phase | Log | State |
|---|---|---|
| Foundation | — | merged |
| A Voice engine + voice studio | `docs/log/b4-a.md` | merged |
| B Video render + captions | `docs/log/b4-b.md` | merged |
| C Cuentos story studio | `docs/log/b4-c.md` | merged |
| D Guaraní glossary + language rules | `docs/log/b4-d.md` | merged |
| E Learn (aiinsights merge) | `docs/log/b4-e.md` | merged |
| F YouTube + TikTok publishing | `docs/log/b4-f.md` | merged |
| G Growth: comments, gaps, results, lead links | `docs/log/b4-g.md` | merged |
| H Higgsfield bridge | `docs/log/b4-h.md` | merged |
| L Link pass | — | merged: nav, npm scripts, mounts (studio Voice & video page, post lead link / publish options / Higgsfield / glossary warnings, kit lead base), fake payloads, PC-only guard (`APP_MODE=online`), O14 follow-ups, sample-render fix, docs |
