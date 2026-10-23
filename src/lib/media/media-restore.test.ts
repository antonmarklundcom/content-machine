import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { areaOf, compareMediaTrees } from "../../../scripts/lib/media-restore.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function syntheticTree(root: string) {
  const put = async (rel: string, body: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  };
  await put("brand/photo.jpg", "synthetic ordinary bytes");
  await put("_originals/ab/abcdef.jpg", "synthetic immutable bytes");
  await put(`_private/media-identities/${SHA_A}`, "classified\n");
  await put(`_private/shared-identities/${SHA_B}`, "classified\n");
  await put("voice/_consent/synthetic-consent.txt", "synthetic private bytes");
}

test("areaOf matches the app's private namespaces", () => {
  assert.equal(areaOf(`_private/media-identities/${SHA_A}`), "_private/media-identities");
  assert.equal(areaOf(`_PRIVATE/Shared-Identities/${SHA_B}`), "_private/shared-identities");
  assert.equal(areaOf("_private/other"), "private");
  assert.equal(areaOf("voice/_references/x.wav"), "private");
  assert.equal(areaOf("_originals/x.jpg"), "_originals");
  assert.equal(areaOf("voice/takes/x.wav"), "ordinary");
});

test("matched synthetic restore passes; missing markers and changed bytes fail", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-media-restore-"));
  try {
    const source = path.join(root, "source");
    const restored = path.join(root, "restored");
    await syntheticTree(source);
    await cp(source, restored, { recursive: true });
    const ok = await compareMediaTrees(source, restored);
    assert.equal(ok.identical, true, ok.problems.join("; "));
    assert.equal(ok.areas["_private/shared-identities"].restored, 1);

    // A restore that forgot the shared-identity markers must not pass.
    await rm(path.join(restored, "_private", "shared-identities"), { recursive: true });
    await writeFile(path.join(restored, "brand", "photo.jpg"), "different bytes");
    const bad = await compareMediaTrees(source, restored);
    assert.equal(bad.identical, false);
    assert.ok(bad.problems.some((p) => /shared-identities: marker folder absent/.test(p)));
    assert.ok(bad.problems.some((p) => /^ordinary: 0 missing, 1 changed/.test(p)));
    // Private areas never list names, only counts.
    assert.deepEqual(bad.areas["_private/shared-identities"].examples, []);
    assert.deepEqual(bad.areas.ordinary.examples, ["changed: brand/photo.jpg"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI is read-only and exits non-zero on a mismatched restore", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-media-restore-cli-"));
  try {
    const source = path.join(root, "source");
    const restored = path.join(root, "restored");
    await syntheticTree(source);
    await cp(source, restored, { recursive: true });
    const script = path.resolve("scripts/verify-media-restore.mjs");
    const pass = spawnSync(process.execPath, [script, source, restored], { encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /PASS/);
    assert.doesNotMatch(pass.stdout, new RegExp(SHA_A));
    await rm(path.join(restored, "_private", "media-identities"), { recursive: true });
    const fail = spawnSync(process.execPath, [script, source, restored], { encoding: "utf8" });
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /media-identities: marker folder absent/);
    assert.deepEqual((await readdir(path.join(source, "_private"))).sort(), [
      "media-identities",
      "shared-identities",
    ]);
    const usage = spawnSync(process.execPath, [script, source, source], { encoding: "utf8" });
    assert.equal(usage.status, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
