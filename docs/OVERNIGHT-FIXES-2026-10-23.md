# Content Machine reliability and privacy fixes — 23 October 2026

This implementation follows inspection of merged main `f3414ac8`. It belongs to **Content Machine**, not the separate Content Engine repository. Work used the isolated physical C: worktree `C:/Projects/content-machine-fixes-20261023`; the E: checkout's files were retained.

## Corrected behavior

| Review | Resulting behavior |
| --- | --- |
| B01 | Private voice material stays outside shared media. Private hashes override shared provenance, including immutable copies/thumbnails; unknown legacy identities fail closed. |
| B02 / B12 | Listing requests validate every DNS answer/redirect, pin the approved IP while preserving Host/TLS identity, deny private/mapped/transition addresses and accept public fc/fd hostnames. |
| B03 / B04 | Fetch, learning, manual edits and metadata/destructive mutations share renewable clip ownership and fenced commits. Work files are per attempt. Changed evidence invalidates derived lessons. |
| B05 | Manual transcript, provenance and available status commit consistently; later caption refresh preserves manual evidence. |
| B06 / B07 | Temporary caption failure remains retryable; absent captions request manual evidence. Stale capture recovery works with automation OFF and respects live ownership. |
| B08 | Typed SRT/VTT files use immutable originals, download and survive scans; hash/tamper checks remain. |
| B09 | Renewal/pruning serialize on the asset; pruning locks linked posts and rechecks current URL/expiry. |
| B10 / B11 | Brand-specific titles cannot carry across brands. Offline/expired capture preserves inputs; only a positive stored receipt clears fields. |
| B13 / B14 | Never-polled sources sort first; repeat import preserves an existing source. |
| B15 | Concurrent first saves report one creation. Changed duplicate notes share ownership and invalidate affected learning output. |
| Additional regression | Offset-free imported DATETIME values are interpreted as UTC consistently on PC and host; explicit source offsets remain respected. |

## Additional safeguards

- Login throttling uses opaque database keys: eight attempts per normalized account and 120 total in a 15-minute database-clock window. Old counters expire. No forwarded-IP trust or new schema is needed.
- Logout persists an opaque revocation before deleting its cookie. A persistence failure preserves safe retry and returns visible feedback. Session DB errors fail closed. Expired APIs return JSON 401; pages retain canonical login redirects.
- Subscription CLI execution refuses online mode and bounds output. Cancellation targets a live owned Windows tree or the owned POSIX group; POSIX group cancellation also handles exited wrappers and SIGTERM-resistant descendants. An already exited Windows wrapper with inherited-pipe descendants remains a conditional recovery gap. Feedback reports cancellation requested rather than guaranteeing every descendant stopped. Tests launch synthetic Node programs only.
- Render leases cover queued/running time; stale recovery excludes live owners and late workers cannot overwrite successor state. An ffmpeg call already executing reaches its next ownership gate when it returns.
- `GROUNDING_BUDGET_MODE=estimated` preserves existing research behavior with accurate reservation wording. `strict` blocks Search before dispatch because final query charge cannot be bounded. Source-based tasks remain available. No provider is configured or invoked by this setting.
- Scan errors include bounded actionable details and root-path redaction. Staff controls reflect existing owner gates. PC guidance names Content Machine.

## Media rollout and recovery

No database migration is required. Back up both marker directories together with ordinary sources, private folders and immutable bytes:

```text
MEDIA_ROOT/_private/media-identities/<sha256>
MEDIA_ROOT/_private/shared-identities/<sha256>
```

Old approved status/brand does not establish public provenance. Unclassified identities remain hidden/refused. A surviving ordinary-source scan can establish shared provenance after private checks; scanning internal originals or symlinks into internal storage cannot. Private classification always wins.

If no ordinary source survives, the owner can inspect exact bytes privately and deliberately approve one identity locally:

```text
node --conditions=react-server --import tsx scripts/review-media-identity.ts --sha256 EXACT_64_HEX_HASH --confirm-shared-review
```

This refuses online mode and known private identities. It is explicit per-identity review, not bulk approval. Automated tests use only synthetic files. Keep automation paused during any later rollout and review legacy media before publishing.

## Deployment and verification

`npm run deployment:check -- --media` checks explicit absolute root placement/access outside release/build/internal directories. `--media-write` also writes, reads and deletes a small synthetic probe; it does not read existing media. Passing does not prove survival across redeployment or independent backup.

Record exact deployed source/build identity, verify persistent media after deployment and establish independent protected DB/media/key backups, retention and recovery targets. Native synthetic SQL dump/restore with matched media/provenance/key checks is test evidence, not production backup proof.

Focused regressions cover native captures/leases, manual evidence, private aliases/unknown legacy media, post attachment/export metadata, captions, prune/renewal, throttling, revocation and strict-budget refusal. Web and optional Telegram duplicate-note updates share clip ownership; the Worker is not deployed by this change. Full results and revision are recorded in the PR and owner manual. Manual CI verifies native MariaDB and physical Linux artifacts; no deployment trigger was added.

The matched synthetic recovery rehearsal used a task-owned local helper outside the repository, with two new disposable databases, native dump/restore, all 52 table schemas/rows compared, and copied media/shared-marker bytes checked. Its AES-GCM key fixture tests matched-key recovery; it does not exercise a real provider-account record. The versioned `scripts/verify-db-recovery.mjs` remains the separate SQL-only CI rehearsal. Non-secret results and helper hashes are in the dated owner report.

No merge, deployment, production changes, paid-provider calls, publication, account connection or automation activation is included. Tenant/staff membership, multi-source attribution, a unified job-history product and production backup infrastructure remain separate decisions.
