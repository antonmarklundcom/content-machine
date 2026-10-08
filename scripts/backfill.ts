/**
 * Analyse everything pending, or collect a batch submitted earlier.
 *
 *   npx tsx scripts/backfill.ts                    # batch path (50% cheaper)
 *   npx tsx scripts/backfill.ts --interactive      # one at a time, full price
 *   npx tsx scripts/backfill.ts --collect <batch_id>
 *   npx tsx scripts/backfill.ts --dry-run
 *
 * Flags:
 *   --limit N      cap how many videos to process (default 100)
 *   --model flash  use Gemini 3.7 Flash instead of Flash-Lite
 */

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { transcripts } from "../src/db/schema";
import {
  awaitBatch,
  collectBatchResults,
  submitAnalysisBatch,
  type BatchOutcome,
} from "../src/lib/analysis/batch";
import { analyzeVideo, findPendingVideos } from "../src/lib/analysis/run";
import { DEFAULT_MODEL, UPGRADE_MODEL, type AnalysisModel } from "../src/lib/analysis/pricing";
import {
  estimateAnalysisCostUsd,
  estimateBatchCostUsd,
  formatUsd,
  SpendCapExceededError,
  spendStatus,
  withSpendCap,
} from "../src/lib/spend";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const modelGiven = argv.includes("--model");
  const model: AnalysisModel =
    argv[argv.indexOf("--model") + 1] === "flash" && modelGiven ? UPGRADE_MODEL : DEFAULT_MODEL;

  const collectIdx = argv.indexOf("--collect");
  if (collectIdx !== -1) {
    const batchId = argv[collectIdx + 1];
    if (!batchId) {
      console.error("--collect requires a batch id");
      process.exit(2);
    }
    // Without an explicit --model, price the results against the model the
    // batch was submitted with (read from `batches`) rather than the default —
    // collecting a Sonnet batch as Haiku would understate the spend counter.
    return collect(batchId, modelGiven ? model : undefined);
  }

  const status = await spendStatus();
  console.log(
    `Spend this month: ${formatUsd(status.projectedUsd)} of ${formatUsd(status.capUsd)} ` +
      `(${formatUsd(status.remainingUsd)} remaining)\n`,
  );

  const limit = numericFlag(argv, "--limit", 100);
  const pending = await findPendingVideos(limit);

  if (pending.length === 0) {
    console.log("Nothing pending analysis.");
    return;
  }
  console.log(`${pending.length} video(s) pending.`);

  if (argv.includes("--dry-run")) {
    const batchEstimate = estimateBatchCostUsd(
      pending.map(() => 5_000),
      model,
      { batch: true },
    );
    const liveEstimate = batchEstimate * 2;
    console.log(
      `--dry-run:\n  batch path       ~${formatUsd(batchEstimate)}\n` +
        `  interactive path ~${formatUsd(liveEstimate)}\n` +
        `  remaining budget  ${formatUsd(status.remainingUsd)}\nNothing submitted.`,
    );
    return;
  }

  if (argv.includes("--interactive")) {
    // Full price, but results land immediately. Worth it for a handful of
    // videos you actually want to read now.
    let spent = 0;
    const counts = { ok: 0, failed: 0, skipped: 0 };
    for (const [i, video] of pending.entries()) {
      const [transcript] = await db
        .select({ wordCount: transcripts.wordCount })
        .from(transcripts)
        .where(eq(transcripts.videoId, video.id))
        .limit(1);
      const result = await withSpendCap(
        estimateAnalysisCostUsd(transcript?.wordCount ?? 0, model),
        () => analyzeVideo(video, { model }),
      );
      if (result.status === "skipped") {
        counts.skipped += 1;
      } else {
        spent += result.costUsd;
        counts[result.status] += 1;
      }
      console.log(
        `  [${i + 1}/${pending.length}] ${result.status.padEnd(8)} ${truncate(video.title, 50)}`,
      );
    }
    console.log(
      `\n${counts.ok} ok · ${counts.failed} failed · ${counts.skipped} skipped · ` +
        `${formatUsd(spent)}`,
    );
    return;
  }

  let submission;
  try {
    submission = await submitAnalysisBatch(pending, { model });
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      console.error(`\nSPEND CAP: ${err.message}`);
      process.exitCode = 3;
      return;
    }
    throw err;
  }

  if (!submission) {
    console.log("No videos had a usable transcript; nothing submitted.");
    return;
  }

  console.log(
    `Submitted batch ${submission.batchId} — ${submission.videoIds.length} video(s), ` +
      `estimated ${formatUsd(submission.estimatedUsd)}.`,
  );
  console.log("Waiting for it to finish…");

  const finished = await awaitBatch(submission.batchId, {
    onPoll: (s) => console.log(`  status: ${s}`),
  });
  if (!finished) {
    console.log(
      `Not finished within the timeout. Collect later:\n` +
        `  npx tsx scripts/backfill.ts --collect ${submission.batchId}`,
    );
    return;
  }

  await report(await collectBatchResults(submission.batchId, { model }));
}

async function collect(batchId: string, model?: AnalysisModel): Promise<void> {
  console.log(`Collecting batch ${batchId}…`);
  await report(await collectBatchResults(batchId, model ? { model } : {}));
}

async function report(outcome: BatchOutcome): Promise<void> {
  console.log(
    `\n${outcome.succeeded} ok · ${outcome.failed} failed · ${outcome.expired} expired` +
      // Only worth a word when it happened: a non-zero count means this batch
      // was collected before and the earlier rows were left alone (PR-32).
      (outcome.alreadyWritten > 0 ? ` · ${outcome.alreadyWritten} already written` : ""),
  );
  console.log(`Actual cost: ${formatUsd(outcome.actualUsd)}`);
  const status = await spendStatus();
  console.log(`Spend this month: ${formatUsd(status.projectedUsd)} of ${formatUsd(status.capUsd)}`);
}

function numericFlag(argv: string[], flag: string, fallback: number): number {
  const idx = argv.indexOf(flag);
  if (idx === -1) return fallback;
  return Number(argv[idx + 1]) || fallback;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("\nBackfill FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
