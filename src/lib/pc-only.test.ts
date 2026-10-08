import assert from "node:assert/strict";
import { test } from "node:test";

import { assertOnPc, isOnlineDeploy, PcOnlyError } from "./pc-only";

test("only APP_MODE=online counts as the online deploy", () => {
  assert.equal(isOnlineDeploy({}), false);
  assert.equal(isOnlineDeploy({ APP_MODE: "" }), false);
  assert.equal(isOnlineDeploy({ APP_MODE: "pc" }), false);
  assert.equal(isOnlineDeploy({ APP_MODE: "online" }), true);
  assert.equal(isOnlineDeploy({ APP_MODE: " Online " }), true);
});

test("assertOnPc refuses online with the feature named, passes on the PC", () => {
  assert.doesNotThrow(() => assertOnPc("Voice takes", {}));
  assert.throws(
    () => assertOnPc("Voice takes", { APP_MODE: "online" }),
    (err: unknown) => err instanceof PcOnlyError && /^Voice takes runs on the PC/.test(err.message),
  );
});
