# Content Machine — Hostinger/MariaDB conversion plan

2026-10-08, America/Asuncion. Owner authorized a separate repository, conversion, database-related bug fixes, synthetic testing, PR creation and merge after successful checks. Deployment, connected-account changes, real publishing/outreach and paid generation/API probes remain outside scope. Owner states there is no online app or data to migrate.

## Source and target

- Source: content-engine local fixed commit 4c8c735880ffa45810997b7c778163ec78e5d89e, not its older remote main. Preserve both original installations and all existing work.
- Target: https://github.com/antonmarklundcom/content-machine, separate checkout C:/Projects/content-machine. Its remote is empty at planning time; initialize main with this plan/README, then implement on codex/hostinger-mariadb.
- Preserve the existing local/private content operating model and features. Hostinger managed Node.js runs the Next.js interface with Hostinger's MariaDB/InnoDB database. PC media/CLI/rendering remains a separate supported operating lane, with explicit persistent-media handoff. No SaaS expansion.
- No production data converter is required. Create an idempotent fresh MariaDB baseline, safe insert-only seeds and forward migrations. Keep PostgreSQL migration history only as labeled provenance, outside the active migration folder.
- Target compatibility: MariaDB 10.11 and 11.4 in native CI, optionally MySQL 8.4 for portability. Exact owner Hostinger version/plan/runtime still require verification before deployment. Do not rely on PostgreSQL transport casts or untranslated SQL.

## Architecture decisions and failure boundaries

Use drizzle-orm/mysql2 with an explicit MariaDB-compatible schema, a bounded connection pool, UTC session/date handling and UTF-8 settings. Adapt all RETURNING/upsert call sites deliberately: obtain inserted IDs safely, re-read within a transaction where appropriate, preserve compare-and-set row counts, and never hide truncation/foreign-key errors with blanket INSERT IGNORE. Preserve exact owner approval, brand/account/media snapshots and durable publication confirmation. Test concurrency with separate native DB connections.

Review JSON defaults/decoding, decimal/boolean/date types, nullable uniqueness, long UTF-8 index keys, case-sensitive identities, FK cascade/reset behavior, interval expressions, search, JSON aggregation, percentiles and raw execute result shape. Store binary media outside SQL; keep immutable originals, paths and hashes intact. Validate publication/budget/job locks and stale/unknown states before enabling automation later.

Build must not open an operational DB, run migrations/seeds or call providers. Generate explicit Next.js standalone output, copy public and .next/static, and validate a physical copied Linux artifact including mysql2 transitive dependencies and authenticated/DB-dependent startup behavior. Keep package manager/runtime declarations consistent; inspect actual Hostinger install/build logs later.

## Dependency-ordered work and acceptance

| Batch | Work | Acceptance / meaningful tests | Commit/review boundary |
| --- | --- | --- | --- |
| CM-01 | Freeze plan, source provenance, separate checkout and findings log. | Empty target verified; source clean/commit recorded; no ignored operational files copied. | Initial documentation baseline on main, then one conversion PR. |
| CM-02 | Copy tracked fixed source; schema, mysql2 driver, fresh migrator/seed/test guard and typed persistence helpers. | Fresh native MariaDB initialize/re-run; identities, JSON, UTC, uniqueness and duplicate/error semantics; guard refuses operational/remote DB tests. | Database foundation commit, before module adaptation. |
| CM-03 | Port module queries: content/media/voice/jobs and research/analytics/capture/settings. | No active PostgreSQL SQL/driver remains; meaningful fixtures preserve reads/search/reporting and mutations. | Separate module commits; bounded agents own disjoint files. |
| CM-04 | Verify/fix database defects and concurrency: approvals/publishing, spend holds, leases/tokens/partial production. | Native competing sessions, stale edits, refusal/unknown/accepted provider result, crash/cancel/duplicate job, cap/expiry/reconciliation cases. Providers mocked with call counts. | Root owns reliability fixes and regression evidence. |
| CM-05 | Native integration harness and Windows/Linux CI; full source/test migration. | Full unit/worker/native DB suites, type/lint/format, clean frozen install and build pass. Unsupported external tools are explicit skips, not suppressed failures. | Test/CI commit; no shared mutable agent database/build. |
| CM-06 | Hostinger standalone packaging, no-spend readiness, deployment/migration/backup/restore/media/worker instructions. | Isolated physical Linux artifact startup/static files/mysql2 resolution plus synthetic DB restore and browser owner/employee workflows. Dispatch disabled during verification. | Hostinger preparation commit. |
| CM-07 | Independent review, findings/recommendations, PR and merge. | Fix blocking issues; current-head CI passes, diff/secret scan reviewed, mergeable with zero conflicts; merged main exact revision verified. | One cohesive PR; attach it to this task, merge only when checks pass. |

One PR is chosen because schema/driver/module conversion is one compatibility change; the intermediate state is not a deployable product. Several small commits and ownership boundaries keep review manageable. Additional unrelated business features stay in the backlog rather than expanding this PR.

## Findings and improvement capture

Record stable CM-BUG-xx IDs with severity, current source evidence, reproduction/code trace, impact, fix and regression status. Separate confirmed defects, configuration gaps and suspicions. Reverify the source's second audit BUG-16…22 before deciding which are fixed or carried forward. Record CM-IMP-xx ideas with business benefit, effort/dependencies and acceptance; preserve prior IMP-01…20 as history. Do not claim all bugs found.

CM-IMP-01: Evaluate optional Claude Haiku 5.5 API (claude-haiku-5-5), first for classification/extraction/brief triage. Add a provider abstraction, counted mocks, structured-output quality evals, explicit dollar/credit ceilings, caching, timeout/retry and fallback policy before any paid comparison. Owner consideration authorizes a backlog entry, not implementation or a paid call. Official model availability/pricing documentation must be checked and dated; do not equate lower token price with lower cost per accepted content pack.

## Test isolation and collaboration

Root owns schema/driver/helpers, publishing/spend/token/lease architecture, final source validation, ranking, PR/merge and manuals. Delegate disjoint read/query conversion modules to bounded agents and fixture/test mapping to GPT-6 Luna where suitable. Agents do not share mutable DBs, run competing builds, change dependency lock files or commit/push independently. Install/CI and native DB execution have one coordinator. All provider calls are mocked or blocked; tests use uniquely named disposable databases with destructive opt-in.

## Rollout and rollback (future owner deployment)

Deploy only after this conversion is merged and the actual Hostinger plan/version/runtime is confirmed. Use documented package scripts in hPanel. Set credentials privately; create a separate empty MariaDB database; explicitly migrate and seed insert-only with dispatch disabled. Select a persistent media root outside release/build folders, establish DB + media + encryption-key backups, and prove isolated restoration. Configure public delivery, OAuth callbacks and one scheduler only after readiness checks. Never enable generation/publishing merely by deploying.

Before real records accumulate, rollback can select the last known good release and recreate the disposable empty target. After use begins, keep matched code/schema/media backups; stop dispatch before reverting, retain provider IDs/job/cost uncertainty, and restore a matching snapshot. Never substitute old PostgreSQL SQL against MariaDB or blindly replay accepted work.

## Done definition and owner actions

Done here means converted source merged into content-machine main, fresh MariaDB lifecycle and required checks passing, Hostinger Linux artifact verified, confirmed database/conversion blockers fixed, remaining gaps recorded and an accurate operating manual written. It does not mean deployed or live-provider certified.

Owner deployment actions: confirm exact Hostinger plan/Node/MariaDB version and media capacity; provide DB URL, session/encryption/cron/media secrets privately; choose first brand/offer/account and provider ceilings; decide PC versus hosted worker schedules; perform separately authorized live provider checks. No owner input blocks independent coding/testing now.
