import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { storeImmutableOutput } from "./immutable-output";

test("completed identical outputs reconcile while different final bytes remain immutable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-output-"));
  try {
    await storeImmutableOutput("take.wav", Buffer.from("original complete output"), root);
    await storeImmutableOutput("take.wav", Buffer.from("original complete output"), root);
    await assert.rejects(storeImmutableOutput("take.wav", Buffer.from("different output"), root), /already exists/);
    assert.equal(await readFile(path.join(root, "take.wav"), "utf8"), "original complete output");
    const completed = path.join(root, "completed-source.wav");
    await writeFile(completed, "copied complete output");
    await storeImmutableOutput("copy.wav", { file: completed }, root);
    await storeImmutableOutput("copy.wav", { file: completed }, root);
    assert.equal(await readFile(path.join(root, "copy.wav"), "utf8"), "copied complete output");
    await assert.rejects(storeImmutableOutput("../escape.wav", Buffer.from("x"), root), /Unsafe media path/);
    assert.deepEqual((await readdir(root)).sort(), ["completed-source.wav", "copy.wav", "take.wav"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
