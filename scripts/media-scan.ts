/**
 * Register everything under MEDIA_ROOT as media library assets (PLAN.md
 * §1.45, §5.O10.4): every `manifest.json` entry the Higgsfield commands wrote,
 * then every loose file.
 *
 *   npm run media:scan
 *
 * Idempotent (sha256): safe to run as often as you like. A file already
 * registered at the same path with the same size is not hashed again, so an
 * hourly run over a full drive stays cheap. Scheduled on Anton's PC by
 * Windows Task Scheduler, hourly:
 *   schtasks /Create /SC HOURLY /TN "content-engine media scan"
 *     /TR "cmd /c cd /d C:\path\to\content-engine && npm run media:scan >> logs\media-scan.log 2>&1"
 *
 * An unplugged media drive is a normal state: it says so and exits 0.
 * Exits 1 when any file failed, so the scheduler's history shows it.
 */

import { closeDb } from "../src/db";
import { scanMediaRoot } from "../src/lib/media/scan";
import { mediaRoot } from "../src/lib/storage/root";

async function main(): Promise<number> {
  const started = Date.now();
  console.log(`Scanning ${mediaRoot()} …`);
  const result = await scanMediaRoot();
  if (result.status === "missing") {
    console.log(result.message);
    return 0;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${result.manifests} manifest(s); ${result.created} new, ${result.existing} already registered ` +
      `(${result.updated} updated), ${result.skipped} skipped, ${result.errors.length} error(s) in ${seconds}s.`,
  );
  for (const e of result.errors) console.error(`  ${e.path}: ${e.message}`);
  return result.errors.length ? 1 : 0;
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
