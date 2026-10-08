import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { GET as serveMedia } from "@/app/api/media/[...path]/route";
import { GET as exportScript } from "@/app/api/scripts/[id]/export/route";
import { getScript } from "@/lib/bridge/scripts";
import { readListing, writeListingScript } from "@/lib/listing.actions";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import type { ThumbnailList } from "@/lib/scripts/export";
import { LISTING_PHOTO_PREFIX, LISTING_SOURCE_ID } from "@/lib/studio/listing";
import { listThumbnails } from "@/lib/studio/media";
import { chooseThumbnail } from "@/lib/thumbnails.actions";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Build 2b · D (ideas 8 and 10): a listing becomes a draft script through the
 * Gemini fake; its thumbnails export; the media route serves only what is
 * under the media root; "Use this one" stores the pick.
 */

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

/** Run a server action as the signed-in holder of `cookie` (the studio-ui.test.ts harness). */
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
    new Request("http://localhost/studio/listing", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

const PROPIA = {
  id: "propia",
  name: "Propia (real estate)",
  domain: "propia.com.py",
  niche: "Paraguay real estate listings, buying/investing for foreigners and locals",
  market: "paraguay",
  language: "es",
  voice: "Aspirational but concrete.",
  platforms: ["instagram", "tiktok", "facebook"],
};

const LISTING = {
  url: "https://propia.com.py/propiedad/depto-villa-morra",
  title: "Departamento de 2 dormitorios en Villa Morra",
  description: "Luminoso, a 3 cuadras del shopping.",
  price: "185000",
  currency: "USD",
  address: "Senador Long 1234, Asunción",
  rooms: "2",
  bathrooms: "2",
  area: "98 m²",
  images: ["https://cdn.propia.com.py/1.jpg", "https://cdn.propia.com.py/2.jpg"],
  notes: "",
};

let owner = "";
let employee = "";
let mediaDir = "";
let outside = "";
let evilJunctionAvailable = false;
let linkedJunctionAvailable = false;

function createJunction(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath, "junction");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) {
      return false;
    }
    throw error;
  }
}

before(() => {
  const base = mkdtempSync(path.join(tmpdir(), "b2b-d-"));
  mediaDir = path.join(base, "media");
  outside = path.join(base, "outside");
  mkdirSync(path.join(mediaDir, "7", "thumbnails"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(mediaDir, "7", "thumbnails", "1.png"), "png-one");
  writeFileSync(path.join(mediaDir, "7", "thumbnails", "1-2.png"), "png-two");
  writeFileSync(path.join(mediaDir, "7", "thumbnails", "notes.txt"), "not media");
  writeFileSync(path.join(outside, "secret.png"), "secret");
  // Windows does not allow file symlinks without Developer Mode/admin rights.
  // Directory junctions exercise the same realpath containment boundary.
  evilJunctionAvailable = createJunction(
    outside,
    path.join(mediaDir, "7", "thumbnails", "evil.png"),
  );
  linkedJunctionAvailable = createJunction(outside, path.join(mediaDir, "7", "linked"));
  process.env.MEDIA_ROOT = mediaDir;
});

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "5";
  await resetTables();
  await db.insert(schema.brands).values(PROPIA);
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  delete process.env.MEDIA_ROOT;
  rmSync(path.dirname(mediaDir), { recursive: true, force: true });
  await teardown();
});

function media(segments: string[], cookie: string): Promise<Response> {
  return callRoute(
    (r) => serveMedia(r, { params: Promise.resolve({ path: segments }) }),
    new Request(`http://localhost/api/media/${segments.join("/")}`, { headers: { cookie } }),
  );
}

async function draftFromListing(): Promise<{ id: number; body: ScriptBodyV1 }> {
  const result = await as(owner, () =>
    writeListingScript({ brandId: "propia", mode: "short", listing: LISTING }),
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  const row = (await getScript(result.id))!;
  return { id: row.id, body: row.body as ScriptBodyV1 };
}

test("a listing becomes a draft short for propia: photos first, 9:16, the listing cited and flagged", async () => {
  const { id, body } = await draftFromListing();
  const row = (await getScript(id))!;
  assert.equal(row.status, "draft");
  assert.equal(row.brandId, "propia");
  assert.equal(row.language, "en", "real estate defaults to English (§1.33)");
  assert.equal(row.title, body.chosenTitle);
  assert.deepEqual(validateScriptBody(body), { ok: true });
  assert.equal(body.targetMinutes, 1.5);

  const shots = [...body.hook.broll, ...body.sections.flatMap((s) => s.broll)];
  assert.ok(shots.length >= 2);
  assert.equal(shots[0].imagePrompt, `${LISTING_PHOTO_PREFIX}${LISTING.images[0]}`);
  assert.equal(shots[1].imagePrompt, `${LISTING_PHOTO_PREFIX}${LISTING.images[1]}`);
  assert.ok(
    shots.slice(2).every((s) => !s.imagePrompt.startsWith(LISTING_PHOTO_PREFIX)),
    "Higgsfield only beyond the photos",
  );
  assert.ok(shots.every((s) => s.aspectRatio === "9:16"));

  const source = body.sources.find((s) => s.id === LISTING_SOURCE_ID);
  assert.equal(source?.url, LISTING.url);
  assert.equal(source?.verifyBeforeRecording, true);
});

test("writing is owner-only and refuses an empty listing; reading refuses a LAN address without fetching", async () => {
  const denied = await as(employee, () =>
    writeListingScript({ brandId: "propia", mode: "tour", listing: LISTING }),
  );
  assert.deepEqual(denied, {
    ok: false,
    error: "Writing a script spends money, which is the owner's to spend.",
  });
  const empty = await as(owner, () =>
    writeListingScript({ brandId: "propia", mode: "tour", listing: {} }),
  );
  assert.equal(empty.ok, false);
  const badMode = await as(owner, () =>
    writeListingScript({ brandId: "propia", mode: "reel" as "tour", listing: LISTING }),
  );
  assert.equal(badMode.ok, false);
  assert.equal((await db.select().from(schema.scripts)).length, 0, "nothing saved");

  const lan = await as(employee, () => readListing("http://192.168.1.10/listing"));
  assert.equal(lan.ok, false);
});

test("export format=thumbnails: numbered 16:9 prompts with overlays, as Markdown or JSON", async () => {
  const { id, body } = await draftFromListing();
  const call = (query: string) =>
    callRoute(
      (r) => exportScript(r, { params: Promise.resolve({ id: String(id) }) }),
      new Request(`http://localhost/api/scripts/${id}/export?${query}`, {
        headers: { cookie: employee },
      }),
    );

  const json = await call("format=thumbnails&as=json");
  assert.equal(json.status, 200);
  const list = (await json.json()) as ThumbnailList;
  assert.equal(list.thumbnails.length, 3);
  assert.equal(list.thumbnails[0].file, `media/${id}/thumbnails/1.png`);
  assert.equal(list.thumbnails[0].textOverlay, body.thumbnailConcepts[0].textOverlay);
  assert.ok(list.thumbnails.every((t) => t.aspectRatio === "16:9" && t.variants.length === 2));

  const md = await call("format=thumbnails&download=1");
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(md.headers.get("content-disposition") ?? "", /-thumbnails\.md"/);
  assert.match(await md.text(), /^# Thumbnails — /);
});

test("the media route serves files under the media root to signed-in authors", async () => {
  const ok = await media(["7", "thumbnails", "1.png"], owner);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(await ok.text(), "png-one");

  const employeeResponse = await media(["7", "thumbnails", "1.png"], employee);
  assert.equal(employeeResponse.status, 200);
  assert.equal(await employeeResponse.text(), "png-one");
  assert.equal((await media(["7", "thumbnails", "1.png"], "")).status, 401);
});

test("the media route rejects traversal, absolute paths, separators, directories and other types", async () => {
  const attempts: string[][] = [
    ["..", "outside", "secret.png"],
    ["7", "..", "..", "outside", "secret.png"],
    ["7", "thumbnails", "..", "..", "..", "outside", "secret.png"],
    [path.join(outside, "secret.png")], // an absolute path as one segment
    ["/etc/passwd"],
    ["C:", "Windows", "win.ini"],
    ["7", "thumbnails", "..\\..\\..\\outside\\secret.png"],
    ["7/thumbnails/1.png"], // a separator inside a segment
    ["7", "thumbnails", "1.png\0.txt"],
    ["7", "thumbnails"], // a directory
    ["7", "thumbnails", "notes.txt"], // not a media type
    ["7", "thumbnails", "missing.png"],
    [],
  ];
  for (const segments of attempts) {
    const response = await media(segments, owner);
    assert.equal(response.status, 404, JSON.stringify(segments));
    assert.doesNotMatch(await response.text(), /secret/);
  }
});

test("the media route rejects directory junctions that escape the media root", async (t) => {
  if (!evilJunctionAvailable && !linkedJunctionAvailable) {
    t.skip("Windows denied junction creation; other path-containment cases still run");
    return;
  }
  if (evilJunctionAvailable) {
    assert.equal((await media(["7", "thumbnails", "evil.png"], owner)).status, 404);
  }
  if (linkedJunctionAvailable) {
    assert.equal((await media(["7", "linked", "secret.png"], owner)).status, 404);
  }
});

test("“Use this one” stores a file from the folder, refuses anything else, and clears", async () => {
  // Reserve six stable fixture ids so the generated draft's media folder is 7
  // on MariaDB as it was in the original PostgreSQL fixture.
  await db.insert(schema.scripts).values(
    Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      brandId: "sequence-fixture",
      title: `Reserved ${index + 1}`,
      language: "en",
      body: { version: 1 },
    })),
  );
  const { id } = await draftFromListing();
  assert.equal(id, 7, "the script whose media folder the fixture made");

  assert.deepEqual(
    await listThumbnails(id),
    ["1.png", "1-2.png"],
    "images only, no symlinks, first variant first",
  );
  const stored = await as(owner, () => chooseThumbnail(id, "1-2.png"));
  assert.equal(stored, "media/7/thumbnails/1-2.png");
  assert.equal((await getScript(id))!.thumbnailFile, "media/7/thumbnails/1-2.png");

  for (const bad of ["../../outside/secret.png", "evil.png", "notes.txt", "9.png"]) {
    await assert.rejects(
      as(owner, () => chooseThumbnail(id, bad)),
      /not in this script's thumbnails folder/,
      bad,
    );
  }
  await assert.rejects(
    as(employee, () => chooseThumbnail(id, "1.png")),
    /Only the owner/,
  );

  assert.equal(await as(owner, () => chooseThumbnail(id, null)), null);
  assert.equal((await getScript(id))!.thumbnailFile, null);
});
