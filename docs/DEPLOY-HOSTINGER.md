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

## GitHub import settings for the later deployment

Select the existing **content-machine** repository and its merged **main** branch. The repository root is the application root. Choose the supported Node 22 line at version 22.13 or newer (inspect the actual patch in both install and build logs), with npm meeting package.json. Use the actual hPanel build-command dropdown: the intended command is **npm run build**, which includes postbuild static/public preparation. The start script is **npm start**, resolving to **node .next/standalone/server.js** from the repository root. If hPanel offers an entry-file field instead, that file is **.next/standalone/server.js**. Confirm these controls against the selected framework in the actual account; do not invent a custom text field that the dropdown does not provide. A validated copied standalone artifact instead starts **node server.js** from its artifact root.

Hostinger documents automatic GitHub deployments and different installation/build controls by framework. Inspect the real install/build logs; a successful dependency install is not proof of a compatible production build. Keep media outside the per-deployment build folder. [Official import guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) · [Build/start settings](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/).

Create the empty database and apply **npm run db:migrate**, **npm run db:seed** and **npm run yt:seed-owner** explicitly from an authorized administrator environment before enabling use. Business/Cloud hosting does not promise npm commands through SSH. For a PC-based administrator, confirm Remote MySQL access/allowlisting and the correct remote hostname first; localhost on the PC is not the hosting database. Keep these steps separate from hPanel build/start. Do not expose an unauthenticated migration endpoint as a workaround. **APP_MODE=online** disables PC-only launch/reaping paths; it is not a global publishing or spending switch. Leave schedulers unconfigured and provider/account access absent until the separate pilot is approved.
