/**
 * Delete expired public copies from the Hostinger media endpoint (PLAN.md
 * §1.41, §5.O10.4): every asset whose `public_expires_at` has passed
 * (`MEDIA_PUBLIC_RETENTION_DAYS`, default 90), unless a scheduled or
 * publishing post still uses it. The originals on MEDIA_ROOT are never
 * touched.
 *
 *   npm run media:prune
 *
 * Daily from Task Scheduler is plenty:
 *   schtasks /Create /SC DAILY /ST 04:00 /TN "content-engine media prune"
 *     /TR "cmd /c cd /d C:\path\to\content-engine && npm run media:prune >> logs\media-prune.log 2>&1"
 *
 * An endpoint that is not configured yet is a normal state: it says so and
 * exits 0. Exits 1 when any copy could not be removed.
 */

import { closeDb } from "../src/db";
import { prunePublic } from "../src/lib/media/public";

async function main(): Promise<number> {
  const result = await prunePublic();
  if (result.status === "missing") {
    console.log(result.message);
    return 0;
  }
  console.log(
    `${result.removed} public cop${result.removed === 1 ? "y" : "ies"} removed, ` +
      `${result.kept} kept for scheduled posts, ${result.errors.length} error(s).`,
  );
  for (const e of result.errors) console.error(`  asset ${e.assetId}: ${e.message}`);
  return result.errors.length ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
