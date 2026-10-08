# Publishing to YouTube and TikTok

Build 4 §3.F. Video and reel posts on a YouTube or TikTok account go out through the same
publisher as Instagram/Facebook (O13): `npm run publish:due`, `/api/cron/publish` and the post's
"Publish now" button, with the same leases, retries and "never post twice" rules.

> **Live paths are UNVERIFIED** (PLAN-build4 §1.12). Everything is built and tested against
> recorded API fixtures (`tests/integration/fixtures/video/`). The first real upload after
> connecting is the real test: publish one private video and check it.

## What gets published

| Account platform | Post formats | What is sent |
| --- | --- | --- |
| YouTube | `video`, `reel` with exactly one video attached | the video (resumable upload), optional `thumbnail` asset |
| TikTok | `video`, `reel` with exactly one video attached | the video (chunked upload) |

Anything else (image posts, carousels, stories, text) is refused with the reason in the post's error.
Files are read straight from `MEDIA_ROOT` — the media drive must be connected; no public copy is made.

## YouTube setup

1. **Google Cloud project.** <https://console.cloud.google.com/> → create a project → *APIs & Services →
   Library* → enable **YouTube Data API v3**.
2. **OAuth consent screen.** User type *External*. Add the scopes `.../auth/youtube.upload` and
   `.../auth/youtube.readonly`. Add your Google account as a *test user*.
   While the screen is in **Testing**, Google ends the login after **7 days** (reconnect, or
   *Publish app*; with only your own accounts no verification review is needed to keep working,
   but Google shows an "unverified app" warning).
3. **OAuth client.** *Credentials → Create credentials → OAuth client ID → Web application*.
   Authorized redirect URIs (Settings → YouTube lists the exact ones):
   - `http://localhost:3000/api/youtube/oauth/callback`
   - `https://<your online host>/api/youtube/oauth/callback`
4. **Keys.** Settings → YouTube → paste *Client ID* and *Client secret* (saved to `.env` as
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`; localhost only). An `ENCRYPTION_KEY` is
   created if there is none — keep a copy of `.env`.
5. **Connect.** "Connect YouTube" → pick the channel on Google's account chooser (a brand channel is
   its own identity there). One connection per channel; connect again for another channel.
6. **Link.** A YouTube account in /accounts whose handle equals the channel's `@handle` is linked
   automatically; otherwise pick the connection next to the account in Settings → YouTube.

The refresh token is stored encrypted (`integrations`, provider `youtube`); access tokens are
renewed automatically before each upload.

### Privacy defaults

- Every upload is **private** unless the post's YouTube options say `unlisted` or `public`.
- **Audit:** videos uploaded through an API project that Google has not audited are locked to
  private anyway. Ask for the audit (YouTube API Services compliance form) before relying on
  public uploads.
- *Go public on YouTube at* (optional) uploads now as private with `publishAt`; YouTube flips it
  public at that time.
- *Notify subscribers* off sends `notifySubscribers=false`.

### Shorts

A video that is **vertical and at most 3 minutes** (from the asset's measured width, height and
duration) is a Short: ` #Shorts` is added to the title (kept within 100 characters) and to the
description, once. Its link is `youtube.com/shorts/<id>`. Unknown size or length is treated as a
long video.

### The kids rule (cuentos → made for kids)

YouTube requires `selfDeclaredMadeForKids = true` for content made for children (COPPA). A brand
whose id, domain or niche says cuentos / kids / children / niños / infantil **always** uploads as
made for kids, whatever the post's option says (the post notes it when it overrode a "no"). Other
brands use the post's option, default "not made for kids".

### Title, description, tags

Title = the post's title (else the caption's first line), `<` `>` removed, ≤ 100 characters.
Description = the caption + the post's lead URL (if any) + `#Shorts` for Shorts; over 5000 bytes
is refused. Tags = the caption's hashtags (without `#`, ≤ 500 characters). Category from the
options (default 22, People & Blogs); language from the account, else the brand.

### Thumbnail

Attach an image with role `thumbnail`. It is set after the upload with `thumbnails.set` (≤ 2 MB;
needs a verified channel). A failed thumbnail does not fail the post — it is noted.

## TikTok setup

1. **Developer app.** <https://developers.tiktok.com/apps/> → *Create app*. Add the products
   **Login Kit** and **Content Posting API** (turn on *Direct Post* in it for direct mode).
2. **Redirect URI** in Login Kit: `https://<your online host>/api/tiktok/oauth/callback`. TikTok
   wants https; for a local test use a tunnel to `localhost:3000`.
3. **Scopes:** `user.info.basic`, `video.upload`, `video.publish`. While the app is in *sandbox*,
   add your TikTok account as a target user.
4. **Keys.** Settings → TikTok → *Client key* and *Client secret* (`TIKTOK_CLIENT_KEY` /
   `TIKTOK_CLIENT_SECRET`).
5. **Connect** and log in as the creator account; **link** it to the TikTok account in Settings.

Access tokens last 24 hours and are refreshed automatically; the login itself ends after a year
(Settings warns two weeks before).

### Modes and the audit

- **Inbox (default).** The video is uploaded to the creator's TikTok **inbox (drafts)**; open the
  TikTok app, paste the caption, and post. Works **without** TikTok's app audit. The post is marked
  published with the note "in the TikTok inbox".
- **Direct.** Posts with the caption as the title. Right before posting, `creator_info` says which
  privacy levels the account allows; a choice outside them is refused before anything is sent.
  **Unaudited apps may only post `SELF_ONLY`, and only to private accounts** — public direct
  posting needs TikTok's audit of the app.

TikTok processes the upload after it is sent. The publisher polls the status; if it is still
processing, the post stays *publishing* with its `publish_id` and the next run checks again
(never uploading twice).

## Troubleshooting

| Message | What to do |
| --- | --- |
| `… is not linked to YouTube/TikTok` | Settings → YouTube/TikTok → pick the connection next to the account. |
| `refused to renew the login … Reconnect` | The refresh token was revoked or expired (7-day Testing limit on Google). Connect again. |
| `Google sent no refresh token` | Remove content-engine at myaccount.google.com/permissions, then connect again. |
| `quotaExceeded` | The project's daily YouTube quota (10 000 units; an upload costs 1 600) is used up. Try tomorrow or ask Google for more. |
| `… may exist: check YouTube Studio` | The last chunk was sent but never confirmed. Check Studio before "Publish now", or you may get a duplicate. |
| `TikTok did not confirm the end of the upload` | Same for TikTok: check the account (or the inbox) first. "Publish now" re-checks the same `publish_id`. |
| `does not allow privacy …` | Use "Only me" (SELF_ONLY) until the app is audited, or switch to inbox mode. |
| `unaudited_client_can_only_post_to_private_accounts` | Make the TikTok account private, or use inbox mode. |
| `not found under MEDIA_ROOT` | Plug in the media drive / check `MEDIA_ROOT`; the file is read from there. |
| `Temporary: …` | A rate limit or outage; the due run retries after 5, 10, 20 minutes (3 attempts). |
