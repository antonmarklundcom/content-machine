/**
 * Import a family's shared facts from a source file (PLAN.md §1.48, §6.S18).
 *
 *   npm run facts:import -- --family paraguay-residency \
 *     --source https://raw.githubusercontent.com/antonmarklundcom/paraguayresidency/main/content/shared/facts.ts
 *   npm run facts:import -- --family paraguay-residency --source ..\paraguayresidency\content\shared\facts.ts
 *
 * `--source` is a path or an http(s) URL (a private repo's raw URL needs a
 * `?token=` link from GitHub's "Raw" button). `--dry-run` parses and counts
 * without writing. Re-runnable: rows are upserted by (family, key, language);
 * nothing is deleted. Same import as the "Import facts" button on /facts.
 */

import { readFile } from "node:fs/promises";
import { closeDb } from "../src/db";
import { fetchFactsSource, FactsImportError, importFacts } from "../src/lib/facts/import";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const family = arg("family");
  const source = arg("source");
  const dryRun = process.argv.includes("--dry-run");
  if (!family || !source) {
    console.error("Usage: npm run facts:import -- --family <id> --source <path|url> [--dry-run]");
    return 2;
  }
  const text = /^https?:\/\//i.test(source)
    ? await fetchFactsSource(source)
    : await readFile(source, "utf8");
  const r = await importFacts(family, text, { dryRun });
  console.log(
    dryRun
      ? `Dry run: ${r.keys} facts → ${r.rows} rows for family "${family}". Nothing written.`
      : `Family "${family}": ${r.keys} facts, ${r.rows} rows — ${r.inserted} new, ` +
          `${r.updated} updated, ${r.unchanged} unchanged.`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof FactsImportError ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
