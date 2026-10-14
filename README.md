# Content Machine

A multi-brand content and media workspace with a web interface, research and publishing tools, and PC-based production workflows. The converted runtime targets Hostinger Node.js with MariaDB/InnoDB; the live site and prepared changes have separate deployment and verification status.

The initial app and feature history came from a fixed Content Engine revision. See [source provenance](docs/SOURCE-PROVENANCE.md), [the dated reliability audit](docs/AUDIT-FIXES-2026-10-08.md), and [conversion findings](docs/CONVERSION-FINDINGS.md) for source evidence, inherited audit history, and current conversion status. The original repository retains its full Git history.

## Guided workspace

See [the guided light design](docs/GUIDED-DESIGN.md) for the task-based Start page, workflow navigation, mobile menus and design validation scope. Deployment of a reviewed revision remains separate.

## Private pilot

See [the private Hostinger pilot guide](docs/HOSTINGER-PRIVATE-PILOT.md) for capture, saved lessons/resource links, automation switches and deployment acceptance. New installs start with automation paused. The code is prepared for review; hosted acceptance remains separate.

## Local setup

Use [docs/LOCAL-SETUP.md](docs/LOCAL-SETUP.md). You need Node.js 22.13+, npm 11.17+, a reachable MariaDB database, and a local `.env`. Migrations and seed commands are explicit operator actions; builds and server startup do not run them.

The online app mode gates PC-dependent production features. Media paths, CLI integrations, ffmpeg tools, and offline workers depend on their own local configuration and do not become hosted capabilities merely by setting `APP_MODE=online`.

## Database and runtime

- `DATABASE_URL` uses the MySQL protocol, for example `mysql://user:encoded-password@host:3306/content_machine`.
- Runtime database access uses `mysql2`; schema and active migrations use Drizzle’s MySQL dialect.
- The current baseline contains 51 application tables. PostgreSQL/Neon setup text and migrations belong to the historical source record, not this runtime.
- Run `npm run db:migrate` and `npm run db:seed` as explicit maintenance steps against the intended database. Do not put them in build or start hooks.
- Hostinger packaging guidance is in [docs/DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md).

## Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build` | Build Next.js standalone output; postbuild prepares the standalone server |
| `npm run start` | Start the prepared standalone server |
| `npm run db:check` | Check the configured DB connection |
| `npm run db:migrate` | Apply active Drizzle/MySQL migrations |
| `npm run db:seed` | Insert baseline data |
| `npm run yt:seed-owner` | Create/reset the owner login from environment values |
| `npm run verify` | Typecheck, lint, unit tests, DB integration tests, and build |

See [docs/VERIFY.md](docs/VERIFY.md) for what each verification layer establishes and the current CI status.

## Conversion result

[PR #1](https://github.com/antonmarklundcom/content-machine/pull/1) contains the completed Hostinger/MariaDB conversion. [verified code run](https://github.com/antonmarklundcom/content-machine/actions/runs/37854603317) passed both native database versions, Windows and physical standalone checks; those checks verified the completed conversion. Future work follows the owner’s [manual validation policy](docs/VERIFY.md). Confirm the deployed revision against the reviewed branch; a running site may still serve an older release. Read the [completion report and ranked twenty improvements](docs/CONVERSION-REPORT.md), [confirmed findings](docs/CONVERSION-FINDINGS.md) and [Hostinger guide](docs/DEPLOY-HOSTINGER.md). Configure APP_MODE=online and canonical HTTPS APP_URL explicitly for hosted use.
