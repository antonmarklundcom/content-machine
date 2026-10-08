import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as serveArt } from "@/app/api/stories/art/[slug]/[scene]/route";
import { getScene, getStory, listScenes } from "@/lib/stories/data";
import { importStories } from "@/lib/stories/import";
import { readSceneMeta } from "@/lib/stories/meta";
import { approveSceneText, StoryError } from "@/lib/stories/studio";

import { makeCuentosRoot, SLUG, treeHashes } from "./b4-c-fakes";
import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase C (build 4 §3.C.2, §3.C.8): the importer upserts stories and scenes
 * from a temp CUENTOS_ROOT without writing to it, re-import keeps in-app
 * approvals unless the repo moved, and the art route only serves the scene's
 * own art from inside the root.
 */

let root = "";
const storyFile = () => path.join(root, "books", SLUG, "story.json");

beforeEach(async () => {
  await resetTables();
  root = await makeCuentosRoot();
  process.env.CUENTOS_ROOT = root;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.CUENTOS_ROOT;
});

after(teardown);

test("import creates the story and its scenes, reads art sizes, and never writes to CUENTOS_ROOT", async () => {
  const before = treeHashes(root);
  const report = await importStories();
  assert.deepEqual(treeHashes(root), before, "import is read-only on CUENTOS_ROOT");

  assert.equal(report.results.length, 1);
  const r = report.results[0];
  assert.equal(r.status, "created");
  assert.ok(
    r.warnings.some((w) => w.startsWith("S04")),
    "S04's missing art is reported",
  );

  const story = await getStory(SLUG);
  assert.ok(story);
  assert.equal(story.title, "Tito y el salto chiquito");
  assert.equal(story.series, "Tito");
  assert.equal(story.ageBand, "3-5");
  assert.equal(story.sourcePath, `books/${SLUG}`);
  assert.equal(story.sourceSha?.length, 64);
  assert.deepEqual(story.languages, ["es", "gn", "en"]);
  assert.equal((story.raw as { title: string }).title, story.title);

  const scenes = await listScenes(story.id);
  assert.deepEqual(
    scenes.map((s) => s.sceneRef),
    ["S01", "S02", "S03", "S04"],
  );
  assert.equal(scenes[0].artPath, `books/${SLUG}/art/S01-a.png`);
  assert.equal(scenes[0].artWidth, 80);
  assert.equal(scenes[0].artHeight, 100);
  assert.equal(scenes[3].artPath, null);
  assert.equal(scenes[1].lines.es?.length, 2);
  assert.equal(scenes[0].text.gn, "Tito ha'e peteĩ kururu'i michĩ.");

  // A second import with nothing changed is "unchanged".
  const again = await importStories();
  assert.equal(again.results[0].status, "unchanged");
});

test("re-import keeps an in-app approval until the repo's status or text changes", async () => {
  await importStories();
  await approveSceneText(SLUG, "S03", "es", "anton@example.com");
  const story = (await getStory(SLUG))!;
  let s3 = (await getScene(story.id, "S03"))!;
  assert.equal(s3.textStatus.es, "approved-in-app");
  assert.equal(readSceneMeta(s3.notes).approvals?.es?.by, "anton@example.com");
  assert.equal(readSceneMeta(s3.notes).approvals?.es?.repoStatus, "pending-review");

  // Nothing changed in the repo: kept.
  const kept = await importStories();
  assert.deepEqual(kept.results[0].approvalsKept, ["S03 es"]);
  s3 = (await getScene(story.id, "S03"))!;
  assert.equal(s3.textStatus.es, "approved-in-app");

  // The repo moved S03 to "draft": the in-app approval goes, the repo's status shows.
  const json = JSON.parse(readFileSync(storyFile(), "utf8"));
  json.pages[2].textStatus = { es: "draft" };
  writeFileSync(storyFile(), JSON.stringify(json));
  const dropped = await importStories(SLUG);
  assert.equal(dropped.results[0].status, "updated");
  assert.match(dropped.results[0].approvalsDropped[0], /^S03 es \(repo status changed/);
  s3 = (await getScene(story.id, "S03"))!;
  assert.equal(s3.textStatus.es, "draft");
  assert.equal(readSceneMeta(s3.notes).approvals, undefined);
});

test("in-app approval refuses missing text and pending-review notices", async () => {
  await importStories();
  await assert.rejects(
    approveSceneText(SLUG, "S02", "gn", "anton"),
    (e: unknown) => e instanceof StoryError,
  );
  await assert.rejects(approveSceneText(SLUG, "S04", "es", "anton"), /pending-review notice/);
  await assert.rejects(approveSceneText(SLUG, "S04", "gn", "anton"), /pending-review notice/);
  assert.equal(await approveSceneText(SLUG, "S01", "es", "anton"), "already");
});

test("scenes added and removed in story.json are reported on re-import", async () => {
  await importStories();
  const json = JSON.parse(readFileSync(storyFile(), "utf8"));
  json.pages.pop();
  json.pages.push({ id: "S05", text: { es: "Y colorín colorado." }, textStatus: "approved" });
  writeFileSync(storyFile(), JSON.stringify(json));
  const r = (await importStories()).results[0];
  assert.deepEqual(r.scenesAdded, ["S05"]);
  assert.deepEqual(r.scenesRemoved, ["S04"]);
});

test("a broken story.json is a failed result, not a crash", async () => {
  mkdirSync(path.join(root, "books", "roto"), { recursive: true });
  writeFileSync(path.join(root, "books", "roto", "story.json"), "{ nope");
  const report = await importStories();
  const roto = report.results.find((r) => r.slug === "roto");
  assert.equal(roto?.status, "failed");
  assert.match(roto?.error ?? "", /not valid JSON/);
  assert.equal(report.results.find((r) => r.slug === SLUG)?.status, "created");
});

test("art route: owner only, the scene's own art, never outside CUENTOS_ROOT", async () => {
  await importStories();
  const owner = (await signIn("owner")).cookie;
  const employee = (await signIn("employee")).cookie;
  const get = (scene: string, cookie: string, query = "") =>
    callRoute(
      (req) => serveArt(req, { params: Promise.resolve({ slug: SLUG, scene }) }),
      new Request(`http://localhost/api/stories/art/${SLUG}/${scene}${query}`, {
        headers: { cookie },
      }),
    );

  const ok = await get("S01", owner);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  const thumb = await get("S01", owner, "?size=thumb");
  assert.equal(thumb.headers.get("content-type"), "image/webp");
  assert.equal((await get("S01", employee)).status, 403);
  assert.equal((await get("S04", owner)).status, 404, "no art");
  assert.equal((await get("S99", owner)).status, 404);

  // A tampered art_path that climbs out of the root is a 404.
  const outside = path.join(tmpdir(), `outside-${Date.now()}.png`);
  writeFileSync(outside, readFileSync(path.join(root, "books", SLUG, "art", "S02.png")));
  await db
    .update(schema.storyScenes)
    .set({ artPath: `books/${SLUG}/../../../${path.basename(outside)}` })
    .where(eq(schema.storyScenes.sceneRef, "S02"));
  assert.equal((await get("S02", owner)).status, 404);

  rmSync(outside, { force: true });
});

test("art route rejects a directory junction that points outside CUENTOS_ROOT", async (t) => {
  await importStories();
  const owner = (await signIn("owner")).cookie;
  const outside = mkdtempSync(path.join(tmpdir(), "cuentos-outside-"));
  const link = path.join(root, "books", SLUG, "art", "linked");
  try {
    writeFileSync(path.join(outside, "secret.png"), "outside art");
    try {
      // A directory junction exercises the same resolved-path boundary on
      // Windows without requiring the Developer Mode privilege for file links.
      symlinkSync(outside, link, "junction");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) {
        t.skip("Windows denied junction creation; traversal and regular-file coverage still run");
        return;
      }
      throw error;
    }
    await db
      .update(schema.storyScenes)
      .set({ artPath: `books/${SLUG}/art/linked/secret.png` })
      .where(eq(schema.storyScenes.sceneRef, "S02"));
    const response = await callRoute(
      (req) => serveArt(req, { params: Promise.resolve({ slug: SLUG, scene: "S02" }) }),
      new Request(`http://localhost/api/stories/art/${SLUG}/S02`, { headers: { cookie: owner } }),
    );
    assert.equal(response.status, 404);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
