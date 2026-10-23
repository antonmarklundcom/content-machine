#!/usr/bin/env node
/**
 * Read-only check that a restored MEDIA_ROOT copy matches its source, byte for
 * byte, including both private/shared identity marker folders.
 *
 *   node scripts/verify-media-restore.mjs SOURCE_MEDIA_ROOT RESTORED_COPY [--json]
 *
 * Use it in an isolated restore rehearsal. It never writes, deletes or follows
 * links, and private areas are reported only as counts. A pass proves these two
 * folders match; it does not prove the backup is independent, retained or
 * restorable on the host. Pair it with the matched database dump and key check.
 */
import path from "node:path";
import { compareMediaTrees } from "./lib/media-restore.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const [source, restored] = args.filter((a) => a !== "--json");
if (!source || !restored || !path.isAbsolute(source) || !path.isAbsolute(restored)) {
  console.error(
    "Usage: node scripts/verify-media-restore.mjs ABSOLUTE_SOURCE ABSOLUTE_RESTORED [--json]",
  );
  process.exit(2);
}
if (path.resolve(source) === path.resolve(restored)) {
  console.error("Source and restored copy must be different folders.");
  process.exit(2);
}

const result = await compareMediaTrees(source, restored);
if (json) console.log(JSON.stringify(result, null, 2));
else {
  for (const [area, a] of Object.entries(result.areas)) {
    console.log(
      `${area.padEnd(28)} source ${a.source}  restored ${a.restored}  missing ${a.missing}  changed ${a.changed}  extra ${a.extra}`,
    );
    for (const example of a.examples) console.log(`    ${example}`);
  }
  console.log(
    result.identical
      ? "PASS: restored media matches the source, including identity markers."
      : `FAIL:\n- ${result.problems.join("\n- ")}`,
  );
}
process.exit(result.identical ? 0 : 1);
