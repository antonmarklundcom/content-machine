/**
 * Spend report and cap check — the database-backed half of PR-07's done-when.
 *
 *   export DATABASE_URL='postgres://...'
 *   npx tsx scripts/spend.ts                 # month-to-date vs cap
 *   npx tsx scripts/spend.ts --test-cap      # prove the cap trips, then undo it
 *
 * `--test-cap` writes a spend row, confirms the guard refuses work, and rolls
 * the row back. It is the end-to-end proof that the gate fires against real
 * MySQL, not just in unit tests.
 */

import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { spendLog } from "../src/db/schema";
import {
  assertWithinCap,
  formatUsd,
  monthlyCapUsd,
  recordSpend,
  SpendCapExceededError,
  spendStatus,
  utcDay,
  utcMonthRange,
} from "../src/lib/spend";

async function main(): Promise<void> {
  if (process.argv.includes("--test-cap")) return testCap();

  const status = await spendStatus();
  const { start, end } = utcMonthRange();

  console.log(`Month ${start} … ${end} (UTC)`);
  console.log(`  Billed     ${formatUsd(status.monthToDateUsd)}`);
  // Committed is the half of the picture spend_log cannot see (PR-26): batches
  // submitted and not yet collected. It is normally 0 outside a poll window.
  console.log(`  Committed  ${formatUsd(status.committedUsd)}   (open batches, not yet collected)`);
  console.log(
    `  Projected  ${formatUsd(status.projectedUsd)}   (what the cap is measured against)`,
  );
  console.log(`  Cap        ${formatUsd(status.capUsd)}   (MONTHLY_SPEND_CAP_USD)`);
  console.log(`  Remaining  ${formatUsd(status.remainingUsd)}`);
  console.log(`  ${meter(status.fraction)} ${Math.round(status.fraction * 100)}%`);
  if (status.overCap) {
    console.log("\n  OVER CAP — new batches will be refused until the month rolls over");
    console.log("  or MONTHLY_SPEND_CAP_USD is raised.");
  }

  const days = await db
    .select()
    .from(spendLog)
    .where(sql`${spendLog.day} between ${start} and ${end}`)
    .orderBy(spendLog.day);

  if (days.length > 0) {
    console.log("\n  By day:");
    for (const d of days) console.log(`    ${d.day}  ${formatUsd(Number(d.costUsd))}`);
  }
}

/**
 * Push month-to-date just over the cap, confirm the guard refuses, then remove
 * exactly what was added. Uses a decrement rather than a delete so a real
 * spend row for today survives the test intact.
 */
async function testCap(): Promise<void> {
  const cap = monthlyCapUsd();
  const before = await spendStatus();
  console.log(
    `Cap ${formatUsd(cap)}, currently projected ${formatUsd(before.projectedUsd)} ` +
      `(${formatUsd(before.monthToDateUsd)} billed + ${formatUsd(before.committedUsd)} committed)`,
  );

  const nudge = Math.max(0.01, before.remainingUsd + 0.01);
  console.log(`Adding ${formatUsd(nudge)} to today's spend to push over the cap…`);
  await recordSpend(nudge);

  try {
    const during = await spendStatus();
    console.log(`  projected spend is now ${formatUsd(during.projectedUsd)}`);

    let tripped = false;
    try {
      await assertWithinCap(0.01);
    } catch (err) {
      if (!(err instanceof SpendCapExceededError)) throw err;
      tripped = true;
      console.log(`\n  Guard refused, as it should:\n    ${err.message}`);
    }

    if (!tripped) {
      console.error("\n  FAIL — the guard allowed work that exceeds the cap.");
      process.exitCode = 1;
      return;
    }
    console.log("\n  PASS — the cap trips correctly.");
  } finally {
    // Always restore, including if the assertion above threw unexpectedly.
    const day = utcDay();
    await db
      .update(spendLog)
      .set({ costUsd: sql`greatest(0, ${spendLog.costUsd} - ${nudge.toFixed(6)})` })
      .where(eq(spendLog.day, day));
    const after = await spendStatus();
    console.log(`  Restored: billed month-to-date back to ${formatUsd(after.monthToDateUsd)}`);
  }
}

function meter(fraction: number): string {
  const width = 24;
  const filled = Math.min(width, Math.round(Math.max(0, fraction) * width));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
