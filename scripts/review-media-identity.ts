/** Explicit local-owner review of one legacy immutable identity; no provider or DB access. */
import "dotenv/config";
import { approveSharedMediaIdentity } from "../src/lib/media/privacy";
import { assertOnPc } from "../src/lib/pc-only";

async function main() {
  assertOnPc("Reviewing legacy shared media");
  const index = process.argv.indexOf("--sha256");
  const sha = index < 0 ? "" : (process.argv[index + 1] ?? "");
  if (!/^[a-f0-9]{64}$/i.test(sha) || !process.argv.includes("--confirm-shared-review"))
    throw new Error(
      "Inspect this exact file locally first, then pass --sha256 <64-hex-identity> --confirm-shared-review. Approval means the bytes are intended for the shared authoring team and potential publication; brand/status are insufficient evidence.",
    );
  await approveSharedMediaIdentity(sha);
  console.log(
    "The reviewed identity is approved for shared-library access. Known private identities remain blocked; no content was published or uploaded.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Media identity review failed.");
  process.exitCode = 1;
});
