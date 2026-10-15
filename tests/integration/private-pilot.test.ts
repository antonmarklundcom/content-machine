import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "@/db";
import { applicationSettings, clips, sources, transcripts, videos } from "@/db/schema";
import { DEFAULT_AUTOMATION_POLICY } from "@/lib/automation/policy";
import { getAutomationPolicy, saveAutomationPolicy } from "@/lib/automation/store";
import { updateAutomation } from "@/lib/automation/actions";
import { publishDue } from "@/lib/publish";
import { POST as capture } from "@/app/api/clips/route";
import { POST as poll } from "@/app/api/cron/poll/route";
import { POST as learn } from "@/app/api/cron/learn/route";
import { callRoute, jsonPost, signIn } from "./route";
import { resetTables, teardown } from "./setup";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import { findPendingVideos } from "@/lib/analysis/run";
beforeEach(async () => {
  await resetTables();
  await db.delete(applicationSettings);
});
after(teardown);
test("empty new installation pauses all automatic tasks and preserves captured links", async () => {
  assert.deepEqual(await getAutomationPolicy(), DEFAULT_AUTOMATION_POLICY);
  const { cookie } = await signIn("owner");
  const res = await callRoute(
    capture,
    jsonPost(
      "/api/clips",
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        purpose: "learn",
        note: "Steps to try",
      },
      { cookie },
    ),
  );
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal(payload.clip.status, "unprocessed");
  assert.equal(payload.clip.videoId, null);
  const [saved] = await db.select().from(clips);
  assert.equal(saved.note, "Steps to try");
  assert.equal((await db.select().from(videos)).length, 0);
  assert.equal((await publishDue()).paused, true);
});
test("authenticated schedulers report paused without provider work", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "private-pilot-test-secret-32-characters";
  try {
    for (const [path, handler] of [
      ["poll", poll],
      ["learn", learn],
    ] as const) {
      const response: Response = await handler(
        jsonPost(`/api/cron/${path}`, {}, { "x-cron-secret": process.env.CRON_SECRET }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).paused, true);
      assert.notEqual((await handler(jsonPost(`/api/cron/${path}`, {}))).status, 200);
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
test("owner can persist automation; employee cannot change it", async () => {
  const form = new FormData();
  form.set("enabled", "on");
  form.set("youtubeMonitoring", "on");
  const request = (cookie: string) => jsonPost("/settings", {}, { cookie });
  const owner = await signIn("owner");
  await callRoute(async () => {
    (workAsyncStorage.getStore() as unknown as { incrementalCache: object }).incrementalCache = {};
    await updateAutomation(form);
    return new Response("ok");
  }, request(owner.cookie));
  assert.equal((await getAutomationPolicy()).youtubeMonitoring, true);
  assert.equal((await getAutomationPolicy()).captureAnalysis, false);
  const employee = await signIn("employee");
  await assert.rejects(
    callRoute(async () => {
      (workAsyncStorage.getStore() as unknown as { incrementalCache: object }).incrementalCache =
        {};
      await updateAutomation(form);
      return new Response("ok");
    }, request(employee.cookie)),
    /owner|not allowed|permission/i,
  );
  assert.equal((await getAutomationPolicy()).enabled, true);
});
test("automatic pending selection excludes paused and untracked videos; manual selection retains them", async () => {
  await saveAutomationPolicy({
    ...DEFAULT_AUTOMATION_POLICY,
    enabled: true,
    youtubeMonitoring: true,
  });
  await db.insert(sources).values([
    {
      id: 101,
      kind: "channel",
      youtubeId: "active",
      title: "Active",
      url: "https://youtube.com/channel/active",
      active: true,
    },
    {
      id: 102,
      kind: "channel",
      youtubeId: "paused",
      title: "Paused",
      url: "https://youtube.com/channel/paused",
      active: false,
    },
  ]);
  for (const [id, sourceId] of [
    [101, 101],
    [102, 102],
    [103, null],
  ] as const) {
    await db.insert(videos).values({
      id,
      youtubeId: `pilot-${id}`,
      title: `Video ${id}`,
      sourceId,
      captionStatus: "available",
    });
    await db.insert(transcripts).values({
      videoId: id,
      language: "en",
      source: "manual",
      content: "Useful lesson",
      wordCount: 2,
    });
  }
  assert.deepEqual(
    (await findPendingVideos(50, true)).map((v) => v.id),
    [101],
  );
  assert.equal((await findPendingVideos()).length, 3);
});
