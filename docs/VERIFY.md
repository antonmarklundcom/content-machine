# Verification

This conversion uses native MariaDB/MySQL behavior. Verification status for the current conversion is **pending CI and final review**; consult the PR checks and [conversion findings](CONVERSION-FINDINGS.md) for current evidence. This guide describes intended checks, not a claim that they have passed.

## Automated checks

`npm run verify` runs typecheck, lint/format checks, unit tests, database integration tests, and a Next.js build. The integration suite requires an explicitly disposable synthetic database with a name ending in `_test` and destructive-test opt-in. Confirm `DATABASE_URL` before setting `ALLOW_DESTRUCTIVE_TEST_DB=1`; never point it at operational data.

CI is expected to provision native MariaDB services and exercise migrations and application queries through `mysql2`. The actual passing result must be read from the current CI run. No CI status is inferred from this document.

The Hostinger packaging and isolated standalone artifact checks are described in [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md). Build/package hooks must not connect to a database, migrate, seed, or contact providers.

## Manual checks and live integrations

A successful synthetic test does not verify a real Hostinger account, its database version, provider credentials, external billing, OAuth callbacks, or real publishing. The repository has not been deployed. Do not run paid or live-provider probes as part of routine verification.

Windows-specific paths, Task Scheduler, media storage, CLI access, rendering, and offline worker behavior require local PC checks. Hosted `APP_MODE=online` does not establish that PC-bound tools or workers can run on the hosted server.

## Historical verification records

The original Content Engine verification instructions referred to PostgreSQL/Neon and its historical CI setup. They are preserved as source history and are not current instructions for this repo. See [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md), [AUDIT-FIXES-2026-10-08.md](AUDIT-FIXES-2026-10-08.md), and the repository Git history.
