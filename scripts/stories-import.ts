/**
 * Import cuentos.com.py books into the story studio (build 4 §3.C.2).
 *
 *   npm run stories:import                 every books/<slug>/story.json
 *   npm run stories:import -- tito-salto   one book
 *
 * Reads CUENTOS_ROOT (e.g. C:\dev\cuentos) and never writes there. Re-runnable:
 * stories upsert by slug, scenes by id, in-app approvals are kept unless the
 * repo's status or the text changed. Prints what changed and everything the
 * importer did not understand.
 */
import { closeDb } from "../src/db";
import { CuentosRootError } from "../src/lib/stories/book";
import { importStories } from "../src/lib/stories/import";

async function main(): Promise<number> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const report = await importStories(slug);
  console.log(`CUENTOS_ROOT: ${report.root}`);
  if (!report.results.length) console.log("No books/<slug>/story.json found.");
  let failed = 0;
  for (const r of report.results) {
    if (r.status === "failed") {
      failed++;
      console.log(`✗ ${r.slug}: ${r.error}`);
      continue;
    }
    console.log(`${r.status === "unchanged" ? "·" : "✓"} ${r.slug} — ${r.title} (${r.status})`);
    const list = (label: string, items: string[]) => {
      if (items.length) console.log(`    ${label}: ${items.join(", ")}`);
    };
    list("scenes added", r.scenesAdded);
    list("scenes changed", r.scenesChanged);
    list("scenes removed", r.scenesRemoved);
    list("in-app approvals kept", r.approvalsKept);
    list("in-app approvals dropped", r.approvalsDropped);
    for (const w of r.warnings) console.log(`    ! ${w}`);
    list("files not understood", r.unknownFiles);
  }
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof CuentosRootError ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
