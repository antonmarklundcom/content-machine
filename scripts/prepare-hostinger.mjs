import { cp, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(projectRoot, ".next", "standalone");
const standaloneServer = path.join(standalone, "server.js");
await stat(standaloneServer);
const [projectReal, standaloneReal] = await Promise.all([
  realpath(projectRoot),
  realpath(standalone),
]);
if (standaloneReal === projectReal || !standaloneReal.startsWith(`${projectReal}${path.sep}`)) {
  throw new Error(
    "Refusing to prepare standalone output resolved outside the project build directory.",
  );
}

const staticSource = path.join(projectRoot, ".next", "static");
await stat(staticSource);
const staticTarget = path.join(standalone, ".next", "static");
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = path.join(projectRoot, "public");
const publicTarget = path.join(standalone, "public");
try {
  await stat(publicSource);
  await cp(publicSource, publicTarget, { recursive: true, force: true });
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  await mkdir(publicTarget, { recursive: true });
}
console.log("Prepared Next standalone output with static and public directories.");
