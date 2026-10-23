import assert from "node:assert/strict";
import { test } from "node:test";
import { assertGroundingBudgetPolicy, groundingBudgetMode } from "./grounding-budget";
test("estimated grounding is explicit and strict mode refuses before dispatch", () => {
  assert.equal(groundingBudgetMode({}), "estimated");
  assert.doesNotThrow(() => assertGroundingBudgetPolicy({ GROUNDING_BUDGET_MODE: "estimated" }));
  assert.throws(
    () => assertGroundingBudgetPolicy({ GROUNDING_BUDGET_MODE: "strict" }),
    /cannot be bounded/,
  );
  assert.throws(() => assertGroundingBudgetPolicy({ GROUNDING_BUDGET_MODE: "typo" }), /must be/);
});
