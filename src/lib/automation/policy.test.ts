import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTOMATION_FEATURES,
  DEFAULT_AUTOMATION_POLICY,
  automationAllowed,
  parseAutomationPolicy,
} from "./policy";
test("missing and malformed preferences cannot enable automatic work", () => {
  for (const raw of [undefined, null, [], "true", { enabled: "true", captureAnalysis: 1 }]) {
    assert.deepEqual(parseAutomationPolicy(raw), DEFAULT_AUTOMATION_POLICY);
  }
});
test("global pause overrides enabled individual tasks and switches remain independent", () => {
  const policy = parseAutomationPolicy({ enabled: true, captureAnalysis: true });
  assert.equal(automationAllowed(policy, "captureAnalysis"), true);
  assert.equal(automationAllowed(policy, "publishing"), false);
  for (const feature of AUTOMATION_FEATURES)
    assert.equal(automationAllowed({ ...policy, enabled: false, [feature]: true }, feature), false);
});
