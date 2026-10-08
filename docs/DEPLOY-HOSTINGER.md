# Hostinger packaging and deployment

**Preparation only.** This repository has not been deployed, and the exact
Hostinger plan, Node.js runtime, MariaDB version, and persistent storage limits
have not been verified. Do not treat the example values below as owner-approved
production settings. There is no PostgreSQL/Neon production dependency in this
conversion.

## Build and inspect the Linux artifact

Use Linux for the release artifact; native standalone output contains traced
runtime files for the platform that built it. From a clean checkout with the
locked Node/npm versions:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:worker
npm run build
node scripts/package-hostinger.mjs /tmp/content-machine-hostinger
node scripts/validate-hostinger-artifact.mjs /tmp/content-machine-hostinger
```

The package command refuses to overwrite an existing destination or place the
artifact inside the repository. It copies `.next/standalone`, `.next/static`,
and `public` into a physical isolated directory. Validation checks the server,
static output, runtime manifest, and that `mysql2/promise` resolves inside the
artifact's own `node_modules`; it does not use the source checkout to satisfy a
missing runtime dependency.

The build and packaging steps must not connect to MariaDB, migrate or seed a
database, or contact an external provider. Start the validated artifact only
against an explicitly disposable synthetic database when testing behavior that
needs authenticated/database-backed routes. Do not put credentials or live
records in the artifact or CI logs.

## Runtime readiness before a future deploy

Before creating an app, confirm from the actual hPanel plan and install/build
logs:

- Supported Node.js major/minor and npm version satisfy this checkout's
  `engines` and `packageManager` declarations.
- The offered database is MariaDB/InnoDB at a version supported by the native
  CI matrix, and hPanel provides a connection host/database/user/password.
- The account can run the validated standalone Node server and has persistent
  storage outside the release directory for any media the hosted lane owns.
- A separate empty database can be created for this app. Do not point it at a
  PostgreSQL/Neon URL or any operational data during validation.

No provider call, publishing, OAuth account change, migration, or deployment is
authorized by this preparation guide. Keep dispatch disabled while verifying
startup and authenticated database-backed behavior. Apply migrations and seed
only after a separately authorized deployment plan defines backup and restore.

## Release artifact behavior

The validated directory contains `server.js`, the traced runtime dependency
tree (including `mysql2` and its transitive dependencies), `.next/static`, and
`public`. Hostinger's Node.js app should start this artifact with `node server.js`
from its root, with the configured port supplied by the platform. Do not run
`next start` against a standalone build. Do not run migrations or seed data from
build/start hooks; use a separately reviewed and authorized operational step.

## Configuration still requiring owner verification

The exact Hostinger plan/runtime/database version, app directory layout, Node
start command controls, media capacity, backup/restore procedure, and any
provider/OAuth configuration remain unverified. Record actual hPanel install
and build versions before deciding deployment compatibility. No live deployment
or data migration has been performed.
