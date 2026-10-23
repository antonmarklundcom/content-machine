import { test } from "node:test";
import assert from "node:assert/strict";
import { captureReceipt } from "./receipt";

test("a new capture keeps the plain saved receipt", () => {
  assert.deepEqual(captureReceipt({ created: true, clip: { id: 1, purpose: "learn" } }, {}), {
    key: "inbox.quickAdd.saved",
  });
  // Older servers without the flag are treated as before.
  assert.deepEqual(captureReceipt({ clip: { id: 1 } }, {}), { key: "inbox.quickAdd.saved" });
});

test("a duplicate says nothing new was created, with or without a note", () => {
  const dup = { created: false, clip: { id: 4, purpose: "learn" } };
  assert.deepEqual(captureReceipt(dup, { purpose: "learn" }), {
    key: "capture.duplicate.unchanged",
  });
  assert.deepEqual(captureReceipt(dup, { purpose: "learn", note: " idea " }), {
    key: "capture.duplicate.note",
  });
  assert.deepEqual(captureReceipt(dup, { purpose: "learn", note: "   " }), {
    key: "capture.duplicate.unchanged",
  });
});

test("a duplicate stored under another purpose is reported, not silently moved", () => {
  const dup = { created: false, clip: { id: 4, purpose: "other" } };
  assert.deepEqual(captureReceipt(dup, { purpose: "learn" }), {
    key: "capture.duplicate.otherPurpose",
    purpose: "other",
  });
  assert.deepEqual(captureReceipt(dup, { purpose: "learn", note: "x" }), {
    key: "capture.duplicate.otherPurposeNote",
    purpose: "other",
  });
  const learn = { created: false, clip: { id: 5, purpose: "learn" } };
  assert.equal(captureReceipt(learn, {}).key, "capture.duplicate.otherPurpose");
});
