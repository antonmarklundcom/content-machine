# Known issues

Current cross-phase issues and unverified behavior. Conversion-specific items are tracked in [CONVERSION-FINDINGS.md](docs/CONVERSION-FINDINGS.md). The source audit trail and inherited fixes remain available in [AUDIT-FIXES-2026-10-08.md](docs/AUDIT-FIXES-2026-10-08.md), [SOURCE-PROVENANCE.md](docs/SOURCE-PROVENANCE.md), and Git history.

## Conversion and readiness

- Current conversion CI and final review status are pending; use the current PR checks as the source of truth.
- This repository is not deployed. Hostinger plan/runtime, MariaDB version, persistent storage, backups, and actual hPanel behavior remain unverified — [DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md).
- Local Windows setup, PC media paths, CLI integrations, rendering tools, and offline workers require machine-specific configuration and have not been certified by hosted build checks.
- `APP_MODE=online` gates PC-dependent features in the online app; it does not make local media, CLI tools, ffmpeg, or PC/offline workers execute on Hostinger.
- Historical Neon/PostgreSQL live-run notes below the source baseline are not evidence about the current MariaDB runtime. Historical provider and feature findings remain only where explicitly retained in source audit records.

## Historical source findings

The following items were recorded against the inherited Content Engine source and may need revalidation against this conversion before they are treated as current defects:

- Live paid-provider smoke runs and model cost estimates were not verified in the source audit.
- YouTube caption access, API quota behavior, live media fetch/transcription, and Telegram Worker deployment depended on credentials or external services and were not covered by synthetic tests.
- Provider-specific OAuth and publishing behavior was documented from fixtures and fakes; real account flows were not exercised.
- Several feature and UI limitations remain documented in the original audit notes; see the dated audit and source Git history for their evidence and status.

Do not interpret this historical list as current MariaDB defects. Current confirmed database conversion defects and their regression status belong in [CONVERSION-FINDINGS.md](docs/CONVERSION-FINDINGS.md).
