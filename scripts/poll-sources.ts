/**
 * Nightly/hourly poller. Finds new uploads on tracked sources, fetches their
 * captions, and submits the analysis work as a Batch API job (PLAN.md §1.2 —
 * nobody is waiting on this, so accept latency for a flat 50% discount).
 *
 *   export DATABASE_URL='postgres://...' YOUTUBE_API_KEY='...' GEMINI_API_KEY='...'
 *   npx tsx scripts/poll-sources.ts
 *
 * The logic lives in src/lib/poll.ts so that /api/cron/poll — which is what
 * actually runs this on Hostinger — can call it in-process. This script is the
 * same run with a terminal attached.
 *
 * Flags:
 *   --limit N        newest N videos per source (default 10)
 *   --no-analyze     ingest only; leave analysis to the backfill
 *   --wait           block until the batch finishes and write the results
 *   --dry-run        report what would be spent, submit nothing
 *   --no-screen      skip the PR-35 gallring for this run
 *
 * Takes the same `poll` lease as /api/cron/poll (PLAN.md §1.19): if another run
 * holds it, this prints "already running" and exits 0 — the scheduler's next
 * hourly run is the retry, so it is not a failure. Scheduled on Anton's PC by
 * Windows Task Scheduler (docs/log/o6.md), not by Vercel Cron (§1.27).
 */

import { closeDb } from "../src/db";
import { STALE_BATCH_HOURS } from "../src/lib/analysis/batch";
import { POLL_LEASE, POLL_LEASE_TTL_MS, withLease } from "../src/lib/lease";
import { pollSources } from "../src/lib/poll";
import { formatUsd } from "../src/lib/spend";
import { summariseHealth } from "../src/lib/youtube/captions";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // --wait blocks on the batch for up to awaitBatch's own 30 minutes on top of
  // the ingest, so the default TTL could lapse mid-run and let the next hourly
  // run take the lease over. Two hours covers both with room to spare.
  const ttlMs = argv.includes("--wait") ? 2 * 60 * 60 * 1000 : POLL_LEASE_TTL_MS;
  const run = await withLease(POLL_LEASE, ttlMs, () =>
    pollSources({
      limit: numericFlag(argv, "--limit", 10),
      analyze: !argv.includes("--no-analyze"),
      dryRun: argv.includes("--dry-run"),
      wait: argv.includes("--wait"),
      screen: argv.includes("--no-screen") ? false : undefined,
      onProgress: (event) => {
        switch (event.phase) {
          case "sources":
            console.log(
              event.count === 0
                ? "No active sources. Add one with `npm run ingest '<channel or playlist url>'`."
                : `Polling ${event.count} source(s)…\n`,
            );
            break;
          case "source": {
            const r = event.result;
            const name = truncate(r.title, 40).padEnd(40);
            if (r.error) {
              console.error(`  ${name} FAILED — ${r.error}`);
            } else {
              console.log(
                `  ${name} ${r.videos} video(s) · ${r.captions.available} captions · ` +
                  `${r.captions.none} none · ${r.captions.failed} failed · ${r.captions.skipped} skipped`,
              );
            }
            break;
          }
          case "quota-exhausted":
            console.error(`\n${event.message}`);
            console.error("Stopping the poll — remaining sources are picked up next run.");
            break;
          case "collected":
            console.log(
              `\nCollected batch ${event.batchId}: ${event.outcome.succeeded} ok · ` +
                `${event.outcome.failed} failed · ${event.outcome.expired} expired · ` +
                (event.outcome.alreadyWritten > 0
                  ? `${event.outcome.alreadyWritten} already written · `
                  : "") +
                `actual ${formatUsd(event.outcome.actualUsd)}`,
            );
            break;
          case "batch-abandoned":
            console.error(
              `\nGave up on batch ${event.batchId} — unreadable for over ` +
                `${STALE_BATCH_HOURS}h (${event.message}). Its estimate ` +
                `${formatUsd(event.estimatedUsd)} was written to the spend log, since the ` +
                `provider almost certainly charged for it.`,
            );
            break;
          case "screening":
            console.log(`\nScreening ${event.count} video(s) on metadata…`);
            break;
          case "screened": {
            const r = event.result;
            console.log(
              `  ${r.screened - r.culled} kept · ${r.culled} culled · ${r.failed} failed · ` +
                `${formatUsd(r.costUsd)} (bar: ${r.minScore})`,
            );
            break;
          }
          case "pending":
            console.log(`\n${event.count} video(s) pending analysis.`);
            break;
          case "submitted":
            console.log(
              `Submitted batch ${event.batchId} — ${event.videoCount} video(s), ` +
                `estimated ${formatUsd(event.estimatedUsd)}.`,
            );
            break;
          case "batch-status":
            console.log(`  status: ${event.status}`);
            break;
        }
      },
    }),
  );

  if (!run.acquired) {
    console.log("A poll is already running (the `poll` lease is held) — skipping this run.");
    return;
  }
  const result = run.value;

  if (result.reapedClips > 0) {
    console.log(
      `\nFailed ${result.reapedClips} clip(s) stuck in ingesting for over 15 minutes — ` +
        "retry them from the inbox.",
    );
  }

  const health = summariseHealth(result.captionHealth);
  if (health) {
    console.log(`\nCaption strategies: ${health}`);
    if (result.captionHealth.every((s) => s.retired)) {
      console.log(
        "Every caption strategy was retired this run — nothing reached YouTube.\n" +
          "Run `npm run yt:probe-captions` from this host and read\n" +
          "docs/CAPTION-FETCH-RESILIENCE.md before the next poll.",
      );
    }
  }

  const { before, after } = result.spend;
  console.log(
    `\nSpend this month: ${formatUsd(after.projectedUsd)} of ${formatUsd(after.capUsd)} ` +
      `(${Math.round(after.fraction * 100)}%, +${formatUsd(after.projectedUsd - before.projectedUsd)} this run` +
      `${after.committedUsd > 0 ? `, ${formatUsd(after.committedUsd)} committed to open batches` : ""})`,
  );

  if (result.skipped) {
    console.log(`No batch submitted — ${result.skipped.reason}: ${result.skipped.detail}`);
    if (result.skipped.estimatedUsd !== undefined) {
      console.log(`--dry-run estimate: ${formatUsd(result.skipped.estimatedUsd)}`);
    }
    // Exit 3 so a cron wrapper can distinguish "hit the cap" (expected, and
    // arguably working as designed) from "crashed" (needs attention).
    if (result.skipped.reason === "spend-cap") process.exitCode = 3;
  } else if (result.submitted && !result.waited) {
    console.log(
      `Results are collected by the next poll run, or now with:\n` +
        `  npx tsx scripts/backfill.ts --collect ${result.submitted.batchId}`,
    );
  } else if (result.waited && !result.waited.finished) {
    console.log(
      `Batch did not finish within the timeout. Collect it later:\n` +
        `  npx tsx scripts/backfill.ts --collect ${result.waited.batchId}`,
    );
  }
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
    console.error("\nPoll FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
