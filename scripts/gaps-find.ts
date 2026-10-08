/**
 * Find content gaps for one brand, or every active brand with something to
 * compare against (build 4 §3.G). Spends one model call per brand, under the
 * monthly cap.
 *
 *   npm run gaps:find [-- --brand <id>] [-- --dry]
 *
 * --dry prints the input counts and the estimate without calling the model.
 */

import { closeDb } from "../src/db";
import { listBrands } from "../src/lib/bridge/brands";
import { estimateGapsCostUsd, findGaps, gatherGapInputs, GapError } from "../src/lib/gaps/find";
import { formatUsd } from "../src/lib/spend";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const only = arg("--brand");
  const dry = process.argv.includes("--dry");
  const brands = (await listBrands()).filter((b) => !only || b.id === only);
  if (only && brands.length === 0) {
    console.error(`No active brand "${only}".`);
    return 1;
  }
  let failed = 0;
  for (const brand of brands) {
    const inputs = await gatherGapInputs(brand.id);
    if (inputs.market.length === 0) {
      if (only)
        console.log(`${brand.id}: nothing to compare yet (no competitors, reports or questions).`);
      continue;
    }
    console.log(
      `${brand.id}: ${inputs.market.length} market input(s), ${inputs.own.length} own; at most ${formatUsd(estimateGapsCostUsd())}.`,
    );
    if (dry) continue;
    try {
      const r = await findGaps(brand.id);
      console.log(
        `  ${r.gaps.length} gap(s), ${r.dropped.length} dropped, cost ${formatUsd(r.costUsd)}:`,
      );
      for (const g of r.gaps) console.log(`  [${g.score}] ${g.topic}`);
    } catch (err) {
      if (!(err instanceof GapError)) throw err;
      failed++;
      console.log(`  problem: ${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
