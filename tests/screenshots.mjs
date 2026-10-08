/**
 * The one screenshot pass (PLAN.md §4.13).
 *
 * The pages S5 (one design system, §6.S5) wants a reviewer to look at. Every
 * page but the login needs a session, so when DATABASE_URL is set this upserts
 * a throwaway owner (`screenshots@example.invalid`) and signs in through the
 * real login form first. Without a database only the login page is captured.
 *
 * Runs against an already-started server (`next start`), writes PNGs to the
 * git-ignored docs/screenshots/, and CI uploads that directory as an artifact.
 * Never committed: a screenshot in the repo is stale the day after it lands.
 *
 *   BASE_URL=http://127.0.0.1:3000 node tests/screenshots.mjs
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import bcrypt from "bcryptjs";
import { createPool } from "mysql2/promise";
import { tsImport } from "tsx/esm/api";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT_DIR = "docs/screenshots";

/** Two widths: the phone the inbox is designed for (§1.6), and a desktop. */
const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

/** ≤ 5 pages — the polish cap is one pass, not a suite. `auth: false` is shot signed out. */
const PAGES = [
  { name: "youtube-login", path: "/youtube/login", auth: false },
  { name: "brands", path: "/", auth: true },
  { name: "brand-propia", path: "/brand/propia", auth: true },
  { name: "inbox", path: "/inbox", auth: true },
  { name: "youtube", path: "/youtube", auth: true },
];

const LOGIN_EMAIL = "screenshots@example.invalid";
const LOGIN_PASSWORD = "screenshots-only-password";

/** Upsert the throwaway owner. Returns false (skip the signed-in pages) without a database. */
async function seedLogin() {
  if (!process.env.DATABASE_URL) return false;
  const [{ requireDisposableTestDatabase }, { databaseOptions }] = await Promise.all([
    tsImport("../src/db/test-database-guard.ts", import.meta.url),
    tsImport("../src/db/driver.ts", import.meta.url),
  ]);
  const url = requireDisposableTestDatabase(
    process.env.DATABASE_URL,
    process.env.ALLOW_DESTRUCTIVE_TEST_DB,
  );
  const client = createPool(databaseOptions(url));
  try {
    const hash = await bcrypt.hash(LOGIN_PASSWORD, 10);
    await client.execute(
      `insert into yt_users (email, role, password_hash) values (?, 'owner', ?)
       on duplicate key update password_hash = values(password_hash)`,
      [LOGIN_EMAIL, hash],
    );
  } finally {
    await client.end();
  }
  return true;
}

async function signIn(page) {
  await page.goto(new URL("/youtube/login", BASE_URL).toString());
  await page.fill('input[name="email"]', LOGIN_EMAIL);
  await page.fill('input[name="password"]', LOGIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/youtube/login")),
    page.click('form:has(input[name="password"]) button[type="submit"]'),
  ]);
}

async function main() {
  const canSignIn = await seedLogin();
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // CI downloads the browser build that matches its Playwright version. On a
  // machine that already has one — a dev box, a sandbox with a preinstalled
  // Chromium — point this at it rather than downloading a second copy.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    for (const viewport of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      // Signed-out pages first, then sign in once for the rest.
      const targets = [...PAGES].sort((a, b) => Number(a.auth) - Number(b.auth));
      let signedIn = false;
      for (const target of targets) {
        if (target.auth && !canSignIn) {
          console.log(`skipped ${target.path} (no DATABASE_URL to sign in with)`);
          continue;
        }
        if (target.auth && !signedIn) {
          await signIn(page);
          signedIn = true;
        }
        const url = new URL(target.path, BASE_URL).toString();
        const response = await page.goto(url, { waitUntil: "networkidle" });
        // A 500 that still paints something would otherwise be uploaded as if
        // it were the page, and reviewed as if it were fine.
        if (!response || response.status() >= 400) {
          throw new Error(`${url} returned ${response ? response.status() : "no response"}`);
        }
        // A redirect back to the login page is a failed sign-in, not the page.
        if (target.auth && new URL(page.url()).pathname !== target.path) {
          throw new Error(`${url} ended at ${page.url()}`);
        }
        const file = path.join(OUT_DIR, `${target.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`wrote ${file}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
