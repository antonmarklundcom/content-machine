import assert from "node:assert/strict";
import { test } from "node:test";
import { createNdjsonParser } from "./ndjson";

test("emits whole lines and holds partial ones until completed", () => {
  const parse = createNdjsonParser<{ n: number }>();
  assert.deepEqual(parse('{"n":1}\n{"n":2}\n'), [{ n: 1 }, { n: 2 }]);
  // A chunk boundary mid-object must not lose the object.
  assert.deepEqual(parse('{"n":'), []);
  assert.deepEqual(parse("3}\n"), [{ n: 3 }]);
});

test("blank lines are skipped and malformed lines do not throw", () => {
  const parse = createNdjsonParser<{ n: number }>();
  assert.deepEqual(parse('\n\n{"n":1}\nnot json\n{"n":2}\n'), [{ n: 1 }, { n: 2 }]);
});

test("a final line with no trailing newline stays buffered", () => {
  const parse = createNdjsonParser<{ n: number }>();
  assert.deepEqual(parse('{"n":1}'), []);
  assert.deepEqual(parse("\n"), [{ n: 1 }]);
});
