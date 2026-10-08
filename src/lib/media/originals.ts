import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { localDriver } from "@/lib/storage/local";
import { promoteStaged } from "@/lib/storage/promote.mjs";
import { mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";
import { SNIFF_BYTES, sniffMime, type Sniffed } from "./sniff";

export const ORIGINALS_DIR = "_originals";

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function header(file: string): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export type Original = { file: string; rel: string; sha: string; bytes: number; sniffed: Sniffed };

/** Hash a completed snapshot, then atomically expose it by content identity.
 * All metadata describes the copied bytes, even if a source changes mid-import.
 * Existing originals are never overwritten, including a tampered original.
 */
export async function preserveOriginal(file: string, root = mediaRoot()): Promise<Original | null> {
  const driver = localDriver(root);
  const stage = `${ORIGINALS_DIR}/${randomUUID()}.tmp`;
  const copied = await driver.put(stage, { file });
  if (!copied.ok) throw new Error(copied.message);
  let ready: string | null = null;
  try {
    const snapshot = path.join(root, ...stage.split("/"));
    const sniffed = sniffMime(await header(snapshot));
    if (!sniffed) return null;
    const sha = await sha256File(snapshot);
    const rel = `${ORIGINALS_DIR}/${sha.slice(0, 2)}/${sha}.${sniffed.ext}`;
    // localDriver checks real parents and symlinks before creating this file.
    ready = `${ORIGINALS_DIR}/${sha.slice(0, 2)}/.${randomUUID()}.tmp`;
    const complete = await driver.put(ready, { file: snapshot });
    if (!complete.ok) throw new Error(complete.message);
    const original = path.join(root, ...rel.split("/"));
    try {
      await promoteStaged(path.join(root, ...ready.split("/")), original);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const safe = await resolveMediaFile(splitRelative(rel)!, root);
    if (!safe || await sha256File(safe) !== sha)
      throw new Error("Stored original no longer matches its hash. Restore it from backup before reviewing or publishing.");
    return { file: safe, rel, sha, bytes: (await stat(safe)).size, sniffed };
  } finally {
    await rm(path.join(root, ...stage.split("/")), { force: true });
    if (ready) await rm(path.join(root, ...ready.split("/")), { force: true });
  }
}

/** Existing immutable bytes win; legacy sources must still match their SHA. */
export async function assetOriginal(
  asset: { localPath: string | null; sha256: string },
  root = mediaRoot(),
): Promise<{ file: string; rel: string } | null> {
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) return null;
  const sha = asset.sha256.toLowerCase();
  const folder = `${ORIGINALS_DIR}/${sha.slice(0, 2)}`;
  const names = await readdir(path.join(root, ...folder.split("/"))).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.startsWith(`${sha}.`)) continue;
    const rel = `${folder}/${name}`;
    const file = await resolveMediaFile(splitRelative(rel)!, root);
    if (file && await sha256File(file) === sha) return { file, rel };
  }
  const segments = asset.localPath ? splitRelative(asset.localPath) : null;
  const file = segments ? await resolveMediaFile(segments, root) : null;
  if (!file || await sha256File(file) !== sha) return null;
  const original = await preserveOriginal(file, root);
  return original?.sha === sha ? original : null;
}
