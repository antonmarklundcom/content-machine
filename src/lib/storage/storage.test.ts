import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { hostingerConfig, hostingerKeyFromUrl, isHostingerKey } from "./hostinger";
import { localDriver } from "./local";
import {
  assetFileName,
  captureFolder,
  higgsfieldInboxFolder,
  postAssetPath,
  postFolder,
  thumbnailPath,
} from "./paths";
import { mediaRootStatus, splitRelative, toRelative } from "./root";

/** [O10] The §1.41 folder layout, the path-safety rules and the local driver's typed results. */

const DATE = new Date("2026-09-27T10:00:00Z");

test("post folders follow <brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>", () => {
  assert.equal(
    postFolder({
      brandId: "guide",
      accountHandle: "@Paraguay.Residency",
      postId: 41,
      title: "5 Myths About Cédula!",
      date: DATE,
    }),
    "guide/paraguay-residency/2026-09/41-5-myths-about-cedula",
  );
  assert.equal(
    postFolder({ brandId: "guide", postId: 7, title: "", date: DATE }),
    "guide/_brand/2026-09/7-post",
  );
  assert.equal(
    postAssetPath(
      { brandId: "guide", accountHandle: null, postId: 7, title: "x", date: DATE },
      3,
      "Slide Three",
      ".PNG",
    ),
    "guide/_brand/2026-09/7-x/03-slide-three.png",
  );
  assert.equal(assetFileName(12, "../../etc/passwd", "sh/../x"), "12-etc-passwd.shx");
  assert.equal(higgsfieldInboxFolder(DATE), "_inbox/higgsfield/2026-09-27");
  assert.equal(captureFolder(99), "captures/99");
  assert.equal(thumbnailPath("AB".padEnd(64, "c")), `_thumbs/ab/${"ab".padEnd(64, "c")}.webp`);
});

test("a free-text segment can never be a dot-name or one of the app's _folders", () => {
  const folder = postFolder({
    brandId: "_inbox",
    accountHandle: "..",
    postId: 1,
    title: "..",
    date: DATE,
  });
  for (const part of folder.split("/")) {
    assert.ok(part !== "." && part !== "..", folder);
  }
  assert.equal(folder.split("/")[0], "inbox");
});

test("relative paths split into safe segments or not at all", () => {
  assert.deepEqual(splitRelative("a/b\\c.png"), ["a", "b", "c.png"]);
  assert.equal(splitRelative("a/../b"), null);
  assert.equal(splitRelative("C:/x"), null);
  assert.equal(splitRelative(""), null);
  assert.equal(toRelative("/root", "/root/a/b.png"), "a/b.png");
  assert.equal(toRelative("/root", "/elsewhere/b.png"), null);
});

test("the public endpoint's keys and URLs are recognised exactly", () => {
  const key = `files/2026/09/${"a".repeat(32)}.jpg`;
  assert.ok(isHostingerKey(key));
  assert.ok(!isHostingerKey("files/2026/09/../../config.php"));
  const config = {
    uploadUrl: "https://m.test/upload.php",
    token: "t".repeat(32),
    publicBase: "https://m.test",
  };
  assert.equal(hostingerKeyFromUrl(`https://m.test/${key}`, config), key);
  assert.equal(hostingerKeyFromUrl(`https://evil.test/${key}`, config), null);
  assert.equal(hostingerConfig({}), null);
  assert.deepEqual(
    hostingerConfig({
      MEDIA_UPLOAD_URL: "https://m.test/upload.php",
      MEDIA_UPLOAD_TOKEN: "x",
      MEDIA_PUBLIC_BASE: "https://m.test/",
    }),
    { uploadUrl: "https://m.test/upload.php", token: "x", publicBase: "https://m.test" },
  );
});

test("the local driver answers missing for an absent root and never writes outside it", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "ce-storage-"));
  try {
    const absent = path.join(base, "unplugged");
    assert.equal(await mediaRootStatus(absent), "missing");
    const offline = localDriver(absent);
    for (const result of [
      await offline.put("a.png", Buffer.from("x")),
      await offline.get("a.png"),
      await offline.exists("a.png"),
      await offline.remove("a.png"),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, "missing");
    }

    const root = path.join(base, "root");
    mkdirSync(root);
    const outside = path.join(base, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.equal(await mediaRootStatus(root), "ok");
    const driver = localDriver(root);

    const put = await driver.put("guide/_brand/2026-09/1-x/01-a.png", Buffer.from("hello"));
    assert.deepEqual(put, { ok: true, key: "guide/_brand/2026-09/1-x/01-a.png", bytes: 5 });
    const again = await driver.put("guide/_brand/2026-09/1-x/01-a.png", Buffer.from("other"));
    assert.equal(!again.ok && again.reason, "rejected", "no silent overwrite");
    const got = await driver.get("guide/_brand/2026-09/1-x/01-a.png");
    assert.equal(got.ok && got.data.toString(), "hello");

    for (const key of ["../outside/x.png", "escape/x.png", "a/../../x.png", "C:/x.png"]) {
      const result = await driver.put(key, Buffer.from("x"));
      assert.equal(result.ok, false, key);
    }
    assert.ok(!existsSync(path.join(outside, "x.png")), "nothing written through the symlink");
    const nested = await driver.put("escape/newdir/x.png", Buffer.from("x"));
    assert.equal(nested.ok, false);
    assert.ok(!existsSync(path.join(outside, "newdir")), "no folder created through the symlink");
    writeFileSync(path.join(outside, "secret.png"), "secret");
    const leaked = await driver.get("escape/secret.png");
    assert.equal(!leaked.ok && leaked.reason, "not_found");

    assert.deepEqual(await driver.exists("nope.png"), { ok: true, exists: false });
    assert.deepEqual(await driver.remove("guide/_brand/2026-09/1-x/01-a.png"), {
      ok: true,
      removed: true,
    });
    assert.deepEqual(await driver.remove("guide/_brand/2026-09/1-x/01-a.png"), {
      ok: true,
      removed: false,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("local storage refuses a file symlink overwrite", async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "ce-file-link-"));
  try {
    const root = path.join(base, "root"),
      outside = path.join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    try {
      symlinkSync(path.join(outside, "target.png"), path.join(root, "link.png"), "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")
      ) {
        t.skip(
          "Windows file symlinks require Developer Mode or privilege; directory junction containment is covered separately.",
        );
        return;
      }
      throw error;
    }
    const result = await localDriver(root).put("link.png", Buffer.from("x"), { overwrite: true });
    assert.equal(!result.ok && result.reason, "rejected");
    assert.ok(!existsSync(path.join(outside, "target.png")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("interrupted writes leave no final file and preserve an overwritten original", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "cm-atomic-write-"));
  const write = fsPromises.writeFile;
  try {
    writeFileSync(path.join(root, "existing.pdf"), "original complete bytes");
    t.mock.method(fsPromises, "writeFile", async (file: Parameters<typeof write>[0]) => {
      if (String(file).endsWith(".partial")) {
        await write(file, "%PDF-truncated");
        assert.equal(existsSync(path.join(root, "new.pdf")), false, "active bytes are not final");
        throw new Error("injected write interruption");
      }
      throw new Error("unexpected direct write");
    });
    syncBuiltinESMExports();
    const driver = localDriver(root);
    assert.equal((await driver.put("new.pdf", Buffer.from("complete new bytes"))).ok, false);
    assert.equal(
      (await driver.put("existing.pdf", Buffer.from("replacement"), { overwrite: true })).ok,
      false,
    );
    assert.equal(existsSync(path.join(root, "new.pdf")), false);
    assert.equal(
      (await driver.get("existing.pdf")).ok &&
        (await fsPromises.readFile(path.join(root, "existing.pdf"), "utf8")),
      "original complete bytes",
    );
    assert.deepEqual(
      await fsPromises.readdir(root),
      ["existing.pdf"],
      "failed staging was removed",
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("short or changed staged bytes are rejected even when a writer reports success", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "cm-atomic-short-"));
  const write = fsPromises.writeFile;
  try {
    t.mock.method(fsPromises, "writeFile", async (file: Parameters<typeof write>[0]) => {
      await write(file, "WRONG");
    });
    syncBuiltinESMExports();
    const driver = localDriver(root);
    assert.equal(
      (await driver.put("same-size.pdf", Buffer.from("RIGHT"))).ok,
      false,
      "hash detects equal-size corruption",
    );
    assert.equal(
      (await driver.put("short.pdf", Buffer.from("much longer intended bytes"))).ok,
      false,
    );
    assert.deepEqual(await fsPromises.readdir(root), []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed copy leaves no final residue; competing promotions preserve one complete winner", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "cm-atomic-copy-"));
  try {
    const source = path.join(root, "source.pdf");
    await fsPromises.writeFile(source, "complete source");
    t.mock.method(
      fsPromises,
      "copyFile",
      async (
        _source: Parameters<typeof fsPromises.copyFile>[0],
        target: Parameters<typeof fsPromises.copyFile>[1],
      ) => {
        await fsPromises.writeFile(target, "partial copy");
        throw new Error("injected copy interruption");
      },
    );
    syncBuiltinESMExports();
    const driver = localDriver(root);
    assert.equal((await driver.put("copied.pdf", { file: source })).ok, false);
    assert.equal(existsSync(path.join(root, "copied.pdf")), false);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    const results = await Promise.all([
      driver.put("winner.pdf", Buffer.from("first complete version")),
      driver.put("winner.pdf", Buffer.from("second complete version")),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok && result.reason === "rejected").length, 1);
    const bytes = await fsPromises.readFile(path.join(root, "winner.pdf"), "utf8");
    assert.ok(["first complete version", "second complete version"].includes(bytes));
    assert.deepEqual((await fsPromises.readdir(root)).sort(), ["source.pdf", "winner.pdf"]);
    assert.equal(
      (await driver.put("winner.pdf", Buffer.from("new immutable version"), { overwrite: true }))
        .ok,
      true,
    );
    assert.equal(
      await fsPromises.readFile(path.join(root, "winner.pdf"), "utf8"),
      "new immutable version",
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("filesystems without hard links promote complete bytes without replacing an existing file", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "cm-atomic-exfat-"));
  try {
    t.mock.method(fsPromises, "link", async () => {
      throw Object.assign(new Error("simulated exFAT"), { code: "ENOTSUP" });
    });
    syncBuiltinESMExports();
    const driver = localDriver(root);
    const saved = await driver.put("complete.pdf", Buffer.from("complete immutable bytes"));
    assert.equal(saved.ok, true);
    const collision = await driver.put("complete.pdf", Buffer.from("different replacement"));
    assert.equal(!collision.ok && collision.reason, "rejected");
    assert.equal(
      await fsPromises.readFile(path.join(root, "complete.pdf"), "utf8"),
      "complete immutable bytes",
    );
    const competing = await Promise.all([
      driver.put("race.pdf", Buffer.from("first full output")),
      driver.put("race.pdf", Buffer.from("second full output")),
    ]);
    assert.equal(competing.filter((outcome) => outcome.ok).length, 1);
    const winner = await fsPromises.readFile(path.join(root, "race.pdf"), "utf8");
    assert.ok(["first full output", "second full output"].includes(winner));
    assert.deepEqual((await fsPromises.readdir(root)).sort(), ["complete.pdf", "race.pdf"]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
