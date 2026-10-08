# The daily loop — from a saved reel to a posted post

content-engine is where every brand's social media lives: brands and their
accounts, the media, the posts, the calendar and the research behind them
(PLAN.md build 3). No brand is special; everything below works the same for
each one.

Build 3 lands in phases, so steps that still wait on lane 3 are marked **arrives with O1x**:
the page or command does not exist on `main` yet. Until then the step's API
route or the older page does the job, as noted.

```
capture → research → idea → post → Higgsfield → pack → posted → metrics
```

## The pieces

- **Family → Brand → Account → Post → Assets.** A *family* groups brands that
  share facts and research (e.g. the Paraguay residency brands, one per
  language). An *account* is one handle on one platform in one language. A
  *post* belongs to one account and holds its media in order.
- **Media** is files on the office drive (`MEDIA_ROOT`), see
  [STORAGE.md](STORAGE.md).
- **Money:** every paid AI call goes through the monthly cap,
  `MONTHLY_SPEND_CAP_USD` (default $25). `npm run yt:spend` shows this month.

## 1. Capture — save what you see on the phone

- **Today:** the share sheet or iOS Shortcut saves a link into `/inbox`
  ([CAPTURE.md](CAPTURE.md)). Needs the PC on and reachable.
- **Telegram**: send the link to your bot, with
  `#<brand>` and `#inspo`, `#competitor`, `#factcheck` or `#own`. Works while
  the PC is off (a free Cloudflare Worker). Setup: `workers/telegram-capture/README.md`.

## 2. Research — what is worth saying

- `/research` — YouTube competitors, outliers, digests and the weekly report;
  `npm run yt:poll` keeps it fresh hourly ([LOCAL-SETUP.md §7](LOCAL-SETUP.md#7-scheduled-jobs-optional-once)).
- `/facts` and `/lessons` — facts per brand, and hooks/title patterns you saved.
  Family facts imported from a site with `npm run facts:import` and a hooks
  library at `/hooks` arrive with S18.
- **Fetch + transcribe a reel**: `npm run clips:fetch`
  downloads saved `#factcheck` / `#competitor` clips with yt-dlp and asks Gemini
  for transcript, summary and claims; `/clips/<id>` shows them. Research only:
  other people's media is never republished.

## 3. Idea

`/brand/<id>` generates researched post ideas per brand (owner only, spends).
Keep the good ones.

## 4. Post — written for engagement

- `/posts/new` turns an idea or a topic into a draft for
  one account: hook, caption, CTA, hashtags, slides / shots / story frames, and
  the sources for every claim (API: `POST /api/posts`).
- **Adapt to family** writes the same post for every sibling account in its
  own language (`POST /api/posts/<id>/adapt`; or the button on the post page).
- Rewrite one section without touching the rest (`POST /api/posts/<id>/regenerate`).
- Brands, families, accounts and brand kits (colours, fonts, CTAs, Higgsfield
  element ids) are edited at `/brands`.

## 5. Higgsfield — make the visuals

Runs in **Claude Code on the office PC**, because it saves to the media drive;
a cloud session cannot reach it ([HIGGSFIELD.md](HIGGSFIELD.md)).

- The brief: `GET /api/posts/<id>/export?format=brief` — every visual with
  its prompt, target file name and brand kit references.
- `/higgsfield-post <post id>` generates them into the post's folder, and
  `/higgsfield-import` pulls old Higgsfield history into `_inbox/higgsfield/`
  (both arrive with S14).
- Then register the files:
  ```powershell
  npm run media:scan
  ```
  `/media` is where you approve, tag and attach them.

## 6. Pack — everything to post from the phone

`/posts/<id>/pack`: the caption with a copy button and the
media in order with download links (API:
`GET /api/posts/<id>/export?format=pack`).

## 7. Posted

Post by hand from the phone, then **Mark posted** with the permalink on the
pack page. The calendar at `/calendar`
shows what is scheduled per account or family.

Automatic publishing to Instagram and Facebook arrives with O13:
`npm run publish:due` from Task Scheduler every 5 minutes. It needs the public
media copy ([STORAGE.md §5](STORAGE.md#5-the-public-copy-on-hostinger-eu-once-needed-only-to-publish)).

## 8. Metrics — what worked

Instagram reach, saves and follows per post arrive with O12 (Meta connect),
and feed the next drafts ("what worked"). Competitor Instagram accounts and a
weekly report arrive with S21.

## A normal day

1. Morning: open `/research` — the hourly poll already screened new videos.
2. Save a few ideas or turn one into a post for each account that needs one.
3. Adapt it to the family, then run `/higgsfield-post` in Claude Code on the PC.
4. `npm run media:scan`, attach the media, open the pack on the phone, post.
5. Mark posted.
