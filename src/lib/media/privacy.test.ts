import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { preserveOriginal, sha256File } from "./originals";
import {
  isInternalMediaPath,
  isPrivateAsset,
  isPrivateMediaFile,
  isPrivateMediaPath,
  privateMediaHashes,
  assetPrivacy,
  approveSharedMediaIdentity,
  markSharedMediaFile,
} from "./privacy";

test("personal namespaces, existing immutable clones and thumbnails remain private after source removal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-private-media-"));
  try {
    const folder = path.join(root, "voice", "_consent");
    await mkdir(folder, { recursive: true });
    const source = path.join(folder, "synthetic.pdf");
    await writeFile(source, "%PDF-1.7 synthetic consent");
    const clone = await preserveOriginal(source, root);
    assert.ok(clone);
    const asset = { localPath: clone.rel, sha256: clone.sha, sourceRef: null };
    assert.equal(
      await isPrivateAsset(asset, root),
      true,
      "old content-addressed clones inherit personal classification",
    );
    const thumb = `_thumbs/${clone.sha.slice(0, 2)}/${clone.sha}.webp`;
    await mkdir(path.dirname(path.join(root, thumb)), { recursive: true });
    await writeFile(path.join(root, thumb), "synthetic different thumbnail bytes");
    assert.equal(await isPrivateMediaFile(thumb, root), true);
    await rm(source);
    assert.equal(
      await isPrivateAsset(asset, root),
      true,
      "append-only identity survives removal of its private source",
    );
    assert.equal(await isPrivateMediaFile(clone.rel, root), true);
    assert.equal(
      await readFile(clone.file, "utf8"),
      "%PDF-1.7 synthetic consent",
      "classification preserves original bytes",
    );
    await writeFile(path.join(root, "public.pdf"), "%PDF-1.7 synthetic public document");
    assert.equal(await isPrivateMediaFile("public.pdf", root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed private sources preserve both identities, and raw internal namespaces cannot bypass asset checks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-private-media-"));
  try {
    await mkdir(path.join(root, "voice", "_references"), { recursive: true });
    const source = path.join(root, "voice", "_references", "synthetic.wav");
    await writeFile(source, "RIFFsynthetic reference A");
    const first = await sha256File(source);
    assert.ok((await privateMediaHashes(root)).has(first));
    await writeFile(source, "RIFFsynthetic replacement reference B with different size");
    const second = await sha256File(source);
    const hashes = await privateMediaHashes(root);
    assert.ok(hashes.has(first) && hashes.has(second));
    assert.equal(isPrivateMediaPath("VOICE\\_DATASETS\\sample\\take.wav"), true);
    assert.equal(isInternalMediaPath(`_originals/ab/${"a".repeat(64)}.pdf`), true);
    assert.equal(isInternalMediaPath(`_thumbs/ab/${"a".repeat(64)}.webp`), true);
    assert.equal(isPrivateMediaPath("voice/script/script-1/take.wav"), false);
    assert.equal(isInternalMediaPath("brand/_brand/2026-10/post.png"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unavailable privacy state fails closed instead of assuming library identities are public", async () => {
  await assert.rejects(
    isPrivateAsset(
      { sha256: "a".repeat(64), localPath: "_originals/aa/a.pdf" },
      path.join(tmpdir(), "cm-missing-private-state", "missing"),
    ),
  );
});

test("unknown immutable identities fail closed; safe ordinary-source provenance or exact owner review can approve shared access", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-unclassified-media-"));
  try {
    const source = path.join(root, "source.pdf");
    await writeFile(source, "%PDF-1.7 synthetic source-gone legacy asset");
    const original = await preserveOriginal(source, root);
    assert.ok(original);
    await rm(source);
    const asset = { localPath: original.rel, sha256: original.sha };
    assert.equal(await assetPrivacy(asset, root), "unclassified");
    assert.equal(await isPrivateAsset(asset, root), true);
    await assert.rejects(markSharedMediaFile(original.rel, original.sha, root), /internal/);
    await approveSharedMediaIdentity(original.sha, root);
    assert.equal(
      await assetPrivacy(asset, root),
      "shared",
      "explicit owner review can classify the exact identity",
    );
    await mkdir(path.join(root, "voice", "_consent"), { recursive: true });
    await writeFile(
      path.join(root, "voice", "_consent", "later.pdf"),
      await readFile(original.file),
    );
    assert.equal(
      await assetPrivacy(asset, root),
      "private",
      "private provenance always overrides shared approval",
    );
    await assert.rejects(approveSharedMediaIdentity(original.sha, root), /Known private/);
    await writeFile(source, "%PDF-1.7 ordinary synthetic public source");
    const sha = await sha256File(source);
    await markSharedMediaFile("source.pdf", sha, root);
    assert.equal(await assetPrivacy({ localPath: "source.pdf", sha256: sha }, root), "shared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
