/**
 * Publish every scheduled post whose time has come (PLAN.md §5.O13). Run it
 * every 5 minutes (Task Scheduler locally; `/api/cron/publish` online — both
 * take the same lease, so they never publish the same post twice).
 *
 *   npm run publish:due [-- --limit 10]
 *
 * Exits 0 when nothing failed, 1 when a post failed. Never prints a token.
 */

import { closeDb } from "../src/db";
import { publishDue, summarizeDue } from "../src/lib/publish";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const limit = Number(arg("--limit") ?? 10);
  const report = await publishDue({ limit: Number.isInteger(limit) && limit > 0 ? limit : 10 });
  console.log(`Publish: ${summarizeDue(report)}.`);
  for (const o of report.outcomes) {
    if (o.result === "skipped") continue;
    console.log(
      `  post ${o.postId}: ${o.result}${o.permalink ? ` ${o.permalink}` : ""}${o.message ? ` — ${o.message}` : ""}`,
    );
  }
  return report.outcomes.some((o) => o.result === "failed") ? 1 : 0;
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
