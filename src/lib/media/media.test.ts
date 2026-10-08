import assert from "node:assert/strict";
import { test } from "node:test";

import { entryCandidates, parseManifest } from "./manifest";
import { sniffMime } from "./sniff";

/** [O10] Sniffing a file's type from its header, and reading the Higgsfield manifests. */

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("media types come from the first bytes, not the name", () => {
  assert.equal(sniffMime(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.mime, "image/png");
  assert.equal(sniffMime(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime, "image/jpeg");
  assert.equal(sniffMime(bytes("GIF89a"))?.mime, "image/gif");
  assert.equal(sniffMime(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))?.mime, "image/webp");
  assert.deepEqual(sniffMime(bytes([0, 0, 0, 0x18], "ftypisom")), { mime: "video/mp4", kind: "video", ext: "mp4" });
  assert.equal(sniffMime(bytes([0, 0, 0, 0x14], "ftypqt  "))?.mime, "video/quicktime");
  assert.equal(sniffMime(bytes([0, 0, 0, 0x14], "ftypM4A "))?.kind, "audio");
  assert.equal(sniffMime(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.mime, "video/webm");
  assert.equal(sniffMime(bytes("ID3", [4, 0]))?.mime, "audio/mpeg");
  assert.equal(sniffMime(bytes("%PDF-1.7"))?.kind, "document");
  assert.equal(sniffMime(bytes("<?php echo 1;")), null);
  assert.equal(sniffMime(bytes("{\"a\":1}")), null);
  assert.equal(sniffMime(new Uint8Array()), null);
});

test("a build 2 shots manifest parses into entries, failed ones left out", () => {
  const manifest = parseManifest(
    JSON.stringify({
      scriptId: 12,
      title: "x",
      shots: [
        { number: 1, kind: "image", file: "media/12/01-a.png", url: "https://h/1", prompt: "A", model: "m", jobId: "job-1", status: "done" },
        { number: 2, kind: "image", file: "media/12/02-b.png", status: "failed", error: "boom" },
      ],
      thumbnails: [{ number: 1, file: "media/12/thumb-1.png", url: "https://h/t", prompt: "T", status: "done" }],
      credits: { estimated: 0, spent: 0 },
    }),
  );
  assert.ok(manifest);
  assert.equal(manifest.source, "higgsfield");
  assert.deepEqual(
    manifest.entries.map((e) => [e.file, e.prompt, e.sourceRef]),
    [
      ["media/12/01-a.png", "A", "job-1"],
      ["media/12/thumb-1.png", "T", "https://h/t"],
    ],
  );
});

test("a post manifest carries brand, account and tags; junk is not a manifest", () => {
  const manifest = parseManifest(
    JSON.stringify({ brandId: "guide", accountId: 3, tags: ["residency"], source: "upload", files: [{ file: "01-a.png", tags: ["hero"] }] }),
  );
  assert.equal(manifest?.brandId, "guide");
  assert.equal(manifest?.accountId, 3);
  assert.equal(manifest?.source, "upload");
  assert.deepEqual(manifest?.entries[0].tags, ["residency", "hero"]);
  assert.equal(parseManifest("not json"), null);
  assert.equal(parseManifest("[1,2]"), null);
  assert.equal(parseManifest(JSON.stringify({ source: "evil" }))?.source, "higgsfield");
});

test("a listed file is looked for as written, without build 2's media/ prefix, then beside the manifest", () => {
  assert.deepEqual(entryCandidates("media/12/01-a.png", "12"), ["media/12/01-a.png", "12/01-a.png", "12/01-a.png"].filter((v, i, a) => a.indexOf(v) === i));
  assert.deepEqual(entryCandidates("./01-a.png", "guide/_brand/2026-09/4-x"), ["01-a.png", "guide/_brand/2026-09/4-x/01-a.png"]);
});
