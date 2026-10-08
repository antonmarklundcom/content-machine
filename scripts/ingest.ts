/**
 * PR-05 done-when: "a playlist ingests, mixed available/none".
 *
 *   export DATABASE_URL='postgres://...'
 *   export YOUTUBE_API_KEY='...'
 *   npx tsx scripts/ingest.ts 'https://www.youtube.com/playlist?list=PL...' --limit 20
 *
 * Flags:
 *   --limit N        cap videos taken from a playlist/channel (default 25)
 *   --skip-captions  store metadata only; run captions later with backfill.ts
 *   --force          re-fetch captions even where a transcript exists
 *   --retry-none     re-probe videos previously marked 'none' (see below)
 */

import { closeDb } from "../src/db";
import { ingestUrl, type IngestProgress } from "../src/lib/ingest";
import { summariseHealth } from "../src/lib/youtube/captions";
import { QuotaExhaustedError } from "../src/lib/youtube/quota";

const DEFAULT_LIMIT = 25;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;
  const input = argv.find((a, i) => !a.startsWith("--") && i !== limitIdx + 1);

  if (!input) {
    console.error(
      "Usage: npx tsx scripts/ingest.ts <youtube-url> [--limit N] [--skip-captions] [--force] [--retry-none]",
    );
    process.exit(2);
  }

  const summary = await ingestUrl(input, {
    limit,
    skipCaptions: argv.includes("--skip-captions"),
    force: argv.includes("--force"),
    retryNone: argv.includes("--retry-none"),
    onProgress: printProgress,
  });

  const { captionCounts: c } = summary;
  console.log("\n" + "-".repeat(62));
  console.log(`Videos stored: ${summary.videos.length}`);
  console.log(
    `Captions:      ${c.available} available · ${c.none} none · ${c.failed} failed · ${c.skipped} skipped`,
  );
  console.log(`Quota:         ${summary.quota}`);

  const health = summariseHealth(summary.captionHealth);
  if (health) console.log(`Strategies:    ${health}`);

  const retired = summary.captionHealth.filter((s) => s.retired);
  if (retired.length > 0) {
    console.log(
      `\n${retired.length} strateg${retired.length === 1 ? "y was" : "ies were"} retired for the ` +
        "rest of this run after repeated failures.\nThat is the adaptive saving working, not an " +
        "error — but if the list keeps growing\nrun `npm run yt:probe-captions` and read " +
        "docs/CAPTION-FETCH-RESILIENCE.md.",
    );
  }

  if (c.failed > 0 && c.available === 0 && c.none === 0) {
    console.log(
      "\nEverything failed and nothing succeeded. That is the PR-01 failure mode,\n" +
        "not a per-video problem — re-run `npm run yt:probe-captions` before treating\n" +
        "this as data. Do NOT fall back to AI audio transcription (PLAN.md §6).",
    );
  }
  if (c.none > 0) {
    console.log(
      `\n${c.none} video(s) have no captions and are now permanently skipped.\n` +
        "That is by design (PLAN.md §0). Pass --retry-none only if you believe a\n" +
        "block was misreported as 'no captions'.",
    );
  }
}

function printProgress(event: IngestProgress): void {
  switch (event.phase) {
    case "resolved":
      console.log(`Resolved ${event.description}`);
      break;
    case "listed":
      console.log(`Listed ${event.count} video id(s). Fetching metadata…\n`);
      break;
    case "stored":
      console.log(
        `  [${event.index + 1}/${event.total}] stored  ${truncate(event.video.title, 58)}`,
      );
      break;
    case "captions": {
      const o = event.outcome;
      const detail =
        o.status === "available"
          ? `${o.wordCount} words via ${o.strategy} (${o.language})`
          : o.status === "failed"
            ? o.error
            : o.status === "skipped"
              ? o.why
              : "no captions on this video";
      console.log(
        `  [${event.index + 1}/${event.total}] ${o.status.padEnd(9)} ${truncate(event.video.title, 40)} — ${detail}`,
      );
      break;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    if (err instanceof QuotaExhaustedError) console.error(`\n${err.message}`);
    else console.error("\nIngest FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
