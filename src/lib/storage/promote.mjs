import { link, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

/** Complete bytes only. The fallback serializes cooperating writers on filesystems without hard links.
 * A killed fallback writer leaves a hidden publish-lock for worker-stopped reconciliation.
 * @param {string} staged @param {string} file @param {{overwrite?: boolean}} options
 */
export async function promoteStaged(staged, file, options = {}) {
  if (options.overwrite) {
    await rename(staged, file);
    return;
  }
  try {
    await link(staged, file);
    return;
  } catch (error) {
    if (!["ENOTSUP", "ENOSYS", "EINVAL", "EPERM", "EXDEV"].includes(error.code ?? "")) throw error;
  }
  const lock = path.join(path.dirname(file), `.${path.basename(file)}.publish-lock`);
  await mkdir(lock);
  try {
    if (
      await lstat(file).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    ) {
      const collision = new Error("A completed file already exists.");
      collision.code = "EEXIST";
      throw collision;
    }
    await rename(staged, file);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
