import { constants } from "node:fs";
import { access, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Inspect only the configured directory and an optional newly-created probe. */
export async function checkPersistentMedia(root, releaseRoot, { writeProbe = false } = {}) {
  if (!root || !path.isAbsolute(root))
    throw new Error("Set MEDIA_ROOT to an explicit absolute persistent directory.");
  let storage;
  let release;
  try {
    storage = await realpath(root);
    release = await realpath(releaseRoot);
    if (!(await stat(storage)).isDirectory()) throw new Error();
  } catch {
    throw new Error(
      "MEDIA_ROOT must be an existing accessible directory; provision it outside the release first.",
    );
  }
  const within = (parent, child) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  if (
    within(release, storage) ||
    within(storage, release) ||
    storage
      .split(path.sep)
      .some((part) => [".next", ".git", "node_modules"].includes(part.toLowerCase()))
  )
    throw new Error(
      "MEDIA_ROOT must be separate from the application release and generated dependency/build directories.",
    );
  try {
    await access(storage, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error("MEDIA_ROOT needs read and write access for the application user.");
  }
  if (writeProbe) {
    const probe = path.join(storage, `.content-machine-preflight-${randomUUID()}.tmp`);
    const bytes = Buffer.from("Content Machine synthetic storage probe\n");
    let created = false;
    try {
      const file = await open(probe, "wx", 0o600);
      created = true;
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      if (!(await readFile(probe)).equals(bytes)) throw new Error();
    } catch {
      throw new Error(
        "The synthetic MEDIA_ROOT write/read probe failed; check persistent storage permissions and capacity.",
      );
    } finally {
      if (created) await rm(probe, { force: true });
    }
  }
  return { persistentPath: true, writeProbe };
}
