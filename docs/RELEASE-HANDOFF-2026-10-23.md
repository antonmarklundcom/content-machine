# Release and recovery handoff — 23 October 2026

Follow-up to PR5 (merged as `624d8b99a03a0013c7a0dfc140dd5af5795d6f0c`, tree identical
to tested head `fb1264d562128925ec3ce98edded12f19f7acd80`). This note covers what the
follow-up branch `claude/release-readiness-20261023` changes, what the live site is
running, and the exact owner steps for release, rollback, acceptance and recovery.
Nothing here was deployed, migrated, scheduled or sent.

## What the live site is running (read-only evidence)

On 23 October 2026 at 14:24 UTC the public login page at
`https://content.antonmarklund.com/youtube/login` returned 200 with
`X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: private, no-store`.
Its script bundle includes the app's translation dictionary. Four strings that PR5
added to that dictionary (capture network/expiry recovery, manual transcript, scan
errors) were **absent** from the live bundle, while older strings were present. The
same check against a local build of this branch found all four.

Conclusion: the live site was **not** built from PR5 or later at that time; it is an
earlier (PR4-era) build. PR5's private-media, login-throttling and capture fixes are
therefore not live yet. This is presence/absence evidence, not an exact commit: no
build log, deployment record or release identity was available. Branding alone
proves nothing.

Re-check after a deployment (read-only, no login):

```sh
curl -s https://content.antonmarklund.com/youtube/login -o login.html
grep -o '/_next/static/[^"]*\.js' login.html | sort -u | while read c; do curl -s "https://content.antonmarklund.com$c"; done > chunks.js
grep -c -F "Sign in in a new tab, then retry here" chunks.js   # 1 or more = PR5 or later
grep -c -F "Already in your inbox. Nothing new was created" chunks.js   # 1 or more = this follow-up
```

## Changes on this follow-up branch

| Area | Change | Evidence |
|---|---|---|
| R03 Windows CLI containment | PC CLI runs start inside a kill-on-close Windows Job Object (PowerShell launcher, suspended start, verified membership). Wrapper exit, timeout, output overflow and cancel stop every process in the job, including inherited-pipe and detached descendants. Unrelated processes are untouched; no PID is trusted. Launcher failure is reported as "not allowed to run". | `src/lib/higgsfield/win-job.ts`, `process.ts`; Windows synthetic tree tests |
| Recovery | `npm run media:verify-restore -- SOURCE RESTORED` compares media byte hashes, requires both identity-marker folders, never writes, reports private areas only as counts | `scripts/verify-media-restore.mjs`; unit tests and a synthetic rehearsal |
| Capture receipts | A re-shared link says "Already in your inbox" and names its stored purpose instead of a bare "Saved." | `src/lib/clips/receipt.ts` |
| Login | A failed sign-in keeps the typed email and focuses the password | `LoginForm.tsx`, `auth/actions.ts` |
| Staff guidance | Staff Start page points to the inbox and labels lesson review as an owner step; permissions unchanged | `HomeLaunchpad.tsx` |
| Accessibility | Skip-to-content link; main landmarks on Studio, Posts and Calendar; header stops being sticky on short viewports (200% zoom); OAuth callback URLs wrap on phones | `Header.tsx`, layouts |
| New post | With no account, the page links to Brands, where a planned account needs no connection | `posts/new/page.tsx` |

No schema, migration, dependency or packaging change. Hosted (`APP_MODE=online`)
behaviour is unchanged except the UI copy above; the Windows launcher is PC-only.

## Release procedure (owner-run)

1. **Choose the revision.** Merge the reviewed follow-up PR (or use `624d8b9` if you
   want PR5 only). Record the exact SHA you deploy.
2. **Pause first.** In Settings, confirm master automation is OFF. Leave schedulers
   unconfigured. Note any running provider jobs; do not retry ambiguous ones.
3. **Back up before deploying** (see Recovery below): database dump, the whole
   `MEDIA_ROOT` including `_private/`, and the matching `ENCRYPTION_KEY` and
   `SESSION_SECRET` in the password manager. Record hashes and the current SHA.
4. **hPanel import settings** (unchanged): repository root, Next.js, npm, Node 22
   (>= 22.13), build `npm run build`, output `.next`, start `npm start` or entry
   `.next/standalone/server.js`. Read both the install and build logs and record
   Node/npm versions.
5. **Environment** (unchanged names): `APP_MODE=online`,
   `APP_URL=https://content.antonmarklund.com`, `DATABASE_URL`, `SESSION_SECRET`,
   `ENCRYPTION_KEY`, `MEDIA_ROOT` (absolute, persistent, outside the app folder),
   `MONTHLY_SPEND_CAP_USD`, `GROUNDING_BUDGET_MODE` (decide `estimated` or `strict`),
   provider keys only if intended. Never set `GEMINI_FAKE`, `VOICE_FAKE` or
   `ALLOW_DESTRUCTIVE_TEST_DB` on the host.
6. **No migration is needed** for PR5 or this follow-up. Do not re-run the historical
   seeds.
7. **Deploy** from hPanel. Then run the read-only identity check above.

### Persistent MEDIA_ROOT placement

Hostinger's managed Node.js layout and its retention across redeploys are not
verified. Requirements: an absolute directory outside the deployed app and outside
`.next`, `node_modules` and `.git`; readable and writable by the app user; included
in backups. Verify in the configured administrator environment:

```sh
npm run deployment:check -- --media         # placement and access
npm run deployment:check -- --media-write   # adds a synthetic write/read/delete probe
```

Then leave one synthetic file (for example `_preflight/keep.txt`) in `MEDIA_ROOT`,
redeploy, and confirm it still exists. Only after that should unique media live
there. Keep `_private/media-identities/` and `_private/shared-identities/` with the
media; losing them closes the library (fail-safe) rather than exposing files.

## Post-deploy acceptance (about 15 minutes, synthetic data only)

1. Login page loads over HTTPS. A wrong password shows a generic error and keeps the
   email. The correct password lands on Start.
2. Save one new link (receipt "Saved."), the same link again ("Already in your
   inbox"), and one link with the network off on a phone (text kept, retry works).
3. Sign out in a second tab, then save in the first: "Your session expired", text kept.
4. On Learn, add a manual transcript to the saved item and press Summarise only if a
   provider is configured and you accept the cost.
5. As staff: Start points to the inbox; Settings, Learn and Facts say owner-only; a
   known private path under `/api/media/voice/_consent/` returns 404.
6. Phone (about 390 px): no sideways scrolling; Menu & tools opens, Escape closes it.
7. Settings: automation still OFF; spend meter shows the intended cap.

## Rollback

Code rollback needs no database change (no migration since PR4's 0002). Redeploy the
previous SHA from hPanel. **Caution:** rolling back to a pre-PR5 build also removes
PR5's private-media enforcement and login throttling, so private files that the
markers protect could become visible to staff again. Prefer rolling back only to
`624d8b9` or later. Keep automation paused, keep provider job IDs, and never blindly
replay a publication or provider request whose outcome is uncertain.

## Recovery (procedure, not yet performed on production)

A backup set is only usable when all four parts match: database dump, `MEDIA_ROOT`
(including `_private/`), `ENCRYPTION_KEY`, and the code SHA. Store the set away from
the hosting account and the working PC, encrypted, with a retention you choose.

Rehearse into an isolated database and folder, never over the live ones:

```sh
mariadb-dump --single-transaction --hex-blob --routines --triggers --events content_machine --result-file=backup.sql
# restore into a NEW database named *_restore_test, then compare:
#   CHECKSUM TABLE <all tables> EXTENDED   in both databases (identical expected)
npm run media:verify-restore -- /absolute/live/media /absolute/restored/media
```

Then start the matching code against the restored database and folder with the same
`ENCRYPTION_KEY` and sign in. `ENCRYPTION_KEY` protects stored OAuth tokens of
connected publishing accounts (Meta, YouTube, TikTok). The pilot has none connected,
so there may be nothing to decrypt yet; once an account is connected, a restore with
the wrong key makes that account's token unreadable and it must be reconnected. Keep
the key with every backup set regardless.

Synthetic rehearsal on 23 October 2026 (local MariaDB 11.4.9, synthetic data only):
52 tables restored with identical `CHECKSUM TABLE ... EXTENDED` values; the media
verifier passed a full copy and failed a copy missing `_private/shared-identities`.
This does not prove the production backup, its independence, retention, or the
recovery time.

**Owner decisions still open:** backup destination independent of Hostinger and the
PC; encryption and key custody; retention; recovery point and time targets; who runs
the backup and how often (no schedule was created).

## Proposed separate enhancements (not implemented)

Ordered by value for a private two-role workspace. Each needs an owner go-ahead.

1. **Release identity view (small).** Postbuild writes the commit SHA and build time
   (from git or a host-provided variable) to a non-secret file; Settings shows it to
   the owner. Replaces the bundle-string check. Needs a Linux artifact check.
2. **Normalized video identity (medium, no schema change).** Treat `youtu.be/ID`,
   `youtube.com/watch?v=ID` and `/shorts/ID` as one capture. Today they create
   separate rows (seen in this acceptance run). Needs a one-off duplicate report for
   existing rows before switching, so old and new forms do not diverge.
3. **Unified job history (larger, schema).** One owner view of capture analysis,
   learning, renders and provider jobs with state, last progress, uncertain outcomes
   and an explicit safe retry. Reuses existing lease and spend records; adds a job
   table. Needs native migration and concurrency tests.
4. **Session management (larger, schema).** Password-wide revocation on password
   change and a per-device session list with sign-out. Logout already revokes the
   current token durably.
5. **Cross-URL attribution (larger).** Link one source video to its re-shares and
   brand reuse. Depends on item 2.

Staff brand membership remains an owner policy decision; the shared-portfolio model
is intentional and unchanged.
