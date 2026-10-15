import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { insertReturning } from "@/db/mutations";
import { saveLearnMaterialAction } from "@/lib/learn/material.actions";
import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };
let owner = "";
let employee = "";
beforeEach(async () => {
  await resetTables();
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});
after(teardown);
async function run(cookie: string, id: number, caption: string, transcript: string) {
  let result: Awaited<ReturnType<typeof saveLearnMaterialAction>> | undefined;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      result = await saveLearnMaterialAction(id, caption, transcript);
      return new Response(null);
    },
    new Request("http://localhost/learn", { method: "POST", headers: { cookie } }),
  );
  return result!;
}
async function seed() {
  const [clip] = await insertReturning(
    db,
    schema.clips,
    {
      url: "https://instagram.com/reel/abc/",
      platform: "instagram",
      purpose: "learn",
      note: "Apply to Propia",
      postText: "Old evidence",
      summary: "Old summary",
      learnCategory: "learning-resource",
      howToStart: ["Old step"],
      learnDetails: { takeaways: ["Old lesson"], resources: [], limitations: [] },
    },
    { id: schema.clips.id },
  );
  return clip.id;
}
test("owner can save manual IG evidence and invalidate outdated lessons without losing their note", async () => {
  const id = await seed();
  assert.equal(
    (await run(owner, id, "New caption https://docs.cloudflare.com/", "Spoken lesson")).ok,
    true,
  );
  const [clip] = await db.select().from(schema.clips).where(eq(schema.clips.id, id));
  assert.equal(clip.postText, "New caption https://docs.cloudflare.com/");
  assert.equal(clip.transcript, "Spoken lesson");
  assert.equal(clip.note, "Apply to Propia");
  for (const value of [clip.summary, clip.learnCategory, clip.howToStart, clip.learnDetails])
    assert.equal(value, null);
});
test("employee cannot alter source evidence; unchanged saves preserve the reviewed summary", async () => {
  const id = await seed();
  assert.equal((await run(employee, id, "Changed", "")).ok, false);
  assert.equal((await run(owner, id, "Old evidence", "")).ok, true);
  const [clip] = await db.select().from(schema.clips).where(eq(schema.clips.id, id));
  assert.equal(clip.summary, "Old summary");
});
test("invalid ids and oversized manual source material are refused", async () => {
  assert.equal((await run(owner, 0, "", "")).ok, false);
  assert.equal((await run(owner, await seed(), "x".repeat(100001), "")).ok, false);
});
