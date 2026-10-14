import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLearnMaterial, LEARN_MATERIAL_MAX_CHARS } from "./material";
test("source material validates ids, field types and evidence bounds", () => {
  assert.deepEqual(parseLearnMaterial(4, " caption ", "  "), {
    clipId: 4,
    caption: "caption",
    transcript: null,
  });
  for (const id of [0, -1, 0.5, NaN, "4"]) assert.equal(parseLearnMaterial(id, "", ""), null);
  assert.equal(parseLearnMaterial(4, null, ""), null);
  assert.equal(parseLearnMaterial(4, "x".repeat(LEARN_MATERIAL_MAX_CHARS + 1), ""), null);
});
