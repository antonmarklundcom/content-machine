import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promoteStaged } from "../src/lib/storage/promote.mjs";

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** @param {string} root @param {string} key @param {string} url */
export async function downloadMedia(root, key, url) {
  const parts = key.replace(/\\/g, "/").split("/");
  if (
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    key.includes(":") ||
    key.includes("\0") ||
    parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  )
    throw new Error("Unsafe relative media path.");
  const source = new URL(url);
  if (!["http:", "https:"].includes(source.protocol))
    throw new Error("Media URL must use HTTP(S).");
  const realRoot = await realpath(root);
  const file = path.resolve(realRoot, ...parts);
  if (!inside(realRoot, file)) throw new Error("Media path escapes its root.");
  let ancestor = path.dirname(file);
  while (!(await lstat(ancestor).catch(() => null))) ancestor = path.dirname(ancestor);
  if (!inside(realRoot, await realpath(ancestor)))
    throw new Error("Media folder escapes its root.");
  await mkdir(path.dirname(file), { recursive: true });
  if (!inside(realRoot, await realpath(path.dirname(file))))
    throw new Error("Media folder escapes its root.");
  if ((await lstat(file).catch(() => null))?.isSymbolicLink())
    throw new Error("Media target is a symlink.");
  const staged = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.partial`);
  let handle;
  try {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(300_000),
      headers: { "accept-encoding": "identity" },
    });
    if (!response.ok || !response.body)
      throw new Error(`Media download returned HTTP ${response.status}.`);
    handle = await open(staged, "wx");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024 * 1024) throw new Error("Media download exceeds 2 GiB.");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (!written.bytesWritten) throw new Error("Media write made no progress.");
        offset += written.bytesWritten;
      }
    }
    const length = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    if (length !== null && (!encoding || encoding === "identity") && Number(length) !== bytes)
      throw new Error("Media download ended before its expected byte length.");
    if (!bytes || (await stat(staged)).size !== bytes)
      throw new Error("Media download is incomplete.");
    const expectedHash = hash.digest("hex");
    const completedHash = createHash("sha256");
    for await (const chunk of createReadStream(staged)) completedHash.update(chunk);
    if (completedHash.digest("hex") !== expectedHash)
      throw new Error("Staged media bytes changed.");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // No overwrite: an existing immutable result survives retries and concurrent downloads.
    await promoteStaged(staged, file);
    return { key: parts.join("/"), bytes, sha256: expectedHash };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(staged, { force: true }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, key, url] = process.argv.slice(2);
  if (!root || !key || !url) {
    console.error(
      "Usage: node scripts/media-download.mjs <MEDIA_ROOT> <relative path> <HTTP(S) URL>",
    );
    process.exitCode = 1;
  } else {
    downloadMedia(root, key, url).then(
      (result) => console.log(JSON.stringify(result)),
      (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
    );
  }
}
