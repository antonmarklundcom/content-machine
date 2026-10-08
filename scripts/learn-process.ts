/**
 * Summarise learn clips (docs/PLAN-build4.md §1.13, docs/LEARN.md): every
 * clip with purpose `learn` and no category yet, oldest first.
 *
 *   npm run learn:process [--limit 20] [--id 42] [--force] [--retry-failed]
 *
 * `--force` re-runs clips that already have a summary; `--retry-failed`
 * includes clips whose last run failed. Each paid call is under the spend cap
 * (or free on AI_PROVIDER=claude-cli / codex-cli; screenshots always use
 * Gemini). A clip held by another run is skipped. Any failed clip exits 1.
 */

import { closeDb } from "../src/db";
import { processLearnClip, processLearnClips, type LearnOutcome } from "../src/lib/learn/process";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function report(o: LearnOutcome): void {
  if (o.status === "done") {
    console.log(`  clip ${o.clipId}: ${o.category} ($${o.costUsd.toFixed(4)})`);
  } else if (o.status === "failed") {
    console.log(`  clip ${o.clipId}: FAILED — ${o.error}`);
  } else {
    console.log(`  clip ${o.clipId}: skipped (${o.reason})`);
  }
}

async function main(): Promise<number> {
  const force = process.argv.includes("--force");
  const id = arg("--id");
  if (id) {
    const outcome = await processLearnClip(Number(id), { force });
    report(outcome);
    return outcome.status === "failed" ? 1 : 0;
  }
  const limit = Number(arg("--limit") ?? 20);
  const result = await processLearnClips({
    limit: Number.isFinite(limit) ? limit : 20,
    force,
    retryFailed: process.argv.includes("--retry-failed"),
    onOutcome: report,
  });
  const done = result.outcomes.filter((o) => o.status === "done").length;
  const failed = result.outcomes.filter((o) => o.status === "failed").length;
  console.log(
    `${result.outcomes.length} learn clip(s): ${done} done, ${failed} failed, $${result.costUsd.toFixed(4)} spent.`,
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
