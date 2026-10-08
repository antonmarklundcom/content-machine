import { cp, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2];
if (!output) {
  throw new Error("Usage: node scripts/package-hostinger.mjs <empty-physical-output-directory>");
}
const target = path.resolve(output);
if (target === projectRoot || target.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("Refusing to package inside the repository; use an isolated output directory.");
}
try {
  await stat(target);
  throw new Error(`Refusing to overwrite existing artifact directory: ${target}`);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
  if (error instanceof Error && error.message.startsWith("Refusing to overwrite")) throw error;
}
await mkdir(path.dirname(target), { recursive: true });
const targetParentReal = await realpath(path.dirname(target));
const projectReal = await realpath(projectRoot);
if (targetParentReal === projectReal || targetParentReal.startsWith(`${projectReal}${path.sep}`)) {
  throw new Error("Refusing an output directory whose resolved parent is inside the repository.");
}
const source = path.join(projectRoot, ".next", "standalone");
await stat(path.join(source, "server.js"));
const sourceReal = await realpath(source);
if (sourceReal === projectReal || !sourceReal.startsWith(`${projectReal}${path.sep}`)) {
  throw new Error("Next standalone output resolved outside the project build directory.");
}
await cp(source, target, { recursive: true, errorOnExist: true, force: false });
console.log(`Created isolated Hostinger artifact at ${target}`);
