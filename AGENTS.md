# Content Machine work instructions

Preserve source features and audit safety fixes. Target Hostinger managed Node.js + MariaDB/InnoDB; PostgreSQL files are historical only. Follow docs/CONVERSION-PLAN.md and keep docs/CONVERSION-FINDINGS.md current. Do not deploy, publish, change connected accounts, or make paid provider calls as part of conversion.

Use hostinger-nodejs and project-operations-manuals; maintain C:/operation manuals/content-machine/README.md after substantive changes. Do not include credentials, real DB dumps or customer records in this public repository.

Use bounded subagents for disjoint modules. Root owns schema, driver, persistence helper contracts, publication/spend/lease/token architecture and dependency/build/DB coordination. Prefer available GPT-6 Luna Low/Medium for mapping and routine fixture work; difficult database/architecture work stays with GPT-6.1 Sol. No agent shares mutable test databases, runs competing builds, or commits/pushes independently.

All tests are synthetic and external providers mocked. Required merge gate: safe test-DB guards; clean install; typecheck, lint/format, full unit/worker/native MariaDB integration checks; isolated physical Linux standalone server; regression evidence for confirmed database bugs. Never hide database truncation, FK or duplicate-key errors with blanket ignore semantics.
