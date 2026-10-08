import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { downloadMedia } from "../../../scripts/media-download.mjs";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/synthetic-media`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("CLI downloads expose a final name only after the entire response is validated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-download-"));
  let signalStarted!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const server = createServer((_req, response) => {
    response.writeHead(200, { "content-length": "12" });
    response.write("first ");
    finish = () => response.end("second");
    signalStarted();
  });
  try {
    const url = await listen(server);
    const pending = downloadMedia(root, "movie.mp4", url);
    await started;
    assert.equal(existsSync(path.join(root, "movie.mp4")), false);
    const activeNames = await readdir(root);
    assert.ok(activeNames.every((name) => name.startsWith(".") && name.endsWith(".partial")));
    finish();
    const result = await pending;
    assert.equal(result.bytes, 12);
    assert.equal(result.sha256.length, 64);
    assert.equal(await readFile(path.join(root, "movie.mp4"), "utf8"), "first second");
    assert.deepEqual(await readdir(root), ["movie.mp4"]);
  } finally {
    finish?.();
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted CLI downloads leave no final file and retries preserve existing results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cm-download-interrupt-"));
  let broken = true;
  let requests = 0;
  const server = createServer((_req, response) => {
    requests++;
    if (broken) {
      response.writeHead(200, { "content-length": "200" });
      response.write("fragment");
      setImmediate(() => response.destroy());
    } else response.end("complete replacement");
  });
  try {
    const url = await listen(server);
    await assert.rejects(downloadMedia(root, "new.pdf", url));
    assert.deepEqual(await readdir(root), []);
    broken = false;
    await writeFile(path.join(root, "existing.pdf"), "immutable original");
    await assert.rejects(downloadMedia(root, "existing.pdf", url), { code: "EEXIST" });
    assert.equal(await readFile(path.join(root, "existing.pdf"), "utf8"), "immutable original");
    assert.deepEqual(await readdir(root), ["existing.pdf"]);
    const before = requests;
    await assert.rejects(downloadMedia(root, "../escape.pdf", url), /Unsafe relative/);
    await assert.rejects(downloadMedia(root, "safe.pdf", "file:///private"), /must use/);
    assert.equal(requests, before, "unsafe input never dispatches a request");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});
