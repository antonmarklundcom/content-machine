import { access, readFile, readdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root)
  throw new Error("Usage: node scripts/validate-hostinger-artifact.mjs <artifact-directory>");
const artifact = await realpath(path.resolve(root));
const server = path.join(artifact, "server.js");
await access(server);
const manifest = JSON.parse(await readFile(path.join(artifact, "package.json"), "utf8"));
if (!manifest.dependencies?.mysql2) throw new Error("Artifact manifest is missing runtime mysql2.");
const require = createRequire(server);
const resolvedMysql = require.resolve("mysql2/promise");
const mysqlNodeModules = path.join(artifact, "node_modules");
if (!resolvedMysql.startsWith(mysqlNodeModules + path.sep)) {
  throw new Error(`mysql2 resolved outside the physical artifact: ${resolvedMysql}`);
}
await import(pathToFileURL(resolvedMysql).href);
await access(path.join(artifact, ".next", "static"));
await access(path.join(artifact, "public"));

async function firstJavaScript(directory, base = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await firstJavaScript(file, base);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      return path.relative(base, file).split(path.sep).join("/");
    }
  }
  return null;
}
const staticRoot = path.join(artifact, ".next", "static");
const staticChunk = await firstJavaScript(staticRoot);
if (!staticChunk) throw new Error("Artifact has no JavaScript static chunk to smoke-test.");

const port = await (async () => {
  const { createServer: createTcpServer } = await import("node:net");
  const probe = createTcpServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve a local port for smoke test.");
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
})();

const env = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot,
  NODE_ENV: "production",
  NODE_OPTIONS: "",
  NODE_NO_WARNINGS: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  SESSION_SECRET: "synthetic-standalone-smoke-secret-with-no-production-value",
  GEMINI_FAKE: "1",
  VOICE_FAKE: "1",
  AI_PROVIDER: "gemini",
};
if ("DATABASE_URL" in env) throw new Error("Standalone smoke must not receive DATABASE_URL.");
const child = spawn(process.execPath, [server], {
  cwd: artifact,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const remember = (chunk) => {
  output = `${output}${chunk}`.slice(-8000);
};
child.stdout.on("data", remember);
child.stderr.on("data", remember);
const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 45_000;
let ready = false;
try {
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Standalone server exited early (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`${base}/_next/static/${staticChunk}`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error(`Standalone server did not serve static assets before timeout.\n${output}`);
  const login = await fetch(`${base}/youtube/login`);
  const loginHtml = await login.text();
  if (
    login.status !== 200 ||
    !loginHtml.includes('name="email"') ||
    !loginHtml.includes('name="password"')
  ) {
    throw new Error(
      `Standalone login form did not load without database credentials (status ${login.status}).`,
    );
  }
  const privateAsset = await fetch(`${base}/api/media/asset/1`);
  if (privateAsset.status !== 401) {
    throw new Error(
      `Unauthenticated local asset request should fail with 401; got ${privateAsset.status}.`,
    );
  }
  console.log(
    "Validated standalone mysql2 closure, static asset serving, login form, and private-media 401 without DATABASE_URL.",
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
