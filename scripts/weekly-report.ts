/**
 * Weekly competitor report (build 2b, idea 1): one report per active brand
 * that has linked competitor or inspiration channels, over the last 7 days.
 *
 *   npm run studio:weekly               # every brand with competitors
 *   npm run studio:weekly -- --days 14  # a wider window
 *   npm run studio:weekly -- --brand pozo
 *
 * A brand with nothing above its channels' medians in the window gets no
 * report (and costs nothing). Writing runs on `AI_PROVIDER` (§1.38): Gemini
 * under the spend cap, or the logged-in Claude/Codex CLI at $0.
 *
 * Scheduled on Anton's PC by Windows Task Scheduler, Monday 08:00 (§1.27):
 *   schtasks /Create /SC WEEKLY /D MON /ST 08:00 /TN "content-engine weekly report"
 *     /TR "cmd /c cd /d C:\path\to\content-engine && npm run studio:weekly >> logs\weekly.log 2>&1"
 * Run it after `npm run yt:poll` so the week's videos have view counts.
 * Exits 1 if any brand failed, so the scheduler's history shows it.
 */

import { closeDb } from "../src/db";
import { brandIdsWithCompetitors } from "../src/lib/bridge/reports";
import { formatUsd } from "../src/lib/spend";
import { buildCompetitorReport } from "../src/lib/studio/report";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const days = Number(flag(argv, "--days") ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    console.error(`--days must be a whole number from 1 to 365, got "${flag(argv, "--days")}".`);
    return 2;
  }
  const only = flag(argv, "--brand");
  const brandIds = only ? [only] : await brandIdsWithCompetitors();
  if (brandIds.length === 0) {
    console.log(
      "No brand has competitor channels yet. Link some on /research, then run this again.",
    );
    return 0;
  }

  console.log(`Competitor reports, last ${days} days, for ${brandIds.length} brand(s)…\n`);
  let failed = 0;
  let spent = 0;
  for (const brandId of brandIds) {
    try {
      const result = await buildCompetitorReport(brandId, days);
      if (result.ok) {
        const { body, costUsd, id } = result.report;
        spent += costUsd;
        console.log(
          `  ${brandId.padEnd(20)} report #${id}: ${body.winners.length} winners, ${body.ideas.length} ideas, ${formatUsd(costUsd)}`,
        );
      } else {
        if (result.reason === "no_brand") failed += 1;
        console.log(`  ${brandId.padEnd(20)} ${result.message}`);
      }
    } catch (err) {
      failed += 1;
      console.error(
        `  ${brandId.padEnd(20)} FAILED — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(`\nDone. Spent ${formatUsd(spent)}.${failed ? ` ${failed} brand(s) failed.` : ""}`);
  return failed ? 1 : 0;
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
