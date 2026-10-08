# B4-F — YouTube + TikTok publishing

Worktree branch off the build 4 foundation `d1998d8`.

## Built

- `src/lib/google/`: OAuth web flow (offline + consent, `youtube.upload` + `youtube.readonly`), code → tokens, refresh, `channels?mine=true`, fetch seam + error mapping.
- `src/lib/tiktok/`: OAuth v2 (`user.info.basic,video.upload,video.publish`), token/refresh, `user/info`, envelope parsing (int64 post ids kept as strings).
- `src/lib/publish/connections.ts`: one `integrations` row per channel / creator; access + refresh token sealed together (AES-GCM JSON), auto-refresh, `invalid_grant` → `expired`; link/unlink accounts.
- `src/lib/publish/youtube.ts`: snippet/status builder (private default, kids rule, `#Shorts` for vertical ≤ 3 min, tags from hashtags, lead URL, `publishAt`), resumable chunked upload from MEDIA_ROOT with `bytes */N` resume, `thumbnails.set`.
- `src/lib/publish/tiktok.ts`: inbox (default) and direct (`creator_info` → privacy check → `video/init`) with chunk plan, chunked PUT, status polling and cross-run resume from `publish_id`.
- `plan.ts` / `index.ts` / `video.ts`: youtube/tiktok route through `publishPost`/`publishDue` (same leases, status claim, backoff, interrupted guard); non-video formats refused with a reason.
- Routes `/api/{youtube,tiktok}/oauth/{start,callback}` (owner, state cookie, tokens never in redirects).
- Settings → YouTube / TikTok sections (`VideoPlatformSection.tsx`, `VideoForms.tsx`): setup steps, redirect URIs, key form (.env, localhost), Connect, connections + banners, per-account link.
- `YouTubePublishOptions` / `TikTokPublishOptions` editors + `savePublishOptionsAction` (namespaced `publish_options.{youtube,tiktok}`).
- `docs/PUBLISH-VIDEO.md`; dict `publishVideo.*` (en + sv).
- Tests: unit (`options`, `plan`, `youtube`, `tiktok`, google/tiktok `oauth`); `tests/integration/b4-f-publish-video.test.ts` (12) on `fixtures/video/`.

## Decisions

- Files are uploaded from MEDIA_ROOT (no `publishCopy` public URL): both APIs take bytes.
- Kids rule: a brand whose id/domain/niche matches cuentos|kids|children|niñ|infantil is always `selfDeclaredMadeForKids: true`, overriding the post option (noted on the post).
- YouTube upload is one synchronous run (no cross-run session resume); an unconfirmed last chunk is non-temporary ("may exist"), mid-file breaks are temporary.
- TikTok inbox posts are marked `published` with a note ("in the TikTok inbox"); `external_media_id` = publish_id (direct: the post id).
- Post-upload extras (thumbnail, "private until you change it", kids override) are notes in `publish_error`, like O13's permalink/comment notes.
- Outside Owns (needed to keep O13 green): `tests/integration/publish.test.ts` — the "not built" refusal case now uses a `threads` account instead of `tiktok`.

## Known issues

- Live paths UNVERIFIED (§1.12): fixture shapes follow Google/TikTok docs; first real upload should be a private test.
- Post lease TTL is 10 min; a YouTube upload longer than that can be marked "interrupted" by a parallel due run (it still ends `published`). Access token (1 h) is not refreshed mid-upload.
- YouTube needs an audited API project for non-private uploads; Google "Testing" consent ends the login after 7 days.
- TikTok redirect URIs must be https (localhost needs a tunnel); inbox posts have no caption (paste it in the app).
- Settings makes no API call per render, so a revoked login shows only after the next publish/refresh attempt.

## Link pass

- Mount `<YouTubePublishOptions postId publishOptions kidsBrand />` / `<TikTokPublishOptions postId publishOptions />` in `src/app/posts/[id]/page.tsx` for posts on youtube/tiktok accounts (`kidsBrand` from `isKidsBrand(brand)` in `src/lib/publish/options.ts`).
- `src/lib/i18n/dict/publishNow.ts`: "Settings → Meta" / "Meta is still processing" strings are Meta-only; make them platform-neutral now that youtube/tiktok are in `PUBLISHABLE_PLATFORMS`.
- `src/lib/settings/fields.ts`: optionally list `GOOGLE_OAUTH_CLIENT_*` / `TIKTOK_CLIENT_*` (Settings → YouTube/TikTok already writes them).
- KNOWN-ISSUES / README: link `docs/PUBLISH-VIDEO.md`; PLAN-build4 §5 row for F.

Verification: `npm run typecheck`, `npm run lint`, `npm test` (393 pass), `npm run test:db` green locally on the final commit.
