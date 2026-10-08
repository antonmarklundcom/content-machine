/**
 * [PR-35] Gallringen, step 1 — screen pending videos on their metadata alone.
 *
 *   npx tsx scripts/screen.ts                 # screen what has never been screened
 *   npx tsx scripts/screen.ts --dry-run       # what it would cost, and what it would save
 *   npx tsx scripts/screen.ts --all           # re-screen, including videos already screened
 *
 * Flags:
 *   --limit N       cap how many videos to screen (default 100)
 *   --model flash   screen with Gemini 3.7 Flash instead of Flash-Lite
 *
 * tsx does NOT auto-load .env — export GEMINI_API_KEY and DATABASE_URL first.
 */

import { closeDb } from "../src/db";
import {
  estimateAnalysisCostUsd,
  formatUsd,
  SpendCapExceededError,
  spendStatus,
} from "../src/lib/spend";
import { DEFAULT_MODEL, UPGRADE_MODEL, type AnalysisModel } from "../src/lib/analysis/pricing";
import { screenInterests, screenMinScore, screeningEnabled } from "../src/lib/screening/policy";
import {
  estimateScreeningBatchUsd,
  findScreenableVideos,
  screenVideos,
  type ScreenResult,
} from "../src/lib/screening/run";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const model: AnalysisModel =
    argv.includes("--model") && argv[argv.indexOf("--model") + 1] === "flash"
      ? UPGRADE_MODEL
      : DEFAULT_MODEL;
  const limit = numericFlag(argv, "--limit", 100);
  const all = argv.includes("--all");
  const minScore = screenMinScore();

  const status = await spendStatus();
  console.log(
    `Spend this month: ${formatUsd(status.projectedUsd)} of ${formatUsd(status.capUsd)} ` +
      `(${formatUsd(status.remainingUsd)} remaining)`,
  );
  console.log(
    `Bar: keep at score >= ${minScore} (SCREEN_MIN_SCORE)` +
      (screeningEnabled() ? "" : "  — SCREENING_ENABLED is off, so the poll run does not screen") +
      (screenInterests() ? "\nScreening against your SCREEN_INTERESTS statement." : "") +
      "\n",
  );

  const subjects = await findScreenableVideos(limit, { includeScreened: all });
  if (subjects.length === 0) {
    console.log(all ? "Nothing pending analysis." : "Nothing new to screen.");
    return;
  }

  const screenEstimate = estimateScreeningBatchUsd(subjects, model);
  console.log(`${subjects.length} video(s) to screen, ~${formatUsd(screenEstimate)}.`);

  if (argv.includes("--dry-run")) {
    // What the gallring is being asked to pay for: PLAN.md §1's reference video
    // at the batch rate, for every video it would let through.
    const analysisIfAll = subjects.length * estimateAnalysisCostUsd(5_000, model, { batch: true });
    console.log(
      `--dry-run:\n  screening these  ~${formatUsd(screenEstimate)}\n` +
        `  analysing all    ~${formatUsd(analysisIfAll)}\n` +
        `  break-even       cull ~${Math.ceil((screenEstimate / analysisIfAll) * 100)}% and it ` +
        `has paid for itself\nNothing screened.`,
    );
    return;
  }

  let run;
  try {
    run = await screenVideos(subjects, { model, onProgress: report(minScore) });
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      console.error(`\nSPEND CAP: ${err.message}`);
      process.exitCode = 3;
      return;
    }
    throw err;
  }

  const kept = run.screened - run.culled;
  console.log(
    `\n${kept} kept · ${run.culled} culled · ${run.failed} failed · ${formatUsd(run.costUsd)}`,
  );
  if (run.failed > 0) {
    console.log("Failed screenings keep their video in the work list — the gallring fails open.");
  }
  const after = await spendStatus();
  console.log(`Spend this month: ${formatUsd(after.projectedUsd)} of ${formatUsd(after.capUsd)}`);
}

function report(minScore: number) {
  return (result: ScreenResult): void => {
    if (result.status === "failed") {
      console.log(`  video ${result.videoId}: FAILED — ${truncate(result.error, 70)}`);
      return;
    }
    const verdict = result.score < minScore ? "cull" : "keep";
    console.log(
      `  video ${result.videoId}: ${String(result.score).padStart(3)} ${verdict}  ` +
        truncate(result.reason, 70),
    );
  };
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
    console.error("\nScreening FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
