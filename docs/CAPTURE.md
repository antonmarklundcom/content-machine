# Capturing a clip from your phone

**Easiest: Telegram (works with the PC off).** Send the link to your own Telegram bot.
A free Cloudflare Worker saves it straight into the database. Setup (BotFather, chat id,
`wrangler secret put`) is in [`workers/telegram-capture/README.md`](../workers/telegram-capture/README.md).

```
https://instagram.com/reel/abc #guide #factcheck #visa says 90 days?
```

`#<brand id>` sets the brand, `#inspo #competitor #factcheck #own #learn` set the purpose
(`#ai` = `#learn`: an AI tool or trick to try, summarised in `/learn` — see
[LEARN.md](LEARN.md); `/done <id>` and `/commit <id>` answer the weekly nudge), any
other `#tag` is a tag, and the rest is the note. The same hashtags work in the note of
every option below. In the inbox you can filter by brand, purpose and tag, and fix them
per clip under "Edit tags".

The options below need the app itself to be reachable from the phone.

**First: your phone has to reach the app.** The app runs on your PC
(`docs/LOCAL-SETUP.md`), so `localhost:3000` means nothing to the phone. Two options:

- **Same Wi-Fi.** Start the app with `npm run dev -- -H 0.0.0.0` (or
  `npm run start -- -H 0.0.0.0`), find the PC's address with `ipconfig`
  ("IPv4 Address", e.g. `192.168.1.20`), and use `http://192.168.1.20:3000` on
  the phone. Windows Firewall will ask once — allow private networks. Only works
  at home, with the PC on. The PWA share sheet (Option A) needs HTTPS, so on
  plain Wi-Fi only Option B works.
- **A tunnel** (e.g. Cloudflare Tunnel or Tailscale Funnel) gives the PC an
  HTTPS address that works from anywhere while the PC is on. Both options below
  work through it. Set `CLIP_TOKEN` before opening one — the app is then on the
  internet, behind its login.

Wherever this page says `<your-deployment>`, use that address.

Two ways to save a link into the inbox (`/inbox`) without opening the app and
typing anything. Both end up calling the same route, `POST /api/clips`, so a
clip saved either way behaves identically — YouTube links route straight
through ingest + analysis, everything else waits in the inbox with its note.

## Option A — the share sheet (PWA)

If this app is installed to your home screen (Safari → Share → "Add to Home
Screen"), it registers as a share target. From anywhere that has a "Share"
button — Instagram, YouTube, Safari, a podcast app —

1. Tap Share.
2. Pick "Content Engine" from the app list.
3. You land on `/share` inside the app with the link pre-filled (it's a best
   guess — some apps hand over a clean URL, others bury it in a caption; edit
   it if it guessed wrong).
4. Add a note if you want one, tap Save.

This only works while you're signed in (the share page is behind the same
login as the rest of the app) and only after the app is added to your home
screen — a share from the browser tab alone won't offer it.

## Option B — an iOS Shortcut (works from the lock screen, no login)

This is the one to use for "save this without unlocking into the app at
all" — a Shortcut hits `POST /api/clips` directly with a Bearer token, no
session cookie needed.

### One-time setup

1. **Get a token.** Someone with server access runs:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   and sets it as `CLIP_TOKEN` in `.env` (see `.env.example`), then restarts
   the app. Treat it like a password — anyone holding it can save
   clips, and a saved YouTube link spends money analysing itself.

2. **Build the Shortcut** (Shortcuts app → + → add these actions in order):
   1. **Receive input**: URLs, Text (so it works both from Share Sheet and
      from a manually-typed link).
   2. **Text** — set to `Shortcut Input` (the shared URL/text). This is what
      the next step's JSON body reads.
   3. *(Optional)* **Ask for Text** — "Note (optional)" — lets you type a
      one-line reason before it saves. Skip this step for a zero-tap save; a
      clip with no note is still useful (URL alone is the floor).
   4. **Get Contents of URL**:
      - URL: `https://<your-deployment>/api/clips`
      - Method: `POST`
      - Headers: `Authorization` → `Bearer <CLIP_TOKEN>`, `Content-Type` →
        `application/json`
      - Request Body → JSON:
        ```json
        { "url": "Shortcut Input", "note": "Ask for Text result (or omit)" }
        ```
        (Build this with Shortcuts' JSON body editor — set `url` to the
        `Text` variable from step 2, and `note` to the `Ask for Text` result
        from step 3, or leave `note` out entirely if you skipped that step.)
   5. *(Optional)* **Show Notification** — "Saved to inbox" — the response
      body's `clip.status` tells you what happened (`analyzed` for a
      YouTube link that finished, `unprocessed` for everything else,
      `failed` with `clip.error` if something broke).
   6. Name it, e.g. "Save Clip". In the Shortcut's settings, enable **"Use
      with Share Sheet"** and **"Add to Home Screen"** if you want a
      lock-screen icon too.

### Using it

- **From any share sheet**: Share → Save Clip. Works for Instagram reels,
  YouTube videos, a Safari tab, anything with a link.
- **From the lock screen**: add it as a Home Screen icon, or run it from
  Siri/the Shortcuts widget — no unlock into the app, no typing beyond the
  optional note prompt.

### Request shape, for reference

```
POST /api/clips
Authorization: Bearer <CLIP_TOKEN>
Content-Type: application/json

{ "url": "https://www.instagram.com/reel/...", "note": "why I saved this" }
```

`note` is optional. Optional capture fields: `brandId`, `purpose`
(`inspo|competitor|fact_check|own|other`) and `tags` (array or `"a, b"`); an
explicit field wins over a hashtag in the note. An unknown brand or purpose is a
`400`. A Bearer call is recorded with source `shortcut`. Response is `201` (new clip) or `200` (already saved —
the note is updated, nothing duplicates) with the clip row as JSON, or a
`4xx`/`5xx` with `{ "error": "..." }` — most commonly `503` if `CLIP_TOKEN`
isn't set in `.env` yet.
