# Content Engine — remaining improvements, 2026-10-08

BUG-01…15 have local implementation fixes on `codex/fix-audit-bugs`; they are not merged or deployed. This is the recommended **remaining** backlog, with stable IDs from the original audit. Ranking changed after the bug fixes: business context, reuse, measurement and everyday usability move forward. Dependencies still determine implementation order.

Effort is focused developer working days, including useful tests/docs, excluding owner/provider delays. These are ranges, not a fixed bid or revenue forecast. Existing compute/storage/API costs still apply where used. No additional service purchase, account change, migration of real data, publication or deployment is authorized by this report.

## Ranked stable-ID checklist

| Rank | ID | Decision | Remaining improvement | Effort | Confidence | Risk / recurring cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | IMP-02 | DO NOW | Prove real backup and restoration | 2–4 days + owner storage setup | High | Medium; existing backup storage |
| 2 | IMP-05 | DO NOW | Reusable brief for one offer and audience | 1–3 days + 1–2 owner hours | High | Low; existing bounded generation budget |
| 3 | IMP-06 | DO NOW | Import finished editorial and media packs | 2–4 days | High | Low; no new service |
| 4 | IMP-07 | DO NOW | Connect content to qualified leads and sales | 2–4 days | Medium-high | Low; manual/CSV first |
| 5 | IMP-13 | DO NOW | One start command and useful readiness checks | 2–3 days | High | Low; no new service |
| 6 | IMP-15 | DO NOW | Put the CTA where each channel can use it | 1–3 days | High | Low; no new service |
| 7 | IMP-08 | DO NOW | Trustworthy final preview before approval | 1–2 days | High | Low; no new service |
| 8 | IMP-12 | DO NOW | Visible spending and reuse of paid outputs | 2–4 days | High | Medium; existing provider budgets |
| 9 | IMP-10 | DO NOW | Recover partial production in the UI | 2–4 days | High | Medium; existing local compute |
| 10 | IMP-17 | DO NOW | Employee prepares a complete pack independently | 1–2 days | High | Low; no new service |
| 11 | IMP-09 | DO NOW | Find and repair missing or corrupt media | 1–3 days | High | Medium; local disk/storage |
| 12 | IMP-03 | DO NOW | Clear owner review and emergency-pause policy | 1–3 days | High | Medium; no new service |
| 13 | IMP-04 | DO NOW | Visible reconciliation of uncertain sends | 2–4 days | High | Medium; no new service |
| 14 | IMP-01 | DO NOW | Native PostgreSQL and Windows/Linux CI evidence | 1–2 days + owner Actions setup | High | Low; existing CI allowance to confirm |
| 15 | IMP-14 | LATER | Repurpose one source into a campaign pack | 3–5 days | Medium-high | Low-medium; bounded existing generation budget |
| 16 | IMP-16 | LATER | Weekly decisions from actual business outcomes | 1–3 days | Medium | Low; manual or bounded existing analysis |
| 17 | IMP-19 | LATER | Source-backed claims with freshness review | 1–3 days | High | Low; no new service |
| 18 | IMP-20 | LATER | Fast selection of approved brand-kit assets | 1–3 days | Medium | Low; no new service |
| 19 | IMP-18 | LATER | Capture inbox to brief with less triage | 1–3 days + optional owner bot setup | Medium | Low; optional existing worker quota |
| 20 | IMP-11 | LATER | Verify one real automated publishing platform | 2–4 days + provider access/review | High | Medium; existing provider access |

| ID | Decision | Scope |
| --- | --- | --- |
| SKIP-01 | SKIP | Hosted multi-tenant SaaS, organizations/billing and broad platform expansion. |
| SKIP-02 | SKIP | More generation vendors/custom training without measured pilot need. |
| SKIP-03 | SKIP | Unattended bulk output, automatic comments/DM outreach and mass publishing. |
| SKIP-04 | SKIP | MySQL conversion merely to use an included database. Reconsider only with a documented operating need. |

## Dependencies and measurable acceptance

### IMP-02 — Prove real backup and restoration

- Dependencies: IMP-01/native validation; owner identifies DB/media/key recovery.
- Acceptance: Restore a matched real DB/media snapshot into an isolated installation; verify rows, references, identity sequences, file hashes, decryption and pack previews. Measure RPO ≤24h and RTO ≤60min.
- Components: Database/media recovery scripts, manifest, operating manual.

### IMP-05 — Reusable brief for one offer and audience

- Dependencies: Owner supplies pilot offer, audience, evidence and buyer action.
- Acceptance: Ten owner-reviewed drafts inherit the correct offer, audience, approved claims, voice and CTA. Missing essential context is visible; no invented price/contact details.
- Components: Brand/kit/context model, generation inputs, pack export.

### IMP-06 — Import finished editorial and media packs

- Dependencies: IMP-05 mappings; IMP-09 immutable originals already implemented, repair policy agreed.
- Acceptance: Dry-run import reports every file, order, caption, brand and rights gap. Repeating import creates no duplicate packs or assets; original intake files and hashes remain unchanged.
- Components: Versioned intake adapter, posts/scripts, media register.

### IMP-07 — Connect content to qualified leads and sales

- Dependencies: IMP-05; owner qualification definition and buyer destination.
- Acceptance: Five synthetic journeys retain a content ID from link/form or manual entry to qualified-lead/sale outcome. Duplicate import is safe; owner can see attribution completeness. No CRM integration is assumed.
- Components: Outcome ledger, content IDs, CSV/import/export, results.

### IMP-13 — One start command and useful readiness checks

- Dependencies: IMP-01/02; canonical installation/media root confirmed.
- Acceptance: A single documented command opens the correct app. Readiness names missing DB/key/media/tools, stopped workers and backup age without exposing secrets. Restart and PC-off behavior are tested.
- Components: Local launcher, configuration diagnostics, worker heartbeat, manual.

### IMP-15 — Put the CTA where each channel can use it

- Dependencies: IMP-05/07/08.
- Acceptance: Preview/export places the correct buyer action in supported caption, comment, description or profile-link instructions. Five channel fixtures preserve attribution and reject missing/mismatched destinations.
- Components: Channel copy/pack export, tracked links, final preview.

### IMP-08 — Trustworthy final preview before approval

- Dependencies: IMP-03; draft recovery and save-conflict protection already implemented.
- Acceptance: Preview shows the saved text, ordered assets, exact account and usable CTA; no unsaved revision can be approved/exported. Browser checks cover failed save, conflict and asset ordering.
- Components: PostEditor/StudioEditor preview, export, approval review.

### IMP-12 — Visible spending and reuse of paid outputs

- Dependencies: Owner chooses dollar and provider-credit ceilings; durable holds already implemented.
- Acceptance: Display estimated/recorded/uncertain dollars and provider credits separately. Reopening or double-clicking a completed request reuses its output unless regeneration is explicitly requested; counted mocks prove no extra call.
- Components: Spend/job/request ledger, output cache, provider usage UI.

### IMP-10 — Recover partial production in the UI

- Dependencies: IMP-09/12; terminal-file and pending-take recovery already implemented.
- Acceptance: Failed/interrupted work lists each recovered, missing and incomplete output. Resume/reuse actions preserve existing files and never submit a second generation implicitly. Mock call counts and crash/cancel fixtures verify this.
- Components: Job/take/media views, reconciliation actions, render/voice workers.

### IMP-17 — Employee prepares a complete pack independently

- Dependencies: IMP-03 owner policy; employee media access already fixed.
- Acceptance: An employee completes a ten-step synthetic pack preparation without owner help, including preview/download/export. Paid generation and send remain owner-only; refusal tests make zero provider calls.
- Components: Authoring/pack UI, permission tests, operator instructions.

### IMP-09 — Find and repair missing or corrupt media

- Dependencies: IMP-02; immutable-original registration already implemented.
- Acceptance: Integrity report identifies absent/changed/corrupt files and supports reviewed restore/relink without altering approved bytes. Synthetic large/corrupt/interrupted-upload cases remain within defined memory/size limits.
- Components: Media scan/serve/upload, repair UI, backup manifest.

### IMP-03 — Clear owner review and emergency-pause policy

- Dependencies: Owner chooses employee/pause policy; exact approval guard already implemented.
- Acceptance: Owner sees text/asset/target changes and approval expiry. Agreed inactive-brand/paused-account behavior is enforced at send; employee/API/cron refusal fixtures call providers zero times.
- Components: Approval review UI, account/brand controls, send preflight.

### IMP-04 — Visible reconciliation of uncertain sends

- Dependencies: IMP-01/native PG and IMP-03; durable confirmation/attempt fences already implemented.
- Acceptance: UI shows provider IDs, confirmation, uncertainty and safe next actions. Native PG fault/race fixtures prove no repeated create or early send. Unknown remote results cannot be marked safe by an automatic retry.
- Components: Attempt/reconciliation UI, publish engine, native race/fault tests.

### IMP-01 — Native PostgreSQL and Windows/Linux CI evidence

- Dependencies: Owner enables Actions separately; test DB guard/lock/runtime already fixed.
- Acceptance: Clean Windows/Linux install, worker/unit/build/type/lint/format checks and the native disposable-PG suite pass. Independent sessions exercise locks, leases and migrations. Real credentials stay unavailable to fixtures.
- Components: CI workflow, disposable DB fixtures, integration tests.

### IMP-14 — Repurpose one source into a campaign pack

- Dependencies: IMP-05/06/08/09/12.
- Acceptance: One approved brief produces reviewable channel variants sharing sources, offer, assets and campaign ID. Measure operator minutes and calls per accepted variant; no automatic publication.
- Components: Campaign/derivative links, prompts, pack editor/export.

### IMP-16 — Weekly decisions from actual business outcomes

- Dependencies: IMP-07 and enough real pilot observations.
- Acceptance: A weekly review joins reach/engagement where available with qualified leads, sales, cost and operator time. Each repeat/change/stop decision cites observations and missing data.
- Components: Results/outcome review, weekly decision export.

### IMP-19 — Source-backed claims with freshness review

- Dependencies: IMP-05; owner-approved sources and claim policy.
- Acceptance: Claims retain source, checked date and reviewer. Expired/high-stakes claims are visibly flagged and require human review before approval; fixtures cover expired and missing sources.
- Components: Facts/claims model, brief/editor review, sources.

### IMP-20 — Fast selection of approved brand-kit assets

- Dependencies: IMP-05/09; owner-approved logos/colors/voice.
- Acceptance: Find and insert the correct brand logo/reference in three or fewer interactions. Missing fonts/assets/configuration have actionable readiness messages; chosen branding survives preview/export.
- Components: Brand-kit search/picker, editor asset selection, readiness.

### IMP-18 — Capture inbox to brief with less triage

- Dependencies: IMP-13; owner chooses web-only or Telegram.
- Acceptance: Captured sources appear once, retain provenance and can become a brief without retyping. Duplicate delivery/retry fixtures pass. Optional bot/worker setup is a separate account action.
- Components: Capture inbox, source-to-brief action, optional Telegram worker.

### IMP-11 — Verify one real automated publishing platform

- Dependencies: IMP-01/02/03/04; bounded/resumable upload and refresh fixes already implemented.
- Acceptance: Native timezone round-trip, queue fairness, cancellation, expiry/reconnect and unknown-result fixtures pass. Actual scheduler/PC-off behavior and a separately authorized owner-observed live test precede certification.
- Components: Selected provider, scheduler, timezone UI, native/live verification.

## Small dependency-ordered batches

| Batch | Scope and components | Validation | Rollout / rollback |
| --- | --- | --- | --- |
| R-01 | Finish IMP-01 native/cross-platform evidence for the already implemented fixes. | Native disposable PG races/leases/migrations, clean Windows/Linux install and CI checks. | Owner separately enables Actions; fixtures use no real providers. Revert CI/runtime changes without weakening test DB guards. |
| R-02 | IMP-02 + diagnostic subset IMP-13: DB/media/key inventory, restore rehearsal, launcher. | Matched isolated restoration, hashes/rows/decryption/UI and measured recovery time. | Confirm actual storage privately; keep dispatch off during rehearsal. Preserve existing installation and backups; roll back additive scheduler/config entries. |
| R-03 | IMP-05: one pilot offer brief and baseline. | Ten reviewed drafts; context/source propagation; three-pack operator-time baseline. | Owner provides real offer/qualification/CTA. Keep existing content fields compatible and version the brief so it can revert. |
| R-04 | IMP-09 repair/integrity + IMP-06 intake adapter. | Missing/corrupt/large/interrupted file fixtures, idempotent dry-run import and unchanged original hashes. | Review-only first import, tagged batch, no original deletion. Disable adapter/detach batch to revert. Back up before any real migration. |
| R-05 | IMP-08/03/17: preview, review/pause policy and employee handoff. | Browser failed-save/conflict/order; employee/API/cron boundaries; zero external calls on refusal. | One pilot brand; automation stays off. Revert UI additions while retaining approval records and local draft recovery. |
| R-06 | IMP-12/10/04: cost/reuse views and production/publication reconciliation. | Counted mocked calls, crash/partial/cancel cases; native unknown-send fault/race tests. | Additive ledgers/actions; no paid or real-send test. Rollback stops dispatch and retains attempts/files/uncertain cost records. |
| R-07 | IMP-07/15: outcome ledger and channel CTA. | Five synthetic attribution journeys, duplicate import and missing/broken destination cases. | Manual/CSV first. Any CRM connector needs separate scope. Preserve IDs and records if UI/import automation is reverted. |
| R-08 | Finish IMP-13 and everyday v1-M pilot. | Ten accepted packs over two weeks; time/cost/recovery/attribution review. | One offer and supervised manual handoff. Revise or stop workflows that do not help; retain the prior working launch and saved packs. |
| R-09 | LATER IMP-14/16/19/20/18 as the pilot identifies useful work; IMP-11 only for one chosen platform. | Each item’s acceptance above; live tests separately authorized. | Review one small feature at a time. Stop dispatch on provider rollback; preserve remote IDs and reconcile before replay. |

## Measurable finished v1

**V1-M (supervised everyday production)** is complete when a restored installation works; supported installation/native tests pass; one approved offer/brand context is reused; ten owner-accepted packs are prepared over two weeks with saved text, intact approved media, a usable CTA and exact destination; and no known P1 defect remains. Target median preparation time ≤70% of the measured three-pack baseline, with observed cost per accepted pack inside owner-chosen ceilings. Record content IDs/permalinks for every pilot pack and assess lead attribution completeness rather than claiming sales uplift from output volume. Recovery must meet measured RPO ≤24h/RTO ≤60min, and a synthetic failed/partial production exercise must recover without an unintended generation call. An employee handoff must pass if delegation is part of the chosen v1.

**V1-A (optional automatic publishing)** adds IMP-03/04/11 native fault/race evidence, actual account/target/timezone verification, scheduler heartbeat/PC-off behavior and a separately authorized owner-observed test on one platform. Confirmed/unknown sends never auto-resend. Lack of provider access does not prevent V1-M. These fixes do not certify V1-A.

## Best first five actions and immediate workflow

1. IMP-02: identify the actual DB/media/key recovery and prove an isolated restore before upgrading real data.
2. IMP-05: approve one brief containing offer, audience, evidence, buyer action and qualified-lead definition.
3. IMP-06: dry-run reuse of finished intake packs, with explicit brand/account/rights mapping.
4. IMP-07: start content-ID → qualified-lead/sale recording manually; connector work can wait.
5. IMP-13: make correct startup and missing-dependency diagnosis one documented operation.

Use the existing working installation or an ordinary local document immediately: verify a source → create and explicitly save a draft → reuse intact approved assets → review CTA/account → export a pack → owner publishes manually when separately authorized → record content ID/permalink, preparation minutes/cost and qualified leads → decide weekly what to repeat, change or stop. The new branch requires backup/migration/verification before becoming the live installation.

## Coding versus owner/configuration work

Coding covers the components and fixtures above. Essential owner inputs are: the canonical live DB/media/backup/private-key locations; one pilot brand/offer/audience/approved claims/CTA and qualification definition; dollar/credit ceilings; employee and pause policy; the first platform (if automation is wanted); and the exact Hostinger plan. Provider/OAuth/worker access and enabling CI are separate configuration actions. No secret values belong in this report or chat.

An eligible existing Hostinger Node.js slot with PostgreSQL (the repository documents Neon) and PC media/CLI production is the preferred hosting candidate. Verify media transfer/persistence, encryption keys, callbacks and worker packaging before deployment. The current app has no MySQL adapter; PostgreSQL migrations/JSONB/locking need a substantive port. Hostinger itself hosts PostgreSQL on VPS rather than managed Web/Cloud database slots. See [Hostinger Node.js support](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) and [database support](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/). Exact plan availability remains unverified.

Approving recommended IDs refers to remaining coding/review work, with owner/configuration gates respected. It does not authorize deployment, account mutation, real posting, outreach or paid provider probes.
