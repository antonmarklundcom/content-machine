import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assetOriginal, preserveOriginal, sha256File } from "./originals";

test("immutable original bytes survive same-size and different-size source replacement, movement and duplicate imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "asset-identity-"));
  try {
    const source = path.join(root, "input.pdf");
    const firstBytes = Buffer.from("%PDF-1.7 original A");
    await writeFile(source, firstBytes);
    const first = await preserveOriginal(source, root);
    assert.ok(first);
    await writeFile(source, Buffer.from("%PDF-1.7 replaced B"));
    const sameSize = await preserveOriginal(source, root);
    assert.ok(sameSize);
    assert.equal(sameSize.bytes, first.bytes);
    assert.notEqual(sameSize.sha, first.sha);
    assert.deepEqual(await readFile(first.file), firstBytes);
    await writeFile(source, Buffer.from("%PDF-1.7 another replacement with more bytes"));
    const differentSize = await preserveOriginal(source, root);
    assert.ok(differentSize);
    assert.notEqual(differentSize.sha, first.sha);
    assert.deepEqual(await readFile(first.file), firstBytes);
    const moved = path.join(root, "moved.pdf");
    await rename(source, moved);
    const duplicate = await preserveOriginal(moved, root);
    assert.equal(duplicate?.rel, differentSize.rel);
    assert.equal(await sha256File(first.file), first.sha);
    const existing = await assetOriginal({ localPath: "input.pdf", sha256: first.sha }, root);
    assert.equal(existing?.rel, first.rel, "original remains available after source move");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed legacy sources and tampered originals cannot be served under an old identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "asset-identity-"));
  try {
    const source = path.join(root, "input.pdf");
    await writeFile(source, "%PDF-1.7 original A");
    const oldSha = await sha256File(source);
    await writeFile(source, "%PDF-1.7 replaced B");
    assert.equal(await assetOriginal({ localPath: "input.pdf", sha256: oldSha }, root), null);
    const original = await preserveOriginal(source, root);
    assert.ok(original);
    await writeFile(original.file, "%PDF-1.7 tampered C");
    await assert.rejects(preserveOriginal(source, root), /no longer matches/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit valid caption documents retain immutable identity through legacy migration and tamper detection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "asset-caption-"));
  try {
    for (const [name, mime, bytes] of [
      [
        "captions.srt",
        "application/x-subrip",
        "1\n00:00:00,000 --> 00:00:01,000\nSynthetic caption\n",
      ],
      ["captions.vtt", "text/vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\nSynthetic caption\n"],
    ]) {
      const source = path.join(root, name);
      await writeFile(source, bytes);
      const sha = await sha256File(source);
      assert.equal(
        await preserveOriginal(source, root),
        null,
        "untyped arbitrary text stays outside the library",
      );
      const original = await assetOriginal({ localPath: name, sha256: sha, mime }, root);
      assert.ok(original);
      assert.ok(original.rel.startsWith("_originals/"));
      assert.equal(await readFile(original.file, "utf8"), bytes);
      await rm(source);
      assert.equal(
        (await assetOriginal({ localPath: original.rel, sha256: sha, mime }, root))?.rel,
        original.rel,
      );
      await writeFile(original.file, "tampered caption");
      assert.equal(await assetOriginal({ localPath: original.rel, sha256: sha, mime }, root), null);
    }
    await writeFile(path.join(root, "invalid.vtt"), "arbitrary private text");
    assert.equal(await preserveOriginal(path.join(root, "invalid.vtt"), root, "text/vtt"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
