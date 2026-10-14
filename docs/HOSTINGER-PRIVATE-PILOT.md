# Private Hostinger pilot — 14 October 2026

Target: https://content.antonmarklund.com. Private single-owner research and content workspace. Hosting/DNS/account setup has not been performed by this release.

## What this release provides

- Paste YT/IG links into the inbox; choose Learn for lessons and implementation steps.
- Learning items retain takeaways, source-backed resource links, practical steps and limitations. Download a Markdown implementation brief for manual work or a coding agent; the app does not itself execute that agent.
- Paste IG captions or video transcripts when extraction fails. Saving material does not generate anything, and changed material invalidates its older summary.
- Residency Guide and Propia shortcuts lead into existing brand/idea/post/script workflows. Approve the underlying facts, audience and CTA before generation. Script languages remain English, Paraguayan Spanish and Jopará; full Portuguese script support is later work.
- Database-persisted Automation controls: master pause, selected YouTube sources, captured-video analysis, automatic learning summaries and scheduled publishing. A fresh installation starts with every switch OFF.
- Fresh session checks on private pages and priority APIs, noindex metadata/headers and private cache headers. Login is the access control; noindex does not grant privacy by itself.

Voice training, PC recording, rendering, local CLI tools and secure hosted↔PC media synchronization are outside this pilot.

## Hostinger import

Use the reviewed pilot branch or main after the release is merged. Check the exact commit and checks; do not import the older main and assume it contains this release.

| Field | Value |
|---|---|
| Repository | antonmarklundcom/content-machine |
| App root | Repository root |
| Framework | Next.js |
| Package manager | npm |
| Node | Supported Node 22, version 22.13 or newer |
| npm | Meets package.json; validated npm 11.17.0 baseline |
| Build dropdown | npm run build |
| Output | .next |
| Start, if offered | npm start |
| Entry file, if offered instead | .next/standalone/server.js |

The build's postbuild prepares static files. Confirm both install AND build log versions and the actual offered controls. Linux build/standalone acceptance is distinct from a successful dependency install. No migrations, seeds or model calls run in build/start.

## Private environment setup

Set these in hPanel, not in source control:

| Name | Purpose |
|---|---|
| APP_MODE | online |
| APP_URL | https://content.antonmarklund.com (origin only) |
| DATABASE_URL | Intended MariaDB database using mysql:// and URL-encoded credentials |
| SESSION_SECRET | Independently generated random secret, at least 32 characters |
| ENCRYPTION_KEY | Independently generated 32-byte key, encoded as 64 hex characters |
| AI_PROVIDER | gemini; hosted app cannot access your PC CLI login |
| GEMINI_API_KEY | Required for AI summaries/drafts; configure only the intended billed project |
| YOUTUBE_API_KEY | Required for YouTube metadata/descriptions and source monitoring |
| MONTHLY_SPEND_CAP_USD | Deliberately choose a small pilot ceiling |
| CLIP_TOKEN | Optional independent capture secret for phone Shortcut/API access |
| CRON_SECRET | Optional independent scheduler secret; needed only when configuring runners |

Never set GEMINI_FAKE=1, VOICE_FAKE=1 or destructive test flags on the hosted app. API keys and callbacks are configured in hPanel; the online Settings page deliberately cannot edit environment files. Automation controls on that page DO work online because they use the database.

The Hostinger connector documentation specifies 127.0.0.1:3306 for app-to-local-MySQL access. Verify the actual site's database topology. The external srvNNNN.hstgr.io hostname is for a remote administrator after IP allowlisting; a PC cannot use Hostinger's localhost. No external database has been created or allowlisted here.

## Explicit database installation

Create a separate empty database and restricted user for this app. Preserve any existing project data. From a controlled administrator environment pointed at that exact database:

    npm run db:check
    npm run db:migrate
    npm run db:seed
    npm run yt:seed-owner

The seed-owner command reads ADMIN_EMAIL and ADMIN_PASSWORD privately; remove the one-time password afterwards. This release adds migration 0002: application_settings and clips.learn_details. Existing rows retain null details; normal seed is insert-only.

Managed Node hosting does not guarantee a shell for these commands. Confirm supported remote MySQL access/allowlisting before using the PC administration route. Do not put migrations into build/start or expose a public setup endpoint.

Run `npm run deployment:check` in the configured administrator environment for a secret-free configuration check. Add `-- --database` for read-only connection/schema/owner verification. A passed preflight is not a live browser acceptance test.

## Acceptance before daily use

1. HTTPS login succeeds, wrong credentials fail, logout blocks access, and revoked sessions cannot open protected pages or priority APIs.
2. With every switch off, save one YT and one IG link as Learn. Both survive a server restart, with no model call just from capture.
3. Manually summarise a captioned YT video; verify the transcript, takeaways, source links and limitations. Caption requests can fail on datacenter IPs. Test the actual host; keep manual pasted transcripts available.
4. For IG, paste a caption/transcript when the page cannot be read. Verify the summary uses supplied evidence, and changed evidence requires a fresh summary.
5. Download a brief. Check its links and implementation steps against the original material. Long inputs are bounded, so no claim of complete extraction is made.
6. Draft one Residency Guide post/script and one Propia listing piece. Review factual claims, language and CTA. Export/copy manually. Live social connections and automatic publishing are later acceptance steps.
7. Test master pause and one source Pause/Resume. Check last-poll status, errors and spend. Controls stop new automatic work at job boundaries; they cannot cancel or reverse an external request already sent.
8. Establish a private database/media/key backup and restore procedure before relying on the app as the only copy of valuable research.

## Optional schedulers, after manual acceptance

Enabling a switch does not install a scheduler. Assign one runner per task, never one on the PC and one hosted simultaneously. Cron endpoints require x-cron-secret; do not put the secret in a query string.

| Task | Endpoint / PC command | Required switch |
|---|---|---|
| YouTube source checks | POST /api/cron/poll / npm run yt:poll | Master + YouTube monitoring |
| Learning summaries, bounded 5 per HTTP run | POST /api/cron/learn / npm run learn:process | Master + learning summaries |
| Scheduled publication | POST /api/cron/publish / npm run publish:due | Master + publishing; keep OFF for this pilot |

Source polling only analyses active-source backlog, plus untracked videos if captured-video automation is explicitly enabled. Paused-source videos remain available for manual research. Manual Summarise and Process/retry remain available with master pause. The per-item learning CLI `--id` is also manual.

Telegram capture is optional: the existing Worker needs an allowlisted chat, webhook secret and Hyperdrive access to this database. It is not deployed by this release. Begin with paste-in-login; then connect the bot without delaying content creation. A Telegram Learn capture uses #learn plus optional brand hashtags.

## Media, recovery and rollback

Text research lives in MariaDB. Your external-drive files are unavailable to Hostinger. Before uploading assets or using filesystem exports, configure and verify persistent hosted MEDIA_ROOT outside the deployment directory, or a reviewed storage adapter. Do not use .next or a disposable release folder for unique media.

Pause automation before rollback and retain provider/job IDs. Use a matched code/schema/media/key backup. Older code can read an additive schema, but keep source references and do not drop the new columns/table casually. Research exported to Markdown is useful portability, not a database backup.

## Release verification

Current results are recorded in the PR and C:/operation manuals/content-machine/README.md. Separate source tests, local synthetic MariaDB, Linux standalone checks and actual Hostinger acceptance. None of these is interchangeable with the others.
