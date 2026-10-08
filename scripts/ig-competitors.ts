/**
 * Look up every tracked Instagram competitor through Business Discovery and
 * store its recent posts (PLAN.md §6.S21), then print each own Instagram
 * account's weekly report. Run it daily (Task Scheduler locally):
 *
 *   npx tsx --conditions=react-server scripts/ig-competitors.ts [--brand <id>] [--no-report]
 *
 * Exits 0 when nothing failed, 1 when a lookup failed or a login expired.
 * Accounts that are not Business/Creator are "not available", not failures.
 */

import { closeDb } from "../src/db";
import { listIgAccounts, syncIgCompetitors, weeklyReport } from "../src/lib/meta/discovery";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const r = await syncIgCompetitors({ brandId: arg("--brand") });
  if (r.skipped) console.log(r.skipped);
  else
    console.log(
      `IG competitors: ${r.synced}/${r.competitors} looked up, ${r.notAvailable} not available, ` +
        `${r.posts} post(s) stored.`,
    );
  for (const e of r.errors) console.log(`  problem: ${e}`);

  if (!process.argv.includes("--no-report")) {
    for (const account of await listIgAccounts()) {
      const report = await weeklyReport(account.id);
      if (!report) continue;
      console.log(`\n@${account.handle} — last 7 days`);
      console.log(
        `  followers ${report.followers.end ?? "—"}, reach ${report.reach ?? "—"}, ` +
          `${report.own.length} post(s) published`,
      );
      for (const p of report.best.slice(0, 3)) {
        console.log(`  best: @${p.handle} ${p.score.toFixed(1)}× ${p.permalink ?? ""}`);
      }
      report.suggestions.forEach((s, i) => console.log(`  next ${i + 1}: ${s.title}`));
    }
  }
  return r.errors.length ? 1 : 0;
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
