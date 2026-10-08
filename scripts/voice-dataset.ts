/**
 * Export a training dataset from approved manual takes (docs/DATASET.md):
 *
 *   npm run voice:dataset -- --profile narrador-gn --lang gn [--include-unreviewed] [--min 1 --max 15] [--dry-run]
 *   (until the script is added to package.json:
 *    npx tsx --conditions=react-server scripts/voice-dataset.ts …)
 *
 * Writes MEDIA_ROOT/voice/_datasets/<profile>-<lang>-<YYYYMMDD-HHmm>/. Nothing
 * is uploaded. Exits 1 on a refusal (consent, no clips), 2 on bad arguments.
 */

import { parseArgs } from "node:util";

import { closeDb } from "../src/db";
import { exportDataset } from "../src/lib/voice/dataset/export";

const USAGE =
  "Usage: voice-dataset --profile <key> --lang <code> [--include-unreviewed] [--include-tts] [--min 1 --max 15] [--dry-run]";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      profile: { type: "string" },
      lang: { type: "string" },
      "include-unreviewed": { type: "boolean", default: false },
      "include-tts": { type: "boolean", default: false },
      min: { type: "string" },
      max: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.profile || !values.lang) {
    console.error(USAGE);
    return 2;
  }
  const minSec = values.min !== undefined ? Number(values.min) : undefined;
  const maxSec = values.max !== undefined ? Number(values.max) : undefined;
  try {
    const s = await exportDataset({
      profileKey: values.profile,
      language: values.lang,
      includeUnreviewed: values["include-unreviewed"],
      includeTts: values["include-tts"],
      minSec,
      maxSec,
      dryRun: values["dry-run"],
    });
    console.log(
      `${s.dryRun ? "Dry run" : "Exported"}: ${s.clips} clips, ${(s.totalSeconds / 60).toFixed(1)} min` +
        (s.absoluteFolder ? ` → ${s.absoluteFolder}` : ""),
    );
    for (const e of s.excluded) {
      console.log(
        `  left out take ${e.id}: ${e.reason}${e.durationMs !== null ? ` (${(e.durationMs / 1000).toFixed(1)} s)` : ""}`,
      );
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
