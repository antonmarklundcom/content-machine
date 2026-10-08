# Content Engine — audit bug fixes, 2026-10-08

The 15 confirmed audit bugs have implementation fixes on `codex/fix-audit-bugs` in `C:/Projects/content-engine`, based on `f9ad273288521b8c08b1b911dc62a73b08373423`. This is a local review branch. The original installation at `C:/Users/anton/content-engine` and its uncommitted lockfile, the editorial intake at `C:/dev/content-engine`, and real databases/accounts were preserved. Nothing was merged, deployed, published or sent to a paid generation service.

## Fixes and regression evidence

| ID | Severity | Implemented behavior | Regression evidence |
| --- | --- | --- | --- |
| BUG-01 | P1 | Destructive DB tests validate the parsed endpoint and disposable database name before creating any application pool. Forcing `DB_DRIVER=pg` cannot bypass the guard. Explicit destructive-test opt-in is required. | Eight guard unit cases; test preload enforces fake Gemini/voice defaults. `src/db/test-database-guard.ts`, integration preload/setup. |
| BUG-02 | P1 | Complete optional-dependency lock records; LF checkout policy for Windows/Linux formatting; consistent supported Node/npm declarations and CI setup. | Clean Windows `npm ci`: 419 packages, successful. Linux remains an execution gap while GitHub Actions is disabled. |
| BUG-03 | P1 | Provider acceptance is recorded durably before asset bookkeeping, permalink and first-comment follow-up. Confirmation survives editorial status changes and late errors. | Fault tests verify secondary failures cannot authorize another send. Publishing safety + existing publisher tests. |
| BUG-04 | P1 | Post revisions, due-time claims and durable attempt identity fence stale edits/reschedules and final provider commits. | Post engine/UI fixtures and publishing race/fault traces. Native multi-session lock interleavings still require PostgreSQL validation. |
| BUG-05 | P1 | Only an authenticated owner can authorize scheduling/sending. Stored approval names the revision, provider target and asset snapshot. Due jobs re-check approval and owner role. | Employee actions/PATCH and changed-revision refusals; owner scheduling fixtures. |
| BUG-06 | P1 | Final send checks require correct brand/account and approved/used assets, matching metadata and hashes. Account/media rows stay locked through the send and durable confirmation. | Wrong-brand, rejected/reassigned/replaced-media refusal tests; original-file checksum checks. |
| BUG-07 | P1 | Linked account identity cannot change while retaining an old connection; reconnect target identity is checked. Unlink deliberately before changing the identity. | Linked-identity edit and mismatched provider account tests. |
| BUG-08 | P2 | TikTok persists upload session/progress and resumes the same provider ID; expired or unknowable sessions require manual reconciliation. Fair pending queue ordering, anchored recovery deadline and owner local cancellation prevent endless monopolization. | Ten TikTok unit cases plus four pending/fairness/deadline/cancellation SQL cases. YouTube no-progress retries and HTTP requests are bounded. |
| BUG-09 | P2 | Token refresh locks the connection, re-reads current credentials and bounds provider calls. Reconnect waits and the freshest durable credentials win. | Two SQL refresh/reconnect regressions pass. Dedicated native competing-refresh test added but not locally executed. |
| BUG-10 | P2 | Registration preserves checksum-addressed originals; scans and serving paths detect missing/changed bytes. Replacing a source file cannot silently replace approved media. | Original identity unit tests; six media recovery SQL cases; historical media tests. |
| BUG-11 | P2 | Failed, cancelled and reaped generation reconciles scoped output folders even when the CLI emits no result marker. Completed files are recovered without a second provider submission. | Interrupted/failure output recovery fixtures and runner tests. |
| BUG-12 | P2 | Voice job, pending takes and manifest linkage are committed before dispatch. Lease-protected repair handles old pending orphans. | Atomic linkage/orphan recovery fixtures; voice plan tests. |
| BUG-13 | P2 | Post/script drafts recover after internal navigation, Back and reload. Conflict handling and server compare-and-set prevent silent overwrites; slow saves retain newer edits. Exports/generation/approval from the editor require saved work. | Five draft unit tests, script conflict SQL case, actual synthetic browser navigation/reload/recovery/save for both editors. |
| BUG-14 | P2 | Durable per-attempt budget holds identify live work and expire conservatively into visible uncertain spend. Late releases cannot erase uncertainty. Local reconciliation adjusts a checked amount once and never regenerates. | Eleven spend SQL cases including crash/expiry/reconciliation; `npm run spend:recover` added. |
| BUG-15 | P2 | Authenticated employees can read media previews and downloads required for preparation. Paid generation, send authorization and destructive operations keep their existing owner boundary. | Media permission unit matrix and authenticated/signed-out route fixtures. |

The original audit evidence remains in `C:/AI work/content-engine/audit-2026-10-08/BUGS.md`; it describes the audited main revision, not this corrected branch. These fixes do not establish that every repository bug has been found.

## Validation and limits

- Clean Windows npm ci: PASS (419 packages, Node 24.19.0/npm 11.17.0).
- Full unit suite: 664 total, 662 pass, 0 fail, 2 skip.
- Capture worker: 21/21 pass.
- Production build, TypeScript and ESLint: PASS. Full Prettier: PASS after a tracked LF checkout policy; untouched source content was not reformatted.
- Publisher/video/safety/post/UI/account/results: 67/67 synthetic SQL tests pass.
- Timestamp-mapping rerun: 20/20 pass; spend suite: 11/11 pass; media recovery: seven new SQL regressions pass.
- Synthetic 0012→0013 upgrade and dump/restore: all 50 tables, fixture values and identity sequence preserved.
- Browser: post and script internal navigation/reload recover edits; recovered content saves and reloads from the server. Fake providers only.
- Final Windows media/CLI/script fixture rerun: 38 total, 38 pass, 0 fail, 0 skip (synthetic SQL only).

External requests were mocked or blocked and the SQL adapter used synthetic, private in-memory data. It executes PostgreSQL SQL in WASM; it does **not** prove native multi-session locking, process-shared leases or server configuration. Full first-pass integration exploration had 383 cases: 323 pass, 31 fail, 29 skip. Focused reruns repaired Windows-only executable/symlink fixtures, outdated approval/immutable-media expectations and temporary adapter date parsing. A separate-process lease test and independent-database migration test need a real disposable PostgreSQL server; they cannot share this in-process adapter.

Actual DB/media backup and restoration, real OAuth token expiry, provider uploads/public-media delivery, scheduling across real timezones, deployed workers and Hostinger runtime remain unverified. ffmpeg/PHP-dependent tests are unavailable locally. No production data migration or real queue replay occurred.

## Upgrade and rollback

1. Review this branch and establish native PostgreSQL CI evidence. Actions was disabled at audit time; enabling it is a separate account configuration action. Check the actual target Node/npm install and build logs.
2. Identify the canonical live installation, DB, media root and private key recovery. Stop all publish/generation dispatchers and cron/Task Scheduler jobs. Back up database and media together, and prove restoration into a separate installation before upgrading real data.
3. Apply migration `0013_audit_reliability.sql` once, with dispatch still stopped. It adds publishing revision/attempt/approval/upload fields and the budget hold ledger. Existing scheduled posts are intentionally returned to `ready` for owner review. Known external results stay confirmed; legacy uncertain attempts stay blocked for manual provider verification. Legacy budget reservations become inspectable uncertain holds.
4. Start the upgraded app with dispatch disabled. Scan/review original media, inspect missing-file reports, exercise draft saves/employee previews and review each paused schedule against its exact target and files. Only the owner may later enable real dispatch after provider verification.
5. Roll back by stopping dispatch and restoring the matching pre-upgrade database/media snapshot with the old app revision. Retaining the new schema while switching to old publishing code can remove these protections; do not automatically reactivate old schedules. Preserve new originals and reconcile any provider-accepted work before deciding what to replay.

Backups and private key material belong in owner-controlled recovery storage, never Git, reports or operation manuals. The synthetic 50-table dump/restore rehearsal proves a test method, not recovery of the actual installation.

## Operator changes

- Edit → Save → owner review → schedule/send. Any material post/asset/target mutation requires approval again. Employee preparation remains useful without external-send authority.
- A confirmed or uncertain send cannot be reset into a fresh send. Check the real platform first. Local cancellation stops local polling/submission; it does not cancel already accepted remote work. A late known provider result can still be recorded.
- Keep `_originals` with the media library and backups. Do not overwrite original paths. Missing legacy bytes require restoration/review.
- A recovered editor draft is local to that browser/user/brand/document and expires after seven days. It is not a database backup or a server autosave.
- `npm run spend:recover` lists uncertain holds. After checking provider billing and existing spend records, reconcile a hold with `--id <hold-id> --actual-usd <verified-unrecorded-amount>`. Use zero only when uncharged or already recorded. The dollar cap remains estimate-based; Higgsfield credits are a separate unit.

## Hosting decision, checked 2026-10-08

The current code supports PostgreSQL through native `pg` or Neon transports; it has no MySQL adapter. JSONB, PostgreSQL migrations and SQL/locking behavior make MySQL a substantive compatibility project.

Recommended optional hybrid: use an existing eligible Hostinger Node.js slot for the private web interface, keep PostgreSQL (the repository documents Neon), and retain media generation/rendering/CLI work on the PC. Verify the exact plan, persistent media paths, encryption-key parity, runtime packaging, worker/cron behavior and real install/build logs before a deployment decision. A paid subscription alone does not prove an available app slot or database recovery.

[Hostinger Node.js plan/framework support](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) and [Hostinger database support](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/) were checked: managed Business/Cloud supports Node.js; hosting PostgreSQL itself on Hostinger requires VPS. Managed Web/Cloud MySQL is not a drop-in replacement for this app. No hosting/account/DNS change is included in these fixes.

## Remaining business priorities

Stable IMP-01…IMP-20 IDs and original effort/acceptance criteria remain in the audit checklist. Several reliability foundations are now implemented, while native/live verification and broader completion criteria remain outstanding. The best next five actions are: prove real restoration (IMP-02), approve one reusable offer-focused brief (IMP-05), import existing finished packs (IMP-06), connect content IDs to qualified-lead outcomes (IMP-07), and provide one useful local startup/readiness workflow (IMP-13). Account setup, brand information, provider access and owner decisions are separate from coding.

Use one pilot offer immediately: collect/verify source → draft and explicitly save → choose intact approved assets → review CTA and exact destination → export a pack → owner publishes manually when separately authorized → record content ID/permalink, operator minutes/cost and qualified leads → decide weekly what to repeat/change/stop. More generated posts alone are not evidence of sales value.

## Current implementation evidence

| Bug | Current file and one-based line |
| --- | --- |
| BUG-01 | `src/db/test-database-guard.ts` line 2 |
| BUG-02 | `package.json` line 5 |
| BUG-03 | `src/lib/publish/index.ts` line 484 |
| BUG-04 | `src/lib/publish/index.ts` line 135 |
| BUG-05 | `src/lib/posts.actions.ts` line 202 |
| BUG-06 | `src/lib/publish/preflight.ts` line 20 |
| BUG-07 | `src/lib/accounts.actions.ts` line 277 |
| BUG-08 | `src/lib/publish/tiktok.ts` line 197 |
| BUG-09 | `src/lib/publish/connections.ts` line 137 |
| BUG-10 | `src/lib/media/originals.ts` line 34 |
| BUG-11 | `src/lib/higgsfield/run.ts` line 583 |
| BUG-12 | `src/lib/voice/higgsfield-takes.ts` line 290 |
| BUG-13 | `src/components/useDraftRecovery.tsx` line 10 |
| BUG-14 | `src/lib/spend.ts` line 117 |
| BUG-15 | `src/lib/auth/roles.ts` line 23 |
