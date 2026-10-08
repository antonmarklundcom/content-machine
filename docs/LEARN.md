# Learn — AI tools to try (the aiinsights merge)

The old **aiinsights** app now lives inside content-engine (docs/PLAN-build4.md §1.13).
Links and screenshots about AI tools are captured with the same Telegram bot as every
other clip, summarised with "what it is, why it matters, how to start", listed on
`/learn`, and once a week one of them is sent back to you as a nudge.

## 1. Capture

Send the capture bot (docs/CAPTURE.md) a link with `#learn` or `#ai`:

```
https://github.com/some/repo #learn looks like a better cursor rules setup
```

- the link is the clip, `#learn`/`#ai` sets purpose `learn`, other `#tags` are tags,
  the rest is the note (the note is the floor: it is kept whatever happens later);
- a **screenshot** works too: send the photo with `#learn` in the caption. With no link
  it is saved under a `https://telegram.invalid/file/…` placeholder and read by Gemini
  vision when it is summarised;
- the in-app inbox form works as well: pick purpose "learn".

## 2. Summarise

```bash
npm run learn:process                # learn clips with no category yet, oldest first (20)
npm run learn:process -- --limit 50
npm run learn:process -- --id 42     # one clip
npm run learn:process -- --force     # re-run clips that already have a summary
npm run learn:process -- --retry-failed
```

Or press **Summarise / Re-run summary** on a card in `/learn`.

For each clip it gathers, best effort: the note; page title and description (safe fetch:
http(s) only, no local addresses, 10 s timeout, size cap); the README of a `github.com`
repo (the link itself or the first repo link in the note — set `GITHUB_TOKEN` to raise
GitHub's rate limit); YouTube captions for YouTube links; a transcript or caption the
clip already has from `npm run clips:fetch`; and for screenshots (`TELEGRAM_BOT_TOKEN`)
what Gemini vision reads off the image. Then one structured call writes `summary`,
`how_to_start`, `learn_category` (one of the 11 aiinsights categories) and adds tags.

Cost: the summary goes through `structuredJson` — Gemini under the monthly spend cap, or
free with `AI_PROVIDER=claude-cli` / `codex-cli`. Screenshots always use Gemini
(Flash-Lite, under the cap). A clip with nothing to go on (bare Instagram link, no note)
is not sent to the model: it gets an error asking for a note. Failures are written to the
clip's error and shown on its card; the link and note stay.

Two runs never process the same clip (each clip is held under a lease while it runs).

## 3. `/learn`

Owner-only. Category badges with counts, filters for implemented / committed, search
over title, note, summary, URL and tags. Each card: summary, how-to-start steps, link,
tags, and **Summarise**, **Mark implemented** (undo), **Commit this week** (undo),
**Delete**.

## 4. The weekly nudge

One unimplemented learn item a week, no model call: an item you committed to and have
not finished comes first, otherwise the oldest item not nudged in the last 14 days. It is
sent to the **first** chat id in `TELEGRAM_ALLOWED_CHAT_IDS`. Reply in the chat:

- `/commit <id>` — take it on this week (next nudge asks about it);
- `/done <id>` — mark it implemented.

Pick **one** sender:

**a) Cloudflare Worker cron (PC can be off).** `workers/telegram-capture/wrangler.toml`
has `crons = ["0 12 * * 5"]` (Fridays 12:00 UTC). Give the Worker the bot token, then
deploy:

```bash
cd workers/telegram-capture
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put APP_URL        # optional: adds a /learn link
npm run deploy
```

**b) Windows Task Scheduler.** Remove the `[triggers]` block from `wrangler.toml` (and
redeploy), then schedule weekly, Friday 13:00, "Start a program":
`cmd.exe` with arguments `/c cd /d C:\dev\content-engine && npm run learn:nudge`.
`npm run learn:nudge -- --dry-run` prints the message without sending. Needs
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS` (and optionally `APP_URL`) in `.env`.

`/done` and `/commit` are handled by the Worker, so they work with either sender.

## 5. Importing the old aiinsights items

```bash
# .env: AIINSIGHTS_DATABASE_URL=<aiinsights' DATABASE_URL>
npm run learn:import-aiinsights -- --dry-run   # counts only
npm run learn:import-aiinsights
```

Read-only on aiinsights (one `select * from items`). Each item becomes a learn clip with
its summary, steps, category, tags (plus `aiinsights`), note (plus `Repo: …` when the repo
was not the link), caption, transcript, implemented flag, commitment and saved date.
Screenshot items (`tg://photo/<file_id>`) get `https://telegram.invalid/aiinsights/<file_id>`.
Idempotent by canonical URL: run it again any time; a link already in content-engine
(saved some other way) is left alone and counted as "already present". Items that were
never summarised arrive without a category and are picked up by `npm run learn:process`.
Items you had dropped in aiinsights get the tag `aiinsights-dismissed` (delete them in
`/learn` if you do not want them nudged).

## 6. Retiring aiinsights

1. Run the import; check `/learn` shows your items (filter `#aiinsights` in search).
2. Point the Telegram bot at the content-engine Worker (docs/CAPTURE.md). If aiinsights
   used a different bot, either keep using the new one or set the old token on the Worker
   with `npm run setup` there. Screenshots imported from a different bot cannot be
   re-read (their `file_id` belongs to that bot); their summaries are already imported.
3. Run both side by side for a week, then delete the aiinsights Vercel cron and project.
   Keep its Neon database (read-only) until you are sure nothing is missing.
