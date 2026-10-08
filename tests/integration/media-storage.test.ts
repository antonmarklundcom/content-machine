import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "@/db";
import { GET as serveScriptMedia } from "@/app/api/media/[...path]/route";
import { GET as serveAsset } from "@/app/api/media/asset/[id]/route";
import { GET as serveThumb } from "@/app/api/media/asset/[id]/thumb/route";
import { publishCopy, prunePublic } from "@/lib/media/public";
import { registerFile, sha256File } from "@/lib/media/register";
import { scanMediaRoot } from "@/lib/media/scan";
import { hostingerDriver } from "@/lib/storage/hostinger";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * O10 exit (PLAN.md §5.O10): register dedupes by sha256, the scan reads
 * manifests and loose files and is idempotent, an unplugged drive is a typed
 * `missing` everywhere (never a 500), and the hostinger driver works against a
 * stub server — and against the real PHP endpoint under `php -S` when PHP is
 * on the machine.
 */

let base = "";
let root = "";
let owner = "";
let png: Buffer;
let jpg: Buffer;

const ENV_KEYS = [
  "MEDIA_ROOT",
  "MEDIA_UPLOAD_URL",
  "MEDIA_UPLOAD_TOKEN",
  "MEDIA_PUBLIC_BASE",
  "MEDIA_PUBLIC_RETENTION_DAYS",
];

function write(rel: string, data: Buffer | string): string {
  const file = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

before(async () => {
  png = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#c33" } })
    .png()
    .toBuffer();
  jpg = await sharp({ create: { width: 30, height: 50, channels: 3, background: "#33c" } })
    .jpeg()
    .toBuffer();
});

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  base = mkdtempSync(path.join(tmpdir(), "o10-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  process.env.MEDIA_ROOT = root;
  await resetTables();
  owner = (await signIn("owner")).cookie;
});

after(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  if (base) rmSync(base, { recursive: true, force: true });
  await teardown();
});

async function allAssets() {
  return db.select().from(schema.assets).orderBy(schema.assets.id);
}

// ---------------------------------------------------------------------------
// register

test("registerFile stores sha256, sniffed type, size and a thumbnail, and dedupes by content", async () => {
  write("_inbox/higgsfield/2026-09-27/a.png", png);
  const first = await registerFile("_inbox/higgsfield/2026-09-27/a.png", {
    source: "higgsfield",
    tags: ["Hero", "hero"],
  });
  assert.equal(first.status, "created");
  const asset = first.status === "created" ? first.asset : null!;
  assert.equal(asset.kind, "image");
  assert.equal(asset.mime, "image/png");
  assert.equal(asset.bytes, png.length);
  assert.equal(asset.width, 64);
  assert.equal(asset.height, 40);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.localPath, `_originals/${asset.sha256.slice(0, 2)}/${asset.sha256}.png`);
  assert.equal(await sha256File(path.join(root, asset.localPath!)), asset.sha256);
  assert.deepEqual(asset.tags, ["hero"]);
  assert.ok(asset.thumbPath && existsSync(path.join(root, asset.thumbPath)), "thumbnail written");
  assert.equal(asset.durationSec, null);

  // Same file again: nothing changes.
  const again = await registerFile(path.join(root, "_inbox/higgsfield/2026-09-27/a.png"));
  assert.deepEqual(
    [again.status, again.status === "existing" && again.updated],
    ["existing", false],
  );

  // Same bytes under another name: the same asset, and the original path stays.
  write("guide/_brand/2026-09/4-x/01-a.png", png);
  const copy = await registerFile("guide/_brand/2026-09/4-x/01-a.png", {
    prompt: "red card",
    brandId: "guide",
  });
  assert.equal(copy.status, "existing");
  const filled = copy.status === "existing" ? copy.asset : null!;
  assert.equal(filled.id, asset.id);
  assert.equal(filled.localPath, asset.localPath);
  assert.equal(filled.prompt, "red card", "blank metadata is filled in");
  assert.equal(filled.brandId, "guide");

  // Moving the source does not change the immutable original path.
  rmSync(path.join(root, "_inbox/higgsfield/2026-09-27/a.png"));
  const moved = await registerFile("guide/_brand/2026-09/4-x/01-a.png", { prompt: "other" });
  assert.equal(moved.status === "existing" && moved.asset.localPath, asset.localPath);
  assert.equal(
    moved.status === "existing" && moved.asset.prompt,
    "red card",
    "set metadata is never overwritten",
  );

  assert.equal((await allAssets()).length, 1);
});

test("registerFile refuses non-media, missing files and paths outside the root", async () => {
  write("notes.txt", "hello");
  write("fake.png", "<?php echo 1; ?>");
  const outside = path.join(base, "outside.png");
  writeFileSync(outside, png);
  for (const [input, reason] of [
    ["notes.txt", "not_media"],
    ["fake.png", "not_media"],
    ["nope.png", "not_found"],
    [outside, "not_found"],
    ["../outside.png", "not_found"],
  ] as const) {
    const result = await registerFile(input);
    assert.equal(result.status, "rejected", input);
    assert.equal(result.status === "rejected" && result.reason, reason, input);
  }
  assert.equal((await allAssets()).length, 0);
});

// ---------------------------------------------------------------------------
// scan

test("scanMediaRoot registers manifest entries with their metadata, then loose files, idempotently", async () => {
  // A build 2 manifest: paths relative to the repo, whose media/ is the root.
  write("12/01-a.png", png);
  write(
    "12/manifest.json",
    JSON.stringify({
      scriptId: 12,
      shots: [
        {
          number: 1,
          kind: "image",
          file: "media/12/01-a.png",
          prompt: "A",
          model: "flux",
          jobId: "job-1",
          status: "done",
        },
        { number: 2, kind: "image", file: "media/12/02-b.png", status: "failed", error: "boom" },
      ],
    }),
  );
  write("_inbox/higgsfield/2026-09-27/loose.jpg", jpg);
  write("captures/9/reel.png", await sharp(png).resize(20, 20).png().toBuffer());
  write("12/readme.txt", "not media");
  write("12/half.png.part", "partial");
  write(".hidden/x.png", png);

  const first = await scanMediaRoot();
  assert.equal(first.status, "ok");
  if (first.status !== "ok") return;
  assert.deepEqual(first.errors, []);
  assert.equal(first.manifests, 1);
  assert.equal(first.created, 3);
  assert.equal(first.skipped, 2, "the text file and the partial download");

  const rows = await allAssets();
  const bySha = new Map(rows.map((r) => [r.sha256, r]));
  assert.ok(rows.every((row) => row.localPath?.startsWith("_originals/")));
  assert.deepEqual(first.registeredPaths, [
    "12/01-a.png",
    "_inbox/higgsfield/2026-09-27/loose.jpg",
    "captures/9/reel.png",
  ]);
  const shot = bySha.get(await sha256File(path.join(root, "12/01-a.png")))!;
  assert.deepEqual(
    [shot.source, shot.prompt, shot.model, shot.sourceRef],
    ["higgsfield", "A", "flux", "job-1"],
  );
  assert.equal(
    bySha.get(await sha256File(path.join(root, "_inbox/higgsfield/2026-09-27/loose.jpg")))!.source,
    "higgsfield",
  );
  assert.deepEqual(
    [
      bySha.get(await sha256File(path.join(root, "captures/9/reel.png")))!.source,
      bySha.get(await sha256File(path.join(root, "captures/9/reel.png")))!.sourceRef,
    ],
    ["capture", "clip:9"],
  );

  const second = await scanMediaRoot();
  assert.equal(second.status, "ok");
  if (second.status !== "ok") return;
  assert.deepEqual([second.created, second.updated, second.errors.length], [0, 0, 0]);
  assert.equal((await allAssets()).length, 3, "thumbnails under _thumbs/ are never registered");
});

// ---------------------------------------------------------------------------
// missing root

test("an unplugged media drive is a typed missing result everywhere, never a 500", async () => {
  write("7/thumbnails/1.png", png);
  const registered = await registerFile("7/thumbnails/1.png");
  assert.equal(registered.status, "created");
  const id = registered.status === "created" ? registered.asset.id : 0;

  renameSync(root, `${root}-unplugged`);

  const scan = await scanMediaRoot();
  assert.equal(scan.status, "missing");
  assert.match(scan.status === "missing" ? scan.message : "", /not connected/);
  assert.equal((await registerFile("7/thumbnails/1.png")).status, "missing");

  for (const response of [
    await callRoute(
      (r) => serveAsset(r, { params: Promise.resolve({ id: String(id) }) }),
      new Request(`http://localhost/api/media/asset/${id}`, { headers: { cookie: owner } }),
    ),
    await callRoute(
      (r) =>
        serveScriptMedia(r, { params: Promise.resolve({ path: ["7", "thumbnails", "1.png"] }) }),
      new Request("http://localhost/api/media/7/thumbnails/1.png", { headers: { cookie: owner } }),
    ),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { code: string }).code, "missing");
  }

  process.env.MEDIA_UPLOAD_URL = "http://127.0.0.1:9/upload.php";
  process.env.MEDIA_UPLOAD_TOKEN = "t".repeat(40);
  process.env.MEDIA_PUBLIC_BASE = "http://127.0.0.1:9";
  const published = await publishCopy(id);
  assert.equal(published.status, "missing");
});

test("publishing and pruning without an endpoint configured say so and change nothing", async () => {
  write("a.png", png);
  const registered = await registerFile("a.png");
  const id = registered.status === "created" ? registered.asset.id : 0;
  assert.equal((await publishCopy(id)).status, "missing");
  assert.equal((await prunePublic()).status, "missing");
  assert.equal((await allAssets())[0].publicUrl, null);
});

// ---------------------------------------------------------------------------
// the asset routes

test("the asset routes serve a library file and its thumbnail to authenticated authors, with ranges", async () => {
  write("guide/_brand/2026-09/1-x/01-a.png", png);
  const registered = await registerFile("guide/_brand/2026-09/1-x/01-a.png");
  const id = registered.status === "created" ? registered.asset.id : 0;
  const get = (handler: typeof serveAsset, idText: string, headers: Record<string, string>) =>
    callRoute(
      (r) => handler(r, { params: Promise.resolve({ id: idText }) }),
      new Request(`http://localhost/api/media/asset/${idText}`, { headers }),
    );

  const ok = await get(serveAsset, String(id), { cookie: owner });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png);

  const part = await get(serveAsset, String(id), { cookie: owner, range: "bytes=0-7" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-7/${png.length}`);
  assert.equal(Buffer.from(await part.arrayBuffer()).length, 8);

  const thumb = await get(serveThumb, String(id), { cookie: owner });
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/webp");

  const employee = (await signIn("employee")).cookie;
  assert.equal((await get(serveAsset, String(id), { cookie: employee })).status, 200);
  assert.equal((await get(serveAsset, String(id), {})).status, 401);
  assert.equal((await get(serveAsset, "999", { cookie: owner })).status, 404);
  assert.equal((await get(serveAsset, "1;drop", { cookie: owner })).status, 404);

  // A row whose path was tampered with to climb out is still a 404.
  await db
    .update(schema.assets)
    .set({ localPath: "../outside.png" })
    .where(eq(schema.assets.id, id));
  writeFileSync(path.join(base, "outside.png"), png);
  assert.equal((await get(serveAsset, String(id), { cookie: owner })).status, 404);
});

// ---------------------------------------------------------------------------
// hostinger driver against a stub server

type Stub = { server: Server; url: string; uploads: Buffer[]; deletes: string[] };

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function stubEndpoint(token: string): Promise<Stub> {
  const stub = { uploads: [] as Buffer[], deletes: [] as string[] } as Stub;
  let n = 0;
  stub.server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const body = await readBody(request);
    if (request.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: "Unauthorized." });
    if (request.url === "/upload.php") {
      assert.match(String(request.headers["content-type"]), /^multipart\/form-data; boundary=/);
      assert.ok(body.includes(Buffer.from('name="file"')));
      stub.uploads.push(body);
      const key = `files/2026/09/${String(++n).padStart(32, "0")}.png`;
      return send(200, {
        path: key,
        url: `${stub.url}/${key}`,
        bytes: body.length,
        mime: "image/png",
      });
    }
    if (request.url === "/delete.php") {
      const { path: key } = JSON.parse(body.toString()) as { path: string };
      stub.deletes.push(key);
      return send(200, { removed: true });
    }
    send(404, { error: "no" });
  });
  await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
  return stub;
}

test("the hostinger driver publishes a copy, prunes it after the retention window, and keeps scheduled ones", async () => {
  const token = "s".repeat(48);
  const stub = await stubEndpoint(token);
  try {
    process.env.MEDIA_UPLOAD_URL = `${stub.url}/upload.php`;
    process.env.MEDIA_UPLOAD_TOKEN = token;
    process.env.MEDIA_PUBLIC_BASE = stub.url;
    process.env.MEDIA_PUBLIC_RETENTION_DAYS = "30";

    write("a.png", png);
    write("b.jpg", jpg);
    const a = await registerFile("a.png");
    const b = await registerFile("b.jpg");
    const idA = a.status === "created" ? a.asset.id : 0;
    const idB = b.status === "created" ? b.asset.id : 0;

    const now = new Date("2026-09-27T12:00:00Z");
    const published = await publishCopy(idA, { now });
    assert.equal(published.status, "published");
    assert.equal(
      published.status === "published" && published.url,
      `${stub.url}/files/2026/09/${"1".padStart(32, "0")}.png`,
    );
    assert.equal(
      published.status === "published" && published.expiresAt.toISOString(),
      "2026-10-27T12:00:00.000Z",
    );
    assert.equal(stub.uploads.length, 1);
    assert.ok(stub.uploads[0].includes(png.subarray(0, 32)), "the file's bytes went up");

    // Publishing again reuses the copy and extends it.
    const again = await publishCopy(idA, { now: new Date("2026-10-01T12:00:00Z") });
    assert.equal(again.status, "existing");
    assert.equal(stub.uploads.length, 1);

    assert.equal((await publishCopy(idB, { now })).status, "published");
    // b is on a scheduled post: its copy must survive the prune.
    const [account] = await insertReturning(db, schema.socialAccounts, {
      brandId: "guide",
      platform: "instagram",
      handle: "guide.ig",
    });
    const [post] = await insertReturning(db, schema.posts, {
      accountId: account.id,
      brandId: "guide",
      format: "image_post",
      status: "scheduled",
      title: "x",
    });
    await db.insert(schema.postAssets).values({ postId: post.id, assetId: idB, position: 1 });

    assert.deepEqual(await prunePublic({ now: new Date("2026-10-15T00:00:00Z") }), {
      status: "ok",
      removed: 0,
      kept: 0,
      errors: [],
    });
    const pruned = await prunePublic({ now: new Date("2026-12-01T00:00:00Z") });
    assert.deepEqual(pruned, { status: "ok", removed: 1, kept: 1, errors: [] });
    assert.deepEqual(stub.deletes, [`files/2026/09/${"1".padStart(32, "0")}.png`]);
    const rows = await allAssets();
    assert.equal(rows.find((r) => r.id === idA)!.publicUrl, null);
    assert.equal(rows.find((r) => r.id === idA)!.publicExpiresAt, null);
    assert.ok(rows.find((r) => r.id === idB)!.publicUrl);

    // A wrong token is a typed refusal, not a throw.
    const wrong = hostingerDriver({
      uploadUrl: `${stub.url}/upload.php`,
      token: "x".repeat(40),
      publicBase: stub.url,
    });
    const refused = await wrong.put("a.png", png);
    assert.equal(!refused.ok && refused.reason, "rejected");
  } finally {
    stub.server.close();
  }
});

// ---------------------------------------------------------------------------
// the real PHP endpoint, when PHP is here

function phpAvailable(): boolean {
  const probe = spawnSync("php", ["-r", "echo class_exists('finfo') ? 'ok' : 'no';"], {
    encoding: "utf8",
  });
  return probe.status === 0 && probe.stdout === "ok";
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("hosting/media-upload under php -S: token, allowlist, size cap, random names, delete", async (t) => {
  if (!phpAvailable()) {
    console.log("# php (with fileinfo) not found — skipping the PHP endpoint test (§5.O10.2).");
    t.skip("php not available");
    return;
  }
  const docroot = path.join(base, "public_html");
  mkdirSync(path.join(docroot, "files"), { recursive: true });
  const source = path.resolve("hosting/media-upload");
  for (const file of ["upload.php", "delete.php", "lib.php", ".htaccess"]) {
    copyFileSync(path.join(source, file), path.join(docroot, file));
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const token = "p".repeat(64);

  const server: ChildProcess = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", docroot], {
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50; i++) {
      const up = await fetch(`${url}/upload.php`).then(
        () => true,
        () => false,
      );
      if (up) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // No config.php yet: not configured, whatever the token.
    assert.equal((await fetch(`${url}/upload.php`, { method: "POST" })).status, 503);
    writeFileSync(
      path.join(docroot, "config.php"),
      `<?php return ['token' => '${token}', 'max_bytes' => 20000, 'public_base' => '${url}'];`,
    );
    assert.equal((await fetch(`${url}/upload.php`)).status, 405);

    const driver = hostingerDriver({ uploadUrl: `${url}/upload.php`, token, publicBase: url });
    const put = await driver.put("guide/01-a.png", png, { mime: "image/png" });
    assert.ok(put.ok, put.ok ? "" : put.message);
    if (!put.ok) return;
    assert.match(put.key, /^files\/\d{4}\/\d{2}\/[a-f0-9]{32}\.png$/);
    assert.equal(put.url, `${url}/${put.key}`);
    const got = await driver.get(put.key);
    assert.ok(got.ok && got.data.equals(png), "the public URL serves the same bytes");

    const bad = hostingerDriver({
      uploadUrl: `${url}/upload.php`,
      token: "q".repeat(64),
      publicBase: url,
    });
    assert.equal(((await bad.put("a.png", png)) as { reason: string }).reason, "rejected");

    for (const [name, data] of [
      ["shell.php", Buffer.from("<?php echo 1;")],
      ["disguised.png", Buffer.from("<?php echo 1; ?>")],
      ["image.gif", png], // extension and content disagree
      ["big.png", Buffer.concat([png, Buffer.alloc(25_000)])],
    ] as const) {
      const result = await driver.put(name, data);
      assert.equal(result.ok, false, name);
      assert.equal(!result.ok && result.reason, "rejected", name);
    }

    const removed = await driver.remove(put.key);
    assert.deepEqual(removed, { ok: true, removed: true });
    assert.deepEqual(await driver.remove(put.key), { ok: true, removed: false });
    assert.equal(
      ((await driver.remove("files/../config.php")) as { reason: string }).reason,
      "rejected",
    );
    const raw = await fetch(`${url}/delete.php`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ path: "files/../config.php" }),
    });
    assert.equal(raw.status, 400);
    assert.ok(existsSync(path.join(docroot, "config.php")));
  } finally {
    server.kill();
  }
});
