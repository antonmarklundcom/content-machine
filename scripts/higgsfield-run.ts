/**
 * Start one Higgsfield run from a terminal and wait for it (build 4 §3.H):
 * the same runner the /higgsfield page uses — a `higgsfield_jobs` row, the
 * logged-in `claude` CLI headless with the Higgsfield MCP, a hard credit
 * ceiling, then a media scan.
 *
 *   tsx --conditions=react-server scripts/higgsfield-run.ts --kind post --target 12 --max-credits 15
 *   … --kind script_shots --target 7 --max-credits 30
 *   … --kind script_thumbnails --target 7
 *   … --kind import [--range "last 50"]
 *   … --kind free --brand guide --description "three 4:5 photos of …" --max-credits 10
 *   … --preflight            only print the readiness checks
 *
 * Runs on Anton's PC only (Claude Code + MEDIA_ROOT). Exits 0 when the run
 * is done, 1 otherwise. Ctrl+C cancels the run.
 */

import { closeDb } from "../src/db";
import { HIGGSFIELD_JOB_KINDS, type HiggsfieldJobKind } from "../src/db/schema";
import { defaultMaxCredits, targetRefFor, TARGETED_KINDS } from "../src/lib/higgsfield/config";
import { refreshPreflight } from "../src/lib/higgsfield/preflight";
import { cancelJob, startJob } from "../src/lib/higgsfield/run";
import { translator } from "../src/lib/i18n";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<number> {
  const t = translator("en");
  if (process.argv.includes("--preflight")) {
    const p = await refreshPreflight();
    for (const c of p.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${t(`higgsfield.check.${c.id}`)} — ${c.detail}`);
      if (c.fix) console.log(`    ${t(`higgsfield.fix.${c.fix}`)}`);
    }
    return p.ok ? 0 : 1;
  }

  const kind = flag("kind") as HiggsfieldJobKind | undefined;
  if (!kind || !HIGGSFIELD_JOB_KINDS.includes(kind)) {
    console.error(`--kind must be one of ${HIGGSFIELD_JOB_KINDS.join(", ")}`);
    return 2;
  }
  const target = flag("target");
  if (TARGETED_KINDS.includes(kind) && !(Number(target) > 0)) {
    console.error(`--target <id> is required for --kind ${kind}`);
    return 2;
  }
  const maxCredits = Number(flag("max-credits") ?? (kind === "import" ? 0 : defaultMaxCredits()));

  const started = await startJob({
    kind,
    targetRef: target ? targetRefFor(kind, Number(target)) : null,
    brandId: flag("brand") ?? null,
    description: flag("description") ?? null,
    range: flag("range") ?? null,
    maxCredits,
  });
  console.log(`Job #${started.job.id} ${started.job.status} (ceiling ${maxCredits} credits)…`);
  process.once("SIGINT", () => {
    console.log("\nCancelling…");
    void cancelJob(started.job.id);
  });

  const job = await started.finished;
  console.log(job.log ?? "");
  console.log(
    `Job #${job.id}: ${job.status}${job.error ? ` — ${job.error}` : ""}. ` +
      `Credits ${job.creditsUsed ?? "?"} / ${job.maxCredits}. Files: ${job.outputPaths.length}.`,
  );
  for (const p of job.outputPaths) console.log(`  ${p}`);
  return job.status === "done" ? 0 : 1;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
