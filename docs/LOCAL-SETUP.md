# Local setup

This guide runs the converted Content Machine on a Windows PC. It needs Node.js 22.9 or newer, npm 11.17.0 or newer, Git, and a reachable MariaDB/InnoDB database. PostgreSQL/Neon instructions from the source repository are historical; see [source provenance](SOURCE-PROVENANCE.md) and [the audit record](AUDIT-FIXES-2026-10-08.md).

## 1. Get the code and install dependencies

Clone the Content Machine repository to a working folder, open PowerShell there, and check:

```powershell
node --version
npm --version
git --version
npm ci
```

The repository declares Node `>=22.9.0` and npm `>=11.17.0`.

## 2. Configure the database and app

Create or select a disposable/local MariaDB database and user yourself. The app does not create the database server or database for you. Copy the example environment file and edit it locally:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least:

```dotenv
DATABASE_URL="mysql://user:encoded_password@127.0.0.1:3306/content_machine"
SESSION_SECRET=replace-with-at-least-32-random-characters
```

Use the actual host, database, username, and password for your MariaDB instance. URL-encode reserved characters in the password. Keep `.env` private and out of Git. No `DB_DRIVER` selector is needed.

For the owner login, set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in the environment before running the owner seed command. Set provider keys only when you intentionally use those integrations; they are not required for a basic local boot.

## 3. Initialize and start

These are explicit database operations. Confirm the connection points to your intended local/disposable database before running them:

```powershell
npm run db:check
npm run db:migrate
npm run db:seed
npm run yt:seed-owner
npm run dev
```

Open http://localhost:3000 and sign in. The migration and seed scripts are operator-run commands. `npm run build`, the postbuild standalone preparation step, and `npm run start` do not migrate or seed.

## 4. Local production-style run

```powershell
npm run build
npm run start
```

The standalone server uses the configured port. Stop it with Ctrl+C.

## PC workflows and hosted mode

The app supports PC-oriented media, CLI, rendering, and offline worker workflows, subject to local paths, tools, credentials, and services being configured. `APP_MODE=online` applies hosted UI/runtime gating; it does not transfer those PC capabilities to Hostinger. Do not assume PC media paths, Claude/Codex CLI sessions, ffmpeg, or offline workers execute on the hosted server. Configure and run PC jobs on the PC. Media handoff and hosted delivery have separate settings; see [STORAGE.md](STORAGE.md) and [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md).

## Updating

After updating the checkout and dependencies, explicitly review and apply pending database migrations:

```powershell
npm ci
npm run db:check
npm run db:migrate
npm run build
```

Do not run migrations against a production database without the separately approved backup, restore, and maintenance procedure.

## Troubleshooting

- **Connection failure:** check that MariaDB is running/reachable and that `DATABASE_URL` uses `mysql://` with the correct database and URL-encoded password.
- **Login unavailable:** check `SESSION_SECRET`, then run `npm run yt:seed-owner` with the intended `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- **PC feature reports missing tool/path:** check the local configuration and installed tool (for example `MEDIA_ROOT` or ffmpeg); `APP_MODE=online` does not make PC resources available to the hosted app.
