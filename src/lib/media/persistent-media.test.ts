import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkPersistentMedia } from "../../../scripts/lib/persistent-media.mjs";

test("persistent-media preflight rejects release overlap and probes only its own synthetic file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-persistent-preflight-"));
  try {
    const release = path.join(root, "release");
    const media = path.join(root, "persistent");
    await mkdir(release);
    await mkdir(media);
    await writeFile(path.join(media, "untouched.txt"), "synthetic sentinel");
    await assert.rejects(checkPersistentMedia(undefined, release), /explicit absolute/);
    await assert.rejects(checkPersistentMedia("media", release), /explicit absolute/);
    await assert.rejects(checkPersistentMedia(release, release), /separate from/);
    await assert.rejects(checkPersistentMedia(root, release), /separate from/);
    assert.deepEqual(await checkPersistentMedia(media, release, { writeProbe: true }), {
      persistentPath: true,
      writeProbe: true,
    });
    assert.deepEqual(await readdir(media), ["untouched.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
