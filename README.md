# Content Machine

A multi-brand content and media workspace with a web interface, research and publishing tools, and PC-based production workflows. The converted runtime targets Hostinger Node.js with MariaDB/InnoDB; this repository has **not been deployed**.

The initial app and feature history came from a fixed Content Engine revision. See [source provenance](docs/SOURCE-PROVENANCE.md), [the dated reliability audit](docs/AUDIT-FIXES-2026-10-08.md), and [conversion findings](docs/CONVERSION-FINDINGS.md) for source evidence, inherited audit history, and current conversion status. The original repository retains its full Git history.

## Local setup

Use [docs/LOCAL-SETUP.md](docs/LOCAL-SETUP.md). You need Node.js 22.13+, npm 11.17+, a reachable MariaDB database, and a local `.env`. Migrations and seed commands are explicit operator actions; builds and server startup do not run them.

The online app mode gates PC-dependent production features. Media paths, CLI integrations, ffmpeg tools, and offline workers depend on their own local configuration and do not become hosted capabilities merely by setting `APP_MODE=online`.

## Database and runtime

- `DATABASE_URL` uses the MySQL protocol, for example `mysql://user:encoded-password@host:3306/content_machine`.
- Runtime database access uses `mysql2`; schema and active migrations use Drizzle’s MySQL dialect.
- The current baseline contains 50 application tables. PostgreSQL/Neon setup text and migrations belong to the historical source record, not this runtime.
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

[PR #1](https://github.com/antonmarklundcom/content-machine/pull/1) contains the completed Hostinger/MariaDB conversion. [verified code run](https://github.com/antonmarklundcom/content-machine/actions/runs/37854603317) passed both native database versions, Windows and physical standalone checks; final PR head checks govern merge. The app is not deployed. Read the [completion report and ranked twenty improvements](docs/CONVERSION-REPORT.md), [confirmed findings](docs/CONVERSION-FINDINGS.md) and [Hostinger guide](docs/DEPLOY-HOSTINGER.md). Configure APP_MODE=online and canonical HTTPS APP_URL explicitly for hosted use.
