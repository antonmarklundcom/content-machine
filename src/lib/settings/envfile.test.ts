import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue, maskValue, readEnv, writeEnv } from "./envfile";

test("readEnv reads plain, quoted and export lines, skips comments", () => {
  const env = readEnv("# c\nA=1\nexport B=\"two words\"\nC='x'\n bad line\n");
  assert.deepEqual(env, { A: "1", B: "two words", C: "x" });
});

test("writeEnv replaces in place, keeps comments, appends new, removes empty", () => {
  const before = "# keys\nA=1\nB=2\n\n";
  const after = writeEnv(before, { A: "9", B: "", C: "new value" });
  assert.equal(after, '# keys\nA=9\nC="new value"\n');
});

test("writeEnv keeps Windows line endings", () => {
  assert.equal(writeEnv("A=1\r\n", { B: "2" }), "A=1\r\nB=2\r\n");
});

test("writeEnv on an empty file", () => {
  assert.equal(writeEnv("", { A: "x" }), "A=x\n");
});

test("formatValue quotes only when needed", () => {
  assert.equal(
    formatValue("postgresql://u:p@h/db?sslmode=require"),
    "postgresql://u:p@h/db?sslmode=require",
  );
  assert.equal(formatValue('a "b"'), '"a \\"b\\""');
  assert.equal(formatValue("a#b"), '"a#b"');
});

test("maskValue never shows the whole key", () => {
  assert.equal(maskValue(undefined), "");
  assert.equal(maskValue("short"), "••••");
  assert.equal(maskValue("AIzaSyABCDEFGH1234"), "AIza…1234");
});
