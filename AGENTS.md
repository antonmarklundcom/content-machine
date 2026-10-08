# Content Machine work instructions

Preserve source features and audit safety fixes. Target Hostinger managed Node.js + MariaDB/InnoDB; PostgreSQL files are historical only. Follow docs/CONVERSION-PLAN.md and keep docs/CONVERSION-FINDINGS.md current. Do not deploy, publish, change connected accounts, or make paid provider calls as part of conversion.

Use hostinger-nodejs and project-operations-manuals; maintain C:/operation manuals/content-machine/README.md after substantive changes. Do not include credentials, real DB dumps or customer records in this public repository.

Use bounded subagents for disjoint modules. Root owns schema, driver, persistence helper contracts, publication/spend/lease/token architecture and dependency/build/DB coordination. Prefer available GPT-6 Luna Low/Medium for mapping and routine fixture work; difficult database/architecture work stays with GPT-6.1 Sol. No agent shares mutable test databases, runs competing builds, or commits/pushes independently.

## Owner validation policy — 8 October 2026

GitHub CI is manual-only (workflow_dispatch). Pushes and PRs do not start automatic checks, and a green GitHub check is not a universal merge requirement. Agents own validation and record the exact revision, commands, pass/fail/skip results and limitations in the PR. Use docs/VERIFY.md for local commands and optional manual native CI.

Run checks appropriate to the change before merging: code changes need affected regression tests, type/lint checks and production build when relevant; worker changes also need worker types/tests. Database changes require safe disposable native MariaDB verification, including fresh migrations and affected concurrency/integrity regressions. Changes to recovery require actual synthetic dump AND restoration. Hosting/runtime/dependency packaging changes require a physically isolated Linux standalone artifact. Use the manual workflow when the needed native or Linux environment is unavailable locally. Do not merge an unverified high-risk change merely because automatic checks are off.

Documentation and trigger-only changes require focused formatting/configuration validation and diff review; do not repeat unrelated runtime suites. Review by Sol or Claude supplements actual command execution. Preserve all tests, test-DB guards and mocked providers. Never hide database truncation, FK or duplicate-key errors with blanket ignore semantics.
