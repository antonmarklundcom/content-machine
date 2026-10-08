/**
 * PR-06 done-when: "one video produces a stored analysis".
 *
 *   export DATABASE_URL='postgres://...'
 *   export GEMINI_API_KEY='...'
 *   npx tsx scripts/analyze.ts <youtube-url-or-id>   # one video
 *   npx tsx scripts/analyze.ts --pending [--limit N] # everything not yet analysed
 *
 * Flags:
 *   --model flash    use Gemini 3.7 Flash instead of the Flash-Lite default
 *   --force          re-analyse even if a successful analysis exists
 *   --show           print the analysis
 */

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { transcripts, videos, type Video } from "../src/db/schema";
import { analyzeVideo, findPendingVideos } from "../src/lib/analysis/run";
import {
  DEFAULT_MODEL,
  MODEL_RATES,
  UPGRADE_MODEL,
  type AnalysisModel,
} from "../src/lib/analysis/pricing";
import type { AnalysisPayload } from "../src/lib/analysis/contract";
import { parseVideoId } from "../src/lib/youtube/url";
import { estimateAnalysisCostUsd, withSpendCap } from "../src/lib/spend";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const model: AnalysisModel =
    argv.includes("--model") && argv[argv.indexOf("--model") + 1] === "flash"
      ? UPGRADE_MODEL
      : DEFAULT_MODEL;
  const force = argv.includes("--force");
  const show = argv.includes("--show");

  const targets = argv.includes("--pending")
    ? await findPendingVideos(numericFlag(argv, "--limit", 10))
    : await resolveOne(argv);

  if (targets.length === 0) {
    console.log("Nothing to analyse.");
    return;
  }

  console.log(`Analysing ${targets.length} video(s) with ${model}\n`);

  let totalCost = 0;
  const counts = { ok: 0, failed: 0, skipped: 0 };

  for (const [i, video] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${truncate(video.title, 52)}`;
    const [transcript] = await db
      .select({ wordCount: transcripts.wordCount })
      .from(transcripts)
      .where(eq(transcripts.videoId, video.id))
      .limit(1);
    const result = await withSpendCap(
      estimateAnalysisCostUsd(transcript?.wordCount ?? 0, model),
      () => analyzeVideo(video, { model, force }),
    );

    if (result.status === "skipped") {
      counts.skipped += 1;
      console.log(`${label}\n    skipped — ${result.why}`);
      continue;
    }

    totalCost += result.costUsd;
    const a = result.analysis;
    const cacheNote =
      a.cacheWriteTokens > 0 || a.cacheReadTokens > 0
        ? `, cache w${a.cacheWriteTokens}/r${a.cacheReadTokens}`
        : ", cache inactive";

    if (result.status === "ok") {
      counts.ok += 1;
      console.log(
        `${label}\n    ok — $${result.costUsd.toFixed(4)} ` +
          `(in ${a.inputTokens}, out ${a.outputTokens}${cacheNote})`,
      );
      if (show) printAnalysis(result.payload);
    } else {
      counts.failed += 1;
      console.log(`${label}\n    FAILED — ${result.error} ($${result.costUsd.toFixed(4)})`);
    }
  }

  console.log("\n" + "-".repeat(62));
  console.log(`${counts.ok} ok · ${counts.failed} failed · ${counts.skipped} skipped`);
  console.log(`Spend this run: $${totalCost.toFixed(4)}`);
  if (counts.ok > 0) {
    console.log(`Average per analysed video: $${(totalCost / counts.ok).toFixed(4)}`);
    console.log(
      `PLAN.md §1 budgets ~$0.02/video on Haiku 4.5 — compare, and if this run is\n` +
        `far above it, check transcript lengths before scaling up.`,
    );
  }
  if (counts.ok > 0 && MODEL_RATES[model].cacheMinimumTokens > 0) {
    console.log(
      `\nCache note: ${model} needs a system prompt over ` +
        `${MODEL_RATES[model].cacheMinimumTokens} tokens before caching engages. ` +
        `"cache inactive" above means PLAN.md §1.4's saving is not applying.`,
    );
  }
}

async function resolveOne(argv: string[]): Promise<Video[]> {
  const input = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (!input) {
    console.error("Usage: npx tsx scripts/analyze.ts <youtube-url-or-id> | --pending [--limit N]");
    process.exit(2);
  }
  const youtubeId = parseVideoId(input);
  if (!youtubeId) {
    console.error(`Could not parse a video ID from: ${input}`);
    process.exit(2);
  }
  const [video] = await db.select().from(videos).where(eq(videos.youtubeId, youtubeId)).limit(1);
  if (!video) {
    console.error(`Video ${youtubeId} is not in the database. Ingest it first:`);
    console.error(`  npm run ingest 'https://www.youtube.com/watch?v=${youtubeId}'`);
    process.exit(1);
  }
  return [video];
}

function printAnalysis(a: AnalysisPayload): void {
  const line = "    " + "·".repeat(56);
  console.log(line);
  console.log(`    SUMMARY\n${indent(a.summary)}`);
  if (a.takeaways.length) {
    console.log(`\n    TAKEAWAYS`);
    for (const t of a.takeaways) console.log(indent(`- ${t}`));
  }
  console.log(`\n    HOOK — ${a.hook.technique}\n${indent(a.hook.why_it_works)}`);
  if (a.timeline.length) {
    console.log(`\n    TIMELINE`);
    for (const t of a.timeline) console.log(`      ${t.ts.padEnd(8)} ${t.topic} — ${t.beat}`);
  }
  if (a.gaps.length) {
    console.log(`\n    GAPS`);
    for (const g of a.gaps) console.log(indent(`- ${g.gap}\n  -> ${g.counter_angle}`));
  }
  if (a.ideas.length) {
    console.log(`\n    IDEAS`);
    for (const i of a.ideas) console.log(indent(`- ${i.title}: ${i.premise} (${i.why_now})`));
  }
  console.log(line);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");
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
    console.error("\nAnalysis FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
