import { createHash } from "node:crypto";
import { localDriver } from "@/lib/storage/local";
import { mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";
import { sha256File } from "./originals";

/** A completed identical output may be reconciled; different final bytes are never replaced. */
export async function storeImmutableOutput(rel: string, data: Buffer | { file: string }, root = mediaRoot()): Promise<void> {
  const saved = await localDriver(root).put(rel, data);
  if (saved.ok) return;
  if (saved.reason === "rejected") {
    const parts = splitRelative(rel);
    const existing = parts ? await resolveMediaFile(parts, root) : null;
    if (existing) {
      const expected = Buffer.isBuffer(data)
        ? createHash("sha256").update(data).digest("hex")
        : await sha256File(data.file);
      if (await sha256File(existing) === expected) return;
    }
  }
  throw new Error(saved.message);
}
