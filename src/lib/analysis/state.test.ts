import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisState } from "./state";

test("a stored analysis decides the state regardless of caption status", () => {
  assert.equal(analysisState("ok", "available"), "analysed");
  // A video analysed from a pasted transcript never had captions probed, and
  // must still read as analysed.
  assert.equal(analysisState("ok", "unknown"), "analysed");
  assert.equal(analysisState("failed", "available"), "failed");
});

test("without an analysis row, captions decide pending vs unanalysable", () => {
  assert.equal(analysisState(null, "available"), "pending");
  // Nothing will ever analyse these, so they must not claim to be queued.
  assert.equal(analysisState(null, "none"), "unanalysable");
  assert.equal(analysisState(null, "failed"), "unanalysable");
  assert.equal(analysisState(null, "unknown"), "unanalysable");
});
