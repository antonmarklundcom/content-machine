import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { failure, type StorageDriver } from "./driver";
import { promoteStaged } from "./promote.mjs";
import {
  inside,
  mediaRoot,
  mediaRootMessage,
  mediaRootStatus,
  resolveMediaFile,
  splitRelative,
} from "./root";

/**
 * The primary tier (PLAN.md §1.41): files on the disk under `MEDIA_ROOT`.
 * Keys are paths relative to the root, forward slashes — what
 * `assets.local_path` stores. A root that is not there answers `missing`
 * rather than throwing.
 */
async function fileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function localDriver(root: string = mediaRoot()): StorageDriver {
  /** The absolute target for a write, or null when the key is unsafe or climbs out. */
  async function target(key: string): Promise<string | null> {
    const segments = splitRelative(key);
    if (!segments) return null;
    const candidate = path.resolve(root, ...segments);
    if (!inside(root, candidate)) return null;
    // Folders along the way may already exist as symlinks: the deepest existing
    // one must really be inside the root before anything is created under it,
    // and the target itself may not be a symlink (an overwrite would follow it).
    const realRoot = await realpath(root);
    const contained = (real: string) => real === realRoot || inside(realRoot, real);
    let existing = path.dirname(candidate);
    while (!(await lstat(existing).catch(() => null))) existing = path.dirname(existing);
    if (!contained(await realpath(existing))) return null;
    await mkdir(path.dirname(candidate), { recursive: true });
    if (!contained(await realpath(path.dirname(candidate)))) return null;
    if ((await lstat(candidate).catch(() => null))?.isSymbolicLink()) return null;
    return candidate;
  }

  async function notReady() {
    const status = await mediaRootStatus(root);
    return status === "ok"
      ? null
      : failure(status === "missing" ? "missing" : "unwritable", mediaRootMessage(status));
  }

  return {
    name: "local",

    async put(key, data, options = {}) {
      const down = await notReady();
      if (down) return down;
      let staged: string | null = null;
      try {
        const file = await target(key);
        if (!file) return failure("rejected", `Unsafe media path: ${key}`);
        // A failed or interrupted write is never visible under the final name.
        // Staging stays on the same filesystem and is ignored by media scanning.
        staged = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.partial`);
        const expectedBytes = Buffer.isBuffer(data) ? data.length : (await stat(data.file)).size;
        const expectedHash = Buffer.isBuffer(data)
          ? createHash("sha256").update(data).digest("hex")
          : await fileHash(data.file);
        if (Buffer.isBuffer(data)) {
          await writeFile(staged, data, { flag: "wx" });
        } else {
          await copyFile(data.file, staged, constants.COPYFILE_EXCL);
        }
        const bytes = (await stat(staged)).size;
        if (bytes !== expectedBytes || (await fileHash(staged)) !== expectedHash)
          throw new Error("The staged media file is incomplete or changed.");
        // Flush completed bytes before atomically exposing their name.
        const completed = await open(staged, "r+");
        try {
          await completed.sync();
        } finally {
          await completed.close();
        }
        await promoteStaged(staged, file, options);
        return { ok: true, key: splitRelative(key)!.join("/"), bytes };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") return failure("rejected", `A file already exists at ${key}.`);
        if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
          return failure("unwritable", mediaRootMessage("unwritable"));
        }
        return failure("error", (error as Error).message);
      } finally {
        if (staged) await rm(staged, { force: true }).catch(() => {});
      }
    },

    async get(key) {
      const down = await notReady();
      if (down?.reason === "missing") return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      const file = await resolveMediaFile(segments, root);
      if (!file) return failure("not_found", `No file at ${key}.`);
      try {
        return { ok: true, data: await readFile(file) };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },

    async exists(key) {
      const down = await notReady();
      if (down?.reason === "missing") return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      return { ok: true, exists: (await resolveMediaFile(segments, root)) !== null };
    },

    async remove(key) {
      const down = await notReady();
      if (down) return down;
      const segments = splitRelative(key);
      if (!segments) return failure("rejected", `Unsafe media path: ${key}`);
      const file = await resolveMediaFile(segments, root);
      if (!file) return { ok: true, removed: false };
      try {
        await rm(file);
        return { ok: true, removed: true };
      } catch (error) {
        return failure("error", (error as Error).message);
      }
    },
  };
}
