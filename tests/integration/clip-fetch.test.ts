import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { fakeGeminiClient } from "@/lib/ai-fake";
import {
  fetchClipAction,
  saveClaimAsFactAction,
  saveHookFromClipAction,
} from "@/lib/clip-fetch.actions";
import { resetBinaries } from "@/lib/clips/fetch/binaries";
import { eligibleClipIds, fetchClip, fetchEligibleClips } from "@/lib/clips/fetch";
import { monthToDateUsd } from "@/lib/spend";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * S17 exit (PLAN.md §6.S17): fetch + transcribe against a fake yt-dlp binary
 * (`tests/fixtures/fake-yt-dlp.mjs`) and the Gemini fake — no network. Covers
 * the §1.44 eligibility rule, the missing-binary and missing-drive refusals,
 * the Telegram file_id path against a local Bot API stub, and the page's
 * actions.
 */

const FAKE = path.resolve("tests/fixtures/fake-yt-dlp.mjs");
const ENV_KEYS = [
  "MEDIA_ROOT",
  "YTDLP_PATH",
  "FFMPEG_PATH",
  "YTDLP_COOKIES_FILE",
  "FAKE_YTDLP_LOG",
  "FAKE_YTDLP_MODE",
  "FAKE_YTDLP_BYTES",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_API_BASE",
  "MONTHLY_SPEND_CAP_USD",
];

let base = "";
let root = "";
let log = "";
let owner = "";
let employee = "";
const realExecFile = childProcess.execFile;

function routeWindowsYtDlpThroughNode() {
  const configured = process.env.YTDLP_PATH;
  childProcess.execFile = ((...callArgs: unknown[]) => {
    const [file, args] = callArgs;
    if (
      process.platform === "win32" &&
      file === configured &&
      typeof file === "string" &&
      Array.isArray(args)
    ) {
      callArgs[0] = process.execPath;
      callArgs[1] = [FAKE, ...args];
    }
    return Reflect.apply(realExecFile, childProcess, callArgs) as ReturnType<typeof realExecFile>;
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
}

function restoreExecFile() {
  childProcess.execFile = realExecFile;
  syncBuiltinESMExports();
}

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/clips/1", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetBinaries();
  base = mkdtempSync(path.join(tmpdir(), "s17-"));
  root = path.join(base, "drive");
  rmSync(root, { recursive: true, force: true });
  (await import("node:fs")).mkdirSync(root);
  log = path.join(base, "yt-dlp.log");
  const bin = path.join(base, "yt-dlp");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  if (process.platform !== "win32") chmodSync(bin, 0o755);
  process.env.MEDIA_ROOT = root;
  process.env.YTDLP_PATH = bin;
  // Windows execFile cannot launch .cmd scripts. Keep exercising the same
  // fake CLI process and arguments by routing that one configured path through
  // node.exe; this is a test adapter, not a change to the production runner.
  routeWindowsYtDlpThroughNode();
  // Pin "no ffmpeg" so the test is the same on a machine that has one.
  process.env.FFMPEG_PATH = path.join(base, "no-ffmpeg");
  process.env.FAKE_YTDLP_LOG = log;
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values({
    id: "guide",
    name: "Guide",
    domain: "guide.example",
    niche: "residency",
    market: "paraguay",
    platforms: ["instagram"],
  });
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});

afterEach(() => {
  restoreExecFile();
  if (base) rmSync(base, { recursive: true, force: true });
});

after(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  await teardown();
});

async function clip(values: Partial<typeof schema.clips.$inferInsert> & { url: string }) {
  const [row] = await insertReturning(db, schema.clips, { platform: "instagram", ...values });
  return row;
}

async function reload(id: number) {
  const [row] = await db.select().from(schema.clips).where(eq(schema.clips.id, id));
  return row;
}

function ytdlpCalls(): string[][] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as string[])
    : [];
}

test("fetchClip downloads with yt-dlp, registers the asset and stores the transcript", async () => {
  const cookies = path.join(base, "cookies.txt");
  writeFileSync(cookies, "# Netscape HTTP Cookie File\n");
  process.env.YTDLP_COOKIES_FILE = cookies;
  const c = await clip({
    url: "https://www.instagram.com/reel/ABC/",
    purpose: "fact_check",
    brandId: "guide",
    note: "45 days? check",
  });

  const outcome = await fetchClip(c.id);
  assert.equal(outcome.status, "done", JSON.stringify(outcome));
  assert.equal(outcome.status === "done" && outcome.downloaded, true);

  const [args] = ytdlpCalls();
  assert.ok(args.includes("--no-playlist"));
  assert.equal(args[args.indexOf("--cookies") + 1], cookies);
  assert.equal(args[args.indexOf("-f") + 1], "b[ext=mp4]/b", "no ffmpeg: single-file format");
  assert.equal(args.at(-1), c.url);

  const row = await reload(c.id);
  assert.match(row.transcript ?? "", /cuarenta y cinco días/);
  assert.equal(row.postText, "RESIDENCIA EN 45 DÍAS | Comentá GUIA");
  assert.match(row.summary ?? "", /45 days/);
  assert.deepEqual(row.claims?.[0], {
    claim: "Paraguayan residency takes 45 days.",
    timestampSec: 4,
  });
  assert.ok(row.fetchedAt);
  assert.equal(row.error, null);
  assert.equal(row.status, "unprocessed", "status belongs to the YouTube pipeline");

  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, row.mediaAssetId!));
  assert.equal(asset.localPath, `_originals/${asset.sha256.slice(0, 2)}/${asset.sha256}.mp4`);
  assert.equal(asset.kind, "video");
  assert.equal(asset.source, "capture");
  assert.equal(asset.sourceRef, c.url);
  assert.equal(asset.brandId, "guide");
  assert.deepEqual(asset.tags, ["research", "fact_check"]);

  const [call] = fakeGeminiClient().callsOf("generateContent");
  assert.equal(call.responseKind, "transcript");
  const parts = (
    call.params as { contents: { parts: { inlineData?: { data: string }; text?: string }[] }[] }
  ).contents[0].parts;
  const sent = Buffer.from(parts[0].inlineData!.data, "base64");
  assert.deepEqual(sent, readFileSync(path.join(root, asset.localPath!)));
  assert.match(parts[1].text!, /45 days\? check/);
  assert.match(parts[1].text!, /Comment GUIA for the guide/, "yt-dlp's caption is context");
  assert.ok((await monthToDateUsd()) > 0, "the call is billed");

  // Re-run: the media is on the drive, so no second download — just a new transcript.
  const again = await fetchClip(c.id);
  assert.equal(again.status === "done" && again.downloaded, false);
  assert.equal(ytdlpCalls().length, 1);
  assert.equal((await db.select().from(schema.assets)).length, 1);
});

test("the batch job takes only fact_check and competitor clips, and leaves failed ones for a click", async () => {
  const inspo = await clip({ url: "https://www.instagram.com/reel/I/", purpose: "inspo" });
  const own = await clip({
    url: "https://www.tiktok.com/@me/video/1",
    platform: "other",
    purpose: "own",
  });
  const fact = await clip({ url: "https://www.instagram.com/reel/F/", purpose: "fact_check" });
  const comp = await clip({
    url: "https://www.tiktok.com/@x/video/2",
    platform: "other",
    purpose: "competitor",
  });
  const failed = await clip({
    url: "https://www.instagram.com/reel/E/",
    purpose: "competitor",
    error: "earlier",
  });

  assert.deepEqual(await eligibleClipIds(), [fact.id, comp.id]);
  const result = await fetchEligibleClips();
  assert.deepEqual(
    result.outcomes.map((o) => [o.clipId, o.status]),
    [
      [fact.id, "done"],
      [comp.id, "done"],
    ],
  );
  assert.equal(result.stoppedEarly, null);
  for (const skipped of [inspo, own, failed]) {
    assert.equal((await reload(skipped.id)).fetchedAt, null);
  }
  assert.deepEqual(await eligibleClipIds({ retryFailed: true }), [failed.id]);
  assert.deepEqual(await eligibleClipIds(), [], "fetched clips are not taken again");
});

test("a missing yt-dlp fails the clip with a clear error and spends nothing", async () => {
  process.env.YTDLP_PATH = path.join(base, "not-installed");
  const c = await clip({
    url: "https://www.instagram.com/reel/M/",
    purpose: "fact_check",
    note: "keep me",
  });
  const outcome = await fetchClip(c.id);
  assert.equal(outcome.status, "failed");
  const row = await reload(c.id);
  assert.match(row.error ?? "", /yt-dlp is not installed.*YTDLP_PATH/);
  assert.equal(row.note, "keep me", "the URL + note floor stays");
  assert.equal(row.transcript, null);
  assert.equal(fakeGeminiClient().callsOf("generateContent").length, 0);
  assert.equal(await monthToDateUsd(), 0);
});

test("yt-dlp errors, empty downloads and oversize files each become the clip's error", async () => {
  const c = await clip({ url: "https://www.instagram.com/reel/X/", purpose: "competitor" });

  process.env.FAKE_YTDLP_MODE = "fail";
  await fetchClip(c.id);
  assert.match(
    (await reload(c.id)).error ?? "",
    /^yt-dlp failed: ERROR: \[Instagram\].*login required/,
  );

  process.env.FAKE_YTDLP_MODE = "nothing";
  await fetchClip(c.id);
  assert.match((await reload(c.id)).error ?? "", /downloaded nothing/);

  // Past the 14 MB inline limit with no ffmpeg to shrink it: registered, but not transcribed.
  delete process.env.FAKE_YTDLP_MODE;
  process.env.FAKE_YTDLP_BYTES = String(15 * 1024 * 1024);
  await fetchClip(c.id);
  const row = await reload(c.id);
  assert.match(row.error ?? "", /must be shrunk.*ffmpeg is not installed/);
  assert.ok(row.mediaAssetId, "the download is kept as an asset");
  assert.equal(row.fetchedAt, null);
  assert.equal(fakeGeminiClient().callsOf("generateContent").length, 0);
});

test("an unplugged drive is 'missing' and leaves the clip untouched", async () => {
  process.env.MEDIA_ROOT = path.join(base, "unplugged");
  const c = await clip({ url: "https://www.instagram.com/reel/U/", purpose: "fact_check" });
  const outcome = await fetchClip(c.id);
  assert.equal(outcome.status, "missing");
  const row = await reload(c.id);
  assert.equal(row.error, null);
  assert.equal(ytdlpCalls().length, 0);

  const batch = await fetchEligibleClips();
  assert.ok(batch.stoppedEarly, "the batch stops at the first missing drive");
});

test("a Telegram file_id is downloaded through the Bot API, not yt-dlp", async () => {
  const video = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypmp42"), 0, 0, 0, 0]),
    Buffer.alloc(2048, 3),
  ]);
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(req.url ?? "");
    if (req.url?.startsWith("/botTOKEN/getFile")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          result: { file_path: "videos/file_1.mp4", file_size: video.length },
        }),
      );
    } else if (req.url === "/file/botTOKEN/videos/file_1.mp4") {
      res.end(video);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const c = await clip({
      url: "https://t.me/c/1/2",
      platform: "other",
      source: "telegram",
      purpose: "fact_check",
      telegramFileId: "AgAD-file",
    });
    const outcome = await fetchClip(c.id);
    assert.equal(outcome.status, "done", JSON.stringify(outcome));
    assert.equal(ytdlpCalls().length, 0);
    assert.equal(seen[0], "/botTOKEN/getFile?file_id=AgAD-file");
    const [asset] = await db.select().from(schema.assets);
    assert.equal(asset.source, "telegram");
    assert.equal(asset.localPath, `_originals/${asset.sha256.slice(0, 2)}/${asset.sha256}.mp4`);
    assert.deepEqual(readFileSync(path.join(root, asset.localPath!)), video);

    // No token: a clear error, never a URL with a token in it.
    delete process.env.TELEGRAM_BOT_TOKEN;
    const c2 = await clip({
      url: "https://t.me/c/1/3",
      purpose: "fact_check",
      telegramFileId: "x",
    });
    await fetchClip(c2.id);
    assert.match((await reload(c2.id)).error ?? "", /TELEGRAM_BOT_TOKEN is not set/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the clip page actions: owner fetches any purpose; facts are owner-only; hooks are lessons", async () => {
  const c = await clip({
    url: "https://www.instagram.com/reel/P/",
    purpose: "inspo",
    brandId: "guide",
  });

  const refused = await as(employee, () => fetchClipAction(c.id));
  assert.deepEqual(refused, { ok: false, error: "Only the owner can fetch clips." });
  assert.equal(ytdlpCalls().length, 0);

  const done = await as(owner, () => fetchClipAction(c.id));
  assert.equal(done.ok, true, JSON.stringify(done));
  const row = await reload(c.id);
  assert.ok(row.fetchedAt, "a click fetches even an inspo clip (§1.44)");

  const claim = row.claims![0].claim;
  assert.equal(
    (
      await as(employee, () =>
        saveClaimAsFactAction({ clipId: c.id, text: claim, brandId: "guide" }),
      )
    ).ok,
    false,
  );
  const saved = await as(owner, () =>
    saveClaimAsFactAction({ clipId: c.id, text: claim, brandId: "guide", topic: "timelines" }),
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const [fact] = await db.select().from(schema.facts);
  assert.equal(fact.claim, claim);
  assert.equal(fact.topic, "timelines");
  assert.equal(fact.sourceUrl, c.url);
  assert.equal(fact.verified, false);
  assert.equal(
    (await as(owner, () => saveClaimAsFactAction({ clipId: c.id, text: claim, brandId: "nope" })))
      .ok,
    false,
  );

  const hook = await as(employee, () =>
    saveHookFromClipAction({
      clipId: c.id,
      text: "Nobody tells you this about residency",
      brandId: "",
    }),
  );
  assert.equal(hook.ok, true, JSON.stringify(hook));
  const [lesson] = await db.select().from(schema.lessons);
  assert.equal(lesson.kind, "hook");
  assert.equal(lesson.brandId, null);
  assert.equal(lesson.sourceUrl, c.url);
  assert.equal(
    (await as(owner, () => saveHookFromClipAction({ clipId: c.id, text: " ", brandId: "" }))).ok,
    false,
  );
});
