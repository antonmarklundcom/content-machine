# Telegram capture Worker

Send a link to the Telegram bot from a phone and it lands in the content-machine
inbox, even while the PC is off. The Cloudflare Worker uses a Hyperdrive binding
to reach the app's MariaDB database. Hyperdrive credentials are kept in the
Cloudflare account and do not appear in source or test fixtures.

## Message grammar

```text
https://instagram.com/reel/abc #guide #factcheck #visa says 90 days?
```

- The first link is the clip; tracking parameters are stripped by the shared URL
  canonicalizer.
- `#<brand id>` or an alias from `TELEGRAM_BRAND_ALIASES` sets the brand.
- `#inspo`, `#competitor`, `#factcheck`, `#own`, and `#learn` (`#ai`) set purpose.
- Other hashtags become tags; remaining text becomes the note.
- Telegram photo/video files retain their file id for PC-side media fetching.

The Worker only serves requests with Telegram's configured secret token and
chat ids in `TELEGRAM_ALLOWED_CHAT_IDS`. Empty allowlists serve nobody. A duplicate
canonical URL updates only its note (and keeps the old note when the new message
has none). The MariaDB adapter verifies the exact URL after an upsert against the
SHA-256 unique key, so a hash collision cannot be treated as a duplicate of a
different URL.

## Database binding

Create a Cloudflare Hyperdrive configuration for the app's MariaDB database and
replace the placeholder `HYPERDRIVE.id` in `wrangler.toml` with its returned id.
The database account should have only the permissions required for this Worker:
read active brands; insert/update clips; read learn clips; update learn status;
and insert/update lease markers. Hyperdrive supports MySQL/MariaDB-compatible
databases through mysql2. The config uses the `nodejs_compat` flag and mysql2's
`disableEval` option.

The Worker uses one short-lived mysql2 connection per SQL operation; Hyperdrive
pools the origin connections. It never receives a `DATABASE_URL` secret. Other
secrets (`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`, and optionally
`TELEGRAM_BOT_TOKEN`) belong in Cloudflare's secret store. Optional plain values
are `TELEGRAM_BRAND_ALIASES` and `APP_URL`.

No Hyperdrive binding has been created, and the Worker has not been deployed or
registered with Telegram as part of the database conversion. Confirm Cloudflare
account availability, Hyperdrive plan/limits, and outbound connectivity to the
chosen Hostinger MariaDB before separately authorizing setup or deployment.

## Learn commands and weekly nudge

- `/done <id>` marks a learn clip implemented; `/commit <id>` commits to it.
  Commands from chats outside the allowlist are ignored.
- The optional Cron Trigger runs Friday 12:00 UTC and sends one unimplemented
  learn item to the first allowed chat. It requires `TELEGRAM_BOT_TOKEN`. Choose
  this sender or `npm run learn:nudge` on the PC, never both.

## Development and tests

From this folder, `npm install`, `npm test`, and `npm run typecheck` validate the
Worker package. Tests use mocked providers and a synthetic MariaDB integration
service from the root test workflow. The parser and URL canonicalizer come from
the shared app source, so capture deduplication uses the same normalization.
