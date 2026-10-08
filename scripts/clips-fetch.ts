/**
 * Fetch + transcribe saved reels (PLAN.md §1.44, §6.S17): every clip with
 * purpose `fact_check` or `competitor` that has not been fetched yet — never
 * `inspo`. Runs on Anton's PC, where the media drive and yt-dlp are.
 *
 *   npx tsx --conditions=react-server scripts/clips-fetch.ts [--limit 20] [--id 42] [--retry-failed]
 *
 * (`npm run clips:fetch` once the script line is in package.json — see docs/log/s17.md.)
 *
 * Needs yt-dlp (YTDLP_PATH or PATH; YTDLP_COOKIES_FILE for Instagram), ffmpeg
 * for merging streams and shrinking long reels, TELEGRAM_BOT_TOKEN for files
 * sent to the capture bot, and GEMINI_API_KEY. Each paid call is under the
 * spend cap. An unplugged drive says so and exits 0; any failed clip exits 1.
 */

import { closeDb } from "../src/db";
import { fetchClip, fetchEligibleClips, type FetchOutcome } from "../src/lib/clips/fetch";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function report(o: FetchOutcome): void {
  if (o.status === "done") {
    console.log(
      `  clip ${o.clipId}: ${o.downloaded ? "downloaded, " : ""}transcribed (asset ${o.assetId}, $${o.costUsd.toFixed(4)})`,
    );
  } else if (o.status === "failed") {
    console.log(`  clip ${o.clipId}: FAILED — ${o.error}`);
  } else {
    console.log(`  clip ${o.clipId}: ${o.message}`);
  }
}

async function main(): Promise<number> {
  const id = arg("--id");
  if (id) {
    const outcome = await fetchClip(Number(id));
    report(outcome);
    return outcome.status === "failed" ? 1 : 0;
  }
  const limit = Number(arg("--limit") ?? 20);
  const result = await fetchEligibleClips({
    limit: Number.isFinite(limit) ? limit : 20,
    retryFailed: process.argv.includes("--retry-failed"),
    onOutcome: report,
  });
  const done = result.outcomes.filter((o) => o.status === "done").length;
  const failed = result.outcomes.filter((o) => o.status === "failed").length;
  console.log(
    `${result.outcomes.length} clip(s): ${done} done, ${failed} failed, $${result.costUsd.toFixed(4)} spent.`,
  );
  if (result.stoppedEarly) console.log(`Stopped early: ${result.stoppedEarly}`);
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
