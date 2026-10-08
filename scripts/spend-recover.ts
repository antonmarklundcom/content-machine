/** Owner-only local reconciliation. Check provider charges before choosing actualUsd. */
import { closeDb } from "../src/db";
import { listUncertainSpendHolds, reconcileSpendHold } from "../src/lib/spend";
import { isOnlineDeploy } from "../src/lib/pc-only";

async function main() {
  if (isOnlineDeploy()) throw new Error("Budget recovery is a local operator command.");
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 4 || args[0] !== "--id" || args[2] !== "--actual-usd")
      throw new Error(
        "Usage: npm run spend:recover -- --id <hold UUID> --actual-usd <amount verified with provider; 0 if uncharged/already billed>",
      );
    await reconcileSpendHold(args[1], Number(args[3]));
    console.log("Hold reconciled; no provider requests made.");
  }
  const holds = await listUncertainSpendHolds();
  console.log(
    JSON.stringify(
      holds.map((h) => ({
        id: h.id,
        estimatedUsd: h.estimatedUsd,
        createdAt: h.createdAt,
        accountedDay: h.accountedDay,
      })),
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
