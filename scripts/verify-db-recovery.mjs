import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createConnection } from "mysql2/promise";
import { register } from "tsx/esm/api";

register();
const { requireDisposableTestDatabase } = await import("../src/db/test-database-guard.ts");
const { databaseOptions } = await import("../src/db/driver.ts");
const url = requireDisposableTestDatabase(
  process.env.DATABASE_URL,
  process.env.ALLOW_DESTRUCTIVE_TEST_DB,
);
const parsed = new URL(url);
const container = process.argv[2];
if (!/^[a-f0-9]{12,64}$/.test(container ?? ""))
  throw new Error("Pass the CI MariaDB service container ID.");
if (!["127.0.0.1", "localhost"].includes(parsed.hostname))
  throw new Error("Recovery rehearsal requires the loopback CI service.");
const database = decodeURIComponent(parsed.pathname.slice(1));
const user = decodeURIComponent(parsed.username);
const password = decodeURIComponent(parsed.password);
const connection = await createConnection(databaseOptions(url));
function containerCommand(command, args, input) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      ...(input ? ["-i"] : []),
      "-e",
      `MYSQL_PWD=${password}`,
      container,
      command,
      `--user=${user}`,
      ...args,
      database,
    ],
    {
      input,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `${command} failed during disposable recovery rehearsal: ${result.stderr ?? result.error?.message}`,
    );
  return result.stdout;
}
async function snapshot() {
  const [names] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const tables = names.map((row) => String(Object.values(row)[0])).sort();
  const result = {};
  for (const table of tables) {
    assert.match(table, /^[a-z0-9_]+$/i);
    const [ddl] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
    result[table] = {
      ddl: ddl[0]["Create Table"],
      rows: rows.map((row) => JSON.stringify(row)).sort(),
    };
  }
  return result;
}
try {
  await connection.query("SET time_zone = '+00:00'");
  // Deliberately exercise UTF-8, case-sensitive identities, decimals, UTC millis,
  // nullable fields and generated full-URL hashes, in addition to all suite rows.
  await connection.execute(
    "INSERT INTO brands (id,name,domain,niche,market,platforms) VALUES (?,?,?,?,?,?)",
    [
      "recovery-A",
      "Recovery 🧪 日本語",
      "synthetic.invalid",
      "test",
      "test",
      JSON.stringify(["instagram"]),
    ],
  );
  await connection.execute(
    "INSERT INTO brands (id,name,domain,niche,market,platforms) VALUES (?,?,?,?,?,?)",
    ["recovery-a", "Distinct identity", "synthetic.invalid", "test", "test", "[]"],
  );
  await connection.execute("INSERT INTO clips (url,tags,note,saved_at) VALUES (?,?,?,?)", [
    "https://synthetic.invalid/" + "a".repeat(950),
    JSON.stringify(["ñ", "你好", "🧪"]),
    "quote ' and slash \\ and\nnewline",
    "2041-01-02 03:04:05.678",
  ]);
  const before = await snapshot();
  assert.ok(Object.keys(before).length >= 51, "50 app tables plus migration bookkeeping required");
  const dump = containerCommand("mariadb-dump", [
    "--single-transaction",
    "--hex-blob",
    "--skip-extended-insert",
  ]);
  const directory = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? tmpdir(), "content-machine-synthetic-recovery-"),
  );
  await writeFile(path.join(directory, "synthetic-only.sql"), dump);
  // Remove every table only in this guarded disposable database, then restore the
  // real native SQL dump. Merely exporting a file is not a recovery proof.
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of Object.keys(before)) await connection.query(`DROP TABLE \`${table}\``);
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  containerCommand("mariadb", [], dump);
  const after = await snapshot();
  assert.deepEqual(
    after,
    before,
    "Native dump/restore must preserve schema and every synthetic row",
  );
  const [rows] = await connection.query(
    "SELECT id FROM brands WHERE id IN ('recovery-A','recovery-a') ORDER BY id",
  );
  assert.equal(rows.length, 2);
  console.log(
    `Native MariaDB dump AND restore passed: ${Object.keys(after).length} tables; SHA256 ${createHash("sha256").update(dump).digest("hex")}. Synthetic temporary backup only.`,
  );
} finally {
  await connection.end();
}
