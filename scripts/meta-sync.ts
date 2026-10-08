/**
 * Pull Instagram and Facebook insights (PLAN.md §5.O12): one `post_metrics`
 * snapshot per known post and yesterday's `account_metrics` row, for every
 * account linked in Settings → Meta. Run it daily (Task Scheduler locally).
 *
 *   npm run meta:sync [-- --days 90]
 *
 * Exits 0 when nothing failed, 1 when an account failed or a login expired.
 * Never prints a token.
 */

import { closeDb } from "../src/db";
import { syncMeta } from "../src/lib/meta/sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const days = Number(arg("--days") ?? 90);
  const r = await syncMeta({ days: Number.isFinite(days) && days > 0 ? days : 90 });
  if (r.integrations === 0) {
    console.log("No Meta connection yet. Open Settings → Meta in the app and follow the steps.");
    return 0;
  }
  console.log(
    `Meta sync: ${r.accounts} account(s), ${r.mediaSeen} media seen, ${r.postsMatched} matched, ` +
      `${r.snapshots} post snapshot(s), ${r.accountRows} account row(s).`,
  );
  for (const e of r.errors) console.log(`  problem: ${e}`);
  return r.errors.length || r.expired.length ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
