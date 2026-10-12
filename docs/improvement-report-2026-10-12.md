# Content Machine — improvement report, 12 October 2026

Audited revision: `550dda9` on `main` (branch `claude/nifty-feynman-pah7i8` is identical to `main`). Environment: Linux, Node 22.22.0, npm 10.9.4, native MariaDB 10.11.14, ffmpeg installed. No deploy, provider call or account change was made. No fix was applied in this session.

## Evidence legend

- **RAN** — the command was executed in this session and the result is quoted.
- **READ** — the conclusion comes from reading code or docs; it was traced, not executed.

## What the project is

A single-owner (plus optional employees) Next.js 15 app for multi-brand social-media research, ideation, copywriting, media library, scheduling and publishing, plus a YouTube research tool. Runtime target is Hostinger managed Node.js with MariaDB/InnoDB through `mysql2` and Drizzle. Side components: a Cloudflare Worker for Telegram capture (`workers/telegram-capture`), a PHP bearer-token upload endpoint for shared hosting (`hosting/media-upload`), ~40 operator CLI scripts, and Windows launchers. The repo is a conversion of a PostgreSQL "Content Engine" source; it is documented as **not deployed**. Documentation is unusually thorough (`README.md`, `AGENTS.md`, `docs/VERIFY.md`, `docs/CONVERSION-*.md`, `docs/DEPLOY-HOSTINGER.md`), and a product backlog already exists in `docs/CONVERSION-REPORT.md` (CM-IMP-01…20). This report therefore concentrates on engineering, security, hygiene and consistency rather than repeating that product backlog.

## What was run (all RAN)

| Check              | Command                                                                           | Result                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Install            | `npm ci`                                                                          | OK with npm 10.9.4 although `engines` says npm ≥ 11.17.0 — not enforced (see IMP-06)                                               |
| App types          | `npm run typecheck`                                                               | pass                                                                                                                               |
| Worker types       | `npm run typecheck:worker`                                                        | pass                                                                                                                               |
| Lint + format      | `npm run lint`                                                                    | pass (eslint + prettier)                                                                                                           |
| Production audit   | `npm run audit:production`                                                        | 0 advisories                                                                                                                       |
| Full audit         | `npm audit`                                                                       | 9 dev-only advisories: 5 high (braces via eslint-config-next → fast-glob), 4 moderate (esbuild via drizzle-kit)                    |
| Unit tests         | `npm test`                                                                        | 684 pass, 0 fail, 0 skip                                                                                                           |
| Worker tests       | `npm run test:worker`                                                             | 25 pass                                                                                                                            |
| Native DB tests    | `npm run test:db` on MariaDB 10.11.14, `*_test` DB, `ALLOW_DESTRUCTIVE_TEST_DB=1` | 411 pass, 0 fail, 0 skip (ffmpeg present)                                                                                          |
| Migration metadata | `npx drizzle-kit check`                                                           | "Everything's fine"                                                                                                                |
| Schema drift       | `npx drizzle-kit generate`                                                        | "No schema changes, nothing to migrate" (tree restored)                                                                            |
| Build              | `npm run build` (+ postbuild)                                                     | pass, 2 m 53 s                                                                                                                     |
| Artifact           | `package-hostinger.mjs` + `validate-hostinger-artifact.mjs`                       | pass: mysql2 closure, static serving, login form, private-media denial                                                             |
| Outdated           | `npm outdated`                                                                    | next 15.5.27 → 16.4.0, eslint 9 → 10, typescript 5.9 → 7.0, undici 6 → 8, youtubei.js 15 → 18, dotenv 16 → 18, @types/node 22 → 26 |
| History secrets    | regex scan of `git log -p --all`                                                  | only the public YouTube InnerTube web-client key (IMP-23); no private keys or provider tokens                                      |

Not run: `scripts/verify-db-recovery.mjs` (requires a Docker container id; no Docker daemon here — IMP-22), wrangler/Worker deploy checks, `npm run smoke`, any live provider or OAuth flow, Windows launchers.

## Findings

Priority: **P1** fix before more traffic · **P2** this month · **P3** nice to have. Effort: S < 2 h, M half to one day, L more. "Owner" marks items that need a decision or an asset only the owner can supply.

### P1

**IMP-01 · P1 · S · READ — No HTTP security headers.**
Evidence: `next.config.ts:1-20` sets only `poweredByHeader: false`; `grep` for `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy` across `next.config.ts`, `src/middleware.ts` and `src/app/api` finds nothing except `x-content-type-options` on media streams (`src/lib/media/serve.ts:92`). Server actions and cookie-authenticated pages can be framed by any site.
Fix: add a `headers()` block in `next.config.ts` for `/(.*)`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` (the app records voice at `/voice/record`, so microphone must stay allowed for self), and `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, the owner's other subdomains are unknown). Leave CSP for a later report-only pass; Next inline scripts need nonces. Extend `scripts/validate-hostinger-artifact.mjs` to assert the headers on the login page so the build gate proves it.

**IMP-02 · P1 · M · READ — Login has no throttling.**
Evidence: `src/lib/auth/actions.ts:20-33` runs `bcrypt.compare` (cost 12, pure JS, `src/lib/auth/password.ts:9`) on every attempt with no per-IP or per-account limit; `grep -i "rate.?limit|429"` in `src/lib/auth`, `src/middleware.ts` and the login page finds nothing. The login form is the only unauthenticated POST on the public origin; unlimited attempts are both a credential-stuffing path and a CPU exhaustion path on a shared Node slot.
Fix: pure module `src/lib/auth/throttle.ts` with an in-memory sliding window keyed by client IP (first `x-forwarded-for` value, falling back to request IP) and by lower-cased email; defaults 10 failures per 15 minutes per key (engineering defaults, adjust freely); on limit return the same generic failure message after the same bcrypt delay. Unit-test the window. Document that the limiter is per process (Hostinger runs one) and resets on restart.

**IMP-03 · P1 · S · READ — Login loses the destination, which breaks the phone share sheet when signed out.**
Evidence: `src/middleware.ts:36-37` redirects every protected URL to `/youtube/login` with no return parameter; `src/lib/auth/actions.ts:32` always `redirect("/youtube")`. `src/app/share/page.tsx` (the manifest `share_target`, `src/app/manifest.ts:28-32`) therefore drops the shared `url`/`text` whenever the session has expired (30-day TTL, `src/lib/auth/token.ts:20`); the user lands on `/youtube` with nothing saved. Deep links from Telegram nudges (`APP_URL` in `workers/telegram-capture/wrangler.toml`) suffer the same.
Fix: middleware appends `?next=<pathname+search>`; `LoginForm` carries it in a hidden field; the action validates it with a pure `safeNextPath()` (must start with a single `/`, no `//`, no backslash, no scheme) and falls back to `/youtube`. Add unit tests for `safeNextPath` and extend the existing middleware regression test (`CM-BUG-27` test) with the `next` parameter.

### P2

**IMP-04 · P2 · S code + Owner asset · READ — PWA manifest has no icons, so the app is not installable and `share_target` cannot be used.**
Evidence: `src/app/manifest.ts:21` `icons: []`; there is no `public/` directory (`ls public` → ENOENT; `scripts/prepare-hostinger.mjs:24-31` creates an empty one) and no `src/app/icon.*`/`apple-icon.*`. Chrome requires at least a 192 px icon for install; every page also triggers a 404 for `/favicon.ico`.
Fix: **Owner** supplies the brand icon files (192 px, 512 px, maskable PNG, plus a favicon source). Code then adds `src/app/icon.png`, `src/app/apple-icon.png` and the `icons` entries in `manifest.ts`. No icon is to be generated by an agent unless the owner asks for it.

**IMP-05 · P2 · S · READ — No root error, not-found or global-error boundary.**
Evidence: `ls src/app/*.tsx` → only `layout.tsx` and `page.tsx`; `error.tsx`, `not-found.tsx` and `loading.tsx` exist only under `src/app/youtube/**`. A database outage on `/posts`, `/calendar` or `/media` shows Next's bare default error screen with no way back, and an unknown URL outside `/youtube` gets the unstyled default 404.
Fix: add `src/app/error.tsx`, `src/app/not-found.tsx` and `src/app/global-error.tsx` mirroring the existing `src/app/youtube/error.tsx` and `not-found.tsx` patterns and reusing their dictionary keys; do not invent new copy.

**IMP-06 · P2 · S · RAN — Declared engines are not enforced.**
Evidence: `package.json` declares `node >=22.13.0`, `npm >=11.17.0`, `packageManager npm@11.17.0`; `npm ci` with npm 10.9.4 completed with no warning in this session. There is no `.nvmrc`/`.node-version` and no `.npmrc` with `engine-strict=true`, so local and Hostinger installs can silently differ from CI (which pins npm 11.17.0 in `.github/workflows/ci.yml:146-147`).
Fix: add `.nvmrc` containing `22` and `.npmrc` containing `engine-strict=true`. **Owner caveat:** confirm in hPanel that the Hostinger build npm satisfies ≥ 11.17.0 before merging, otherwise the hosted install would now fail loudly instead of silently (OPS-01 in `docs/CONVERSION-REPORT.md`). If that cannot be confirmed yet, ship `.nvmrc` only.

**IMP-07 · P2 · S · READ — Contributor docs and comments contradict the current validation policy and runtime.**
Evidence: `CONTRIBUTING.md:17-30` still mandates `phase/<id>` branches, "Red CI is your own work", "`npm run verify` passes before a PR is opened", "Done = PR merged green" and phase logs with "CI green on <sha>" (`docs/log/README.md:9`), while `AGENTS.md` and `docs/VERIFY.md:5-9` make CI manual-only and put validation on agents. `KNOWN-ISSUES.md:7` says "The final PR head must also have green checks before merge" about a PR that is already merged. `src/lib/cron-auth.ts:6-9` says the cron endpoint is "the app's only authenticated surface" and that "everything else sits behind HTTP basic auth configured at the Hostinger level", which has been false since the session middleware. `PLAN.md:1` is titled "content-engine build 3" with no historical banner.
Fix: rewrite the CONTRIBUTING autonomy items to point at `docs/VERIFY.md`; change the log template line to "Verification: commands run, revision, results"; delete the stale KNOWN-ISSUES sentence; fix the cron-auth comment; add a one-line "historical build contract, see docs/CONVERSION-PLAN.md" banner to `PLAN.md`.

**IMP-08 · P2 · S · Owner decision then code · READ — The product is named "Content Engine" in the UI and "Content Machine" in the repo.**
Evidence: `src/app/layout.tsx:7` `title: "Content Engine"`, `src/app/manifest.ts:17-18`, `src/lib/i18n/dict/app.ts:4,54` (`app.name`), `start.bat:2`, `setup.bat:2`, every PHP comment in `hosting/media-upload/*.php`; versus `README.md`, `package.json`, `setup.ps1:1` ("Content Machine"). Eleven markdown files use the old name.
Fix: **Owner** confirms the product name (the README name is the default assumption). Then change the title, manifest, dictionary, launcher comments and PHP comments in one commit. The Meta app-name example in `dict/meta.ts` is user guidance and can stay.

**IMP-09 · P2 · S · READ — The login page is indexable and `robots.txt` would redirect to login.**
Evidence: `src/app/layout.tsx:6-10` has no `robots`; only `src/app/share/page.tsx:12` sets `robots: { index: false }`. There is no `src/app/robots.ts`, and the middleware matcher (`src/middleware.ts:53`) does not exclude `/robots.txt`, so a crawler fetching it gets a 307 to `/youtube/login`.
Fix: add `robots: { index: false, follow: false }` to the root metadata, add `src/app/robots.ts` disallowing `/`, and add `robots.txt` to the matcher exclusions.

**IMP-10 · P2 · S · READ — The Cloudflare Worker has no lockfile.**
Evidence: `ls workers/telegram-capture` → `README.md package.json scripts src test tsconfig.json wrangler.toml`; no `package-lock.json`. `wrangler` is not installed by the root `npm ci`, so a Worker deploy resolves `wrangler ^3.99.0` and `mysql2 ^3.13.0` fresh each time. Suspicion (not run): `compatibility_date = "2026-10-08"` may be newer than what a wrangler 3.x bundle accepts.
Fix: run `npm install --package-lock-only` in `workers/telegram-capture` and commit the generated lockfile (never hand-edit it). Report, do not fix, if `npx wrangler deploy --dry-run` rejects the compatibility date.

**IMP-13 · P2 · S · RAN/READ — `npm run verify` omits the worker and the production audit that `docs/VERIFY.md` calls mandatory.**
Evidence: `package.json` `verify` = typecheck, lint, test, test:db, build; `docs/VERIFY.md:25` admits it "does not include the separate worker or production-audit commands"; `README.md` presents `verify` as the all-in-one command.
Fix: add `typecheck:worker` and `test:worker` to `verify`; keep `audit:production` separate because it needs network, and say so in README and VERIFY in the same commit.

**IMP-14 · P2 · S · READ — Four API routes rely only on the middleware matcher for authentication.**
Evidence: route inventory — `src/app/api/brands/route.ts` (GET), `src/app/api/ideas/route.ts` (GET), `src/app/api/ideas/[id]/route.ts` (PATCH), `src/app/api/ingest/route.ts` (POST) contain no `getSession`/`requireUser` call; all 32 other routes check explicitly. `src/app/api/ingest/route.ts:15-17` documents the reliance. One future edit to the matcher regex opens them silently. `src/app/api/ideas/[id]/route.ts:12` also calls `request.json()` unguarded, so a malformed body is a 500.
Fix: add the same `getSession()` → 401 JSON pattern used in `src/app/api/generate/route.ts:16-17` to the four routes, and wrap the JSON parse in a 400. Cover with the existing `callRoute` integration helpers where a DB is available.

### P3

**IMP-11 · P3 · S · RAN — Nine development-tool advisories remain.**
Evidence: `npm audit` output above; both chains are dev-only and already recorded as CM-RISK-10. `npm audit fix --force` would downgrade `eslint-config-next` to 14 and `drizzle-kit` to 0.18, which is wrong.
Fix: **Owner/agent task** at the next dependency pass: check whether `eslint-config-next` 15.5.x/16 and `drizzle-kit` have moved off the affected ranges; otherwise add a narrow `overrides` entry for `braces` only after confirming the patched version upstream. Do not downgrade.

**IMP-12 · P3 · L · RAN — Dependency currency.**
Evidence: `npm outdated` above; Next 15.5 while 16.4 is current, TypeScript 5.9 vs 7.0, eslint 9 vs 10, undici 6 vs 8, youtubei.js 15 vs 18 (the v15 pin is deliberate, CM-SEC-03).
Fix: **Owner decision** on timing; plan one separate upgrade PR per major (Next 16 first, since it carries security fixes longest), each validated with the full native suite and a Linux artifact per `docs/VERIFY.md`. Out of scope for the fix prompt.

**IMP-15 · P3 · M · READ — CSRF defence rests on `SameSite=Lax` alone.**
Evidence: `src/lib/auth/session.ts:33` sets `sameSite: "lax"`; the four multipart routes (`src/app/api/stories/upload/[slug]`, `voice/recordings`, `voice/reference/[profileId]`, `voice/consent`) and the JSON POST/PATCH routes accept cookie auth with no `Origin`/`Sec-Fetch-Site` check (`grep -i origin src/app/api` finds only OAuth origin building). Modern browsers make this safe today; it is one default away from not being.
Fix: pure helper `assertSameOrigin(request)` that rejects `Sec-Fetch-Site: cross-site`, or an `Origin` that differs from `applicationOrigin(request)`, with 403; call it first in every cookie-authenticated mutating route (bearer-authenticated cron/clips paths excluded). Unit-test the helper.

**IMP-16 · P3 · M · READ — Header dropdowns are hover/focus-only and announce no state.**
Evidence: `src/components/HeaderNav.tsx:55-64` `aria-haspopup="true"` with no `aria-expanded`, the menu opens via `group-hover`/`group-focus-within` CSS, no Escape or outside-click close, no arrow-key movement.
Fix: controlled open state per menu with `aria-expanded`, `aria-controls`, Escape to close, close on outside click and on route change. Keep the CSS fallback so it still works without JS.

**IMP-17 · P3 · S · Owner decision · READ — Historical PostgreSQL migrations and the `pg` dev dependency remain in the tree.**
Evidence: `drizzle/` holds 14 SQL migrations and 14 snapshots (~1.8 MB of the largest tracked files), ignored by eslint and prettier; `AGENTS.md` calls PostgreSQL files "historical only"; `pg` is used only by the dynamically imported legacy importer `scripts/learn-import-aiinsights.ts:6-9`.
Fix: **Owner** decides between moving `drizzle/` to `docs/history/` or deleting it (Git keeps it) and whether the aiinsights importer plus `pg` stay. Not in the fix prompt.

**IMP-18 · P3 · S · Owner · READ — No LICENSE while the repo is described as public.**
Evidence: `ls LICENSE*` → none; `AGENTS.md` says "this public repository"; `package.json` `"private": true`.
Fix: **Owner** either adds the licence of their choice or makes the repository private. Do not invent one.

**IMP-19 · P3 · S · Owner · READ — No automatic signal on pull requests and no dependency alerts.**
Evidence: `.github/workflows/ci.yml:9-10` is `workflow_dispatch` only (owner policy of 8 October); `.github/` has no `dependabot.yml`; no PR template.
Fix: **Owner decision**: whether a cheap `pull_request` job limited to typecheck + lint + unit tests (about three minutes, no database) fits the Actions budget, and whether a monthly, security-only Dependabot config is wanted. The current manual policy stays until the owner changes it.

**IMP-20 · P3 · M · READ — Sessions cannot be revoked.**
Evidence: `src/lib/auth/token.ts:7-13` documents the stateless trade-off; `endSession` (`session.ts:40-43`) only deletes the cookie, and a password reset via `npm run yt:seed-owner` leaves every issued 30-day token valid. The role is re-read per request (`getSession`), so a stolen token keeps access until expiry or a `SESSION_SECRET` rotation.
Fix: bind the token to the credential by adding a short `sha256(passwordHash)` fragment to the signed payload and comparing it in `getSession()`; middleware stays signature-only. Changing the password then logs every device out. Issuing format change is acceptable before deployment.

**IMP-21 · P3 · S · READ — Per-request query fan-out in the header and home page.**
Evidence: `src/components/Header.tsx:18` calls `spendStatus()` on every signed-in page render; `src/app/page.tsx:44-60` runs one `countPostsByStatus` query per family and per loose brand.
Fix: measure first (CM-IMP-20 already says so). If needed, one grouped count query for the home page and a short-lived memo for spend status. Not in the fix prompt.

**IMP-22 · P3 · M · READ/RAN — The backup-and-restore proof only works inside the Docker-based CI job.**
Evidence: `scripts/verify-db-recovery.mjs:18-20` demands a container id and shells out to `docker exec`; with a native MariaDB available here and no Docker daemon, the recovery check could not be run even though `docs/VERIFY.md:9` makes it mandatory for recovery changes.
Fix: add a `--native` mode that uses `mariadb-dump`/`mariadb` from PATH with the `DATABASE_URL` credentials under the same `*_test` guard, keeping the Docker path for CI.

**IMP-23 · P3 · S · RAN — A hard-coded Google API key trips secret scanners.**
Evidence: `src/lib/youtube/captions/innertube.ts:19` `INNERTUBE_KEY = "AIza…"`. It is YouTube's public web-client InnerTube key embedded in every youtube.com page, not a secret, but the history scan flagged it and GitHub push protection or a future scanner will too.
Fix: a comment above the constant stating it is the public web-client key and why it is constant; no code change.

## Already good

- **Verification culture is real.** 684 unit, 25 worker and 411 native integration tests all pass; the integration suite refuses to run outside a `*_test` database on loopback or an allowlisted host (`src/db/test-database-guard.ts`); migrations match the schema with no drift; the Linux artifact validator boots the server without credentials and checks private-media denial.
- **Auth and secrets handling.** Fail-closed middleware on a missing `SESSION_SECRET`; HMAC tokens compared in constant time; cron and clip bearer tokens hashed before `timingSafeEqual` and 503 (not 401) when unset; one generic login error; bcryptjs to avoid native builds; owner-only spend gates checked server-side (`requireOwner`).
- **Media serving.** Segment allow-listing, symlink containment, range requests, `nosniff`, `private, no-cache`, and an unplugged drive is a 503 not a 500.
- **Database layer.** READ COMMITTED default, UTC and strict `sql_mode` per connection, bounded pool, no `RETURNING` emulation that re-runs predicates (CM-BUG-08), native deadlock fixes verified under real InnoDB.
- **PHP upload endpoint.** Bearer token with `hash_equals`, extension + sniffed MIME agreement, random file names, `.htaccess` denies everything but the two scripts, `config.php` and `files/` git-ignored.
- **Hygiene.** `.env.example` covers every runtime variable found in code; `.gitattributes` fixes line endings; `poweredByHeader` off; no `dangerouslySetInnerHTML`, `eval` or TODO debt; every `<img>` has `alt`; `aria-label`/`role="status"`/`aria-live` used widely; `<html lang>` follows the locale; Swedish dictionary typed against English so a missing key fails typecheck.
- **Docs.** The deploy guide refuses to invent Hostinger values and separates verified from unverified; conversion findings cite file and line for every fix.

## Suggested order

1. IMP-01 headers, IMP-03 return URL, IMP-09 noindex + robots (three small security/correctness commits, same area).
2. IMP-02 login throttle.
3. IMP-05 error boundaries, IMP-14 explicit route auth.
4. IMP-07 docs, IMP-13 verify script, IMP-06 engines, IMP-10 worker lockfile, IMP-23 comment.
5. Owner decisions in parallel: IMP-04 icons, IMP-08 name, IMP-18 licence, IMP-19 CI/Dependabot, IMP-17 legacy files, IMP-11/12 dependency plan.
6. Then IMP-15, IMP-16, IMP-20, IMP-22 as time allows; IMP-21 only after measurement.

## Owner tasks (not code)

- **IMP-04** supply app icon files (192, 512, maskable, favicon source).
- **IMP-06** confirm the Hostinger build npm version before `engine-strict` is merged.
- **IMP-08** confirm the product name.
- **IMP-11 / IMP-12** decide timing for the dependency pass and the Next 16 upgrade.
- **IMP-17** decide the fate of `drizzle/` (PostgreSQL history) and the `pg` importer.
- **IMP-18** choose a licence or make the repository private.
- **IMP-19** decide whether a small automatic PR check and Dependabot fit the Actions budget.

The fix prompt for the code tasks is in `docs/next-session/fix-prompt.md`.
