import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";

import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";

import { db, schema } from "@/db";
import { listBrandCompetitors } from "@/lib/bridge/research";
import { addCompetitorChannel, removeCompetitor, setCompetitorRole } from "@/lib/research.actions";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * The research page's actions (PLAN.md §6.S10): link a channel by URL, toggle
 * its role, unlink it. Run inside a signed-in request scope, because each
 * action checks the session itself; YouTube is a stubbed `fetch`, never the
 * network.
 */

const BRAND = "pozo";
const CHANNEL_ID = "UCcompetitor000000000001";
const realFetch = globalThis.fetch;
let youtubeCalls = 0;

beforeEach(async () => {
  await resetTables();
  await db.insert(schema.brands).values({
    id: BRAND,
    name: "Pozo",
    domain: "pozo.example",
    niche: "well drilling",
    market: "paraguay",
    platforms: ["youtube"],
  });
  process.env.YOUTUBE_API_KEY ??= "test-key";
  youtubeCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "www.googleapis.com") return realFetch(input);
    youtubeCalls += 1;
    const known =
      url.searchParams.get("id") === CHANNEL_ID || url.searchParams.get("forHandle") === "@rival";
    const items = known
      ? [
          {
            id: CHANNEL_ID,
            snippet: { title: "Rival Drilling", customUrl: "@rival", thumbnails: {} },
            contentDetails: { relatedPlaylists: { uploads: "UUcompetitor000000000001" } },
          },
        ]
      : [];
    return Response.json({ items });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(teardown);

let revalidated = false;

/**
 * Run a server action as a signed-in user, the way a form post would.
 *
 * `revalidatePath` insists on an incremental cache in the work store, which
 * only a running server has; any object satisfies the check, and the store's
 * `pathWasRevalidated` flag then says whether the action asked for a refresh.
 */
async function as<T>(role: "owner" | "employee", run: () => Promise<T>): Promise<T> {
  const { cookie } = await signIn(role, `${role}-${Math.random()}@example.com`);
  let value: T;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore() as unknown as Record<string, unknown>;
      store.incrementalCache ??= {};
      value = await run();
      revalidated = store.pathWasRevalidated === true;
      return new Response(null, { status: 204 });
    },
    new Request("http://localhost/research", { method: "POST", headers: { cookie } }),
  );
  return value!;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const add = (fields: Record<string, string>, brand = BRAND) =>
  as("employee", () => addCompetitorChannel(brand, null, form(fields)));

test("link by URL, toggle role, unlink — the source outlives the link", async () => {
  const added = await add({ url: `https://www.youtube.com/channel/${CHANNEL_ID}` });
  assert.deepEqual(added, { ok: true }, "linking is free, so an employee may do it");
  assert.ok(revalidated, "the page is asked to re-render");

  let linked = await listBrandCompetitors(BRAND);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].title, "Rival Drilling");
  assert.equal(linked[0].role, "competitor", "competitor is the default");
  const sourceId = linked[0].sourceId;

  // Pasting the same channel again (by handle this time) is an upsert on both sides.
  assert.deepEqual(await add({ url: "https://www.youtube.com/@rival", role: "inspiration" }), {
    ok: true,
  });
  assert.equal((await db.select().from(schema.sources)).length, 1, "no duplicate source");
  linked = await listBrandCompetitors(BRAND);
  assert.equal(linked.length, 1, "no duplicate link");
  assert.equal(linked[0].role, "inspiration");

  assert.deepEqual(await as("employee", () => setCompetitorRole(BRAND, sourceId, "competitor")), {
    ok: true,
  });
  assert.equal((await listBrandCompetitors(BRAND))[0].role, "competitor");
  assert.deepEqual(await as("employee", () => setCompetitorRole(BRAND, sourceId, "rival")), {
    ok: false,
    error: "research.error.role",
  });
  assert.equal(
    (await listBrandCompetitors(BRAND))[0].role,
    "competitor",
    "a bad role changes nothing",
  );

  await as("employee", () => removeCompetitor(BRAND, sourceId));
  assert.deepEqual(await listBrandCompetitors(BRAND), []);
  assert.equal(
    (await db.select().from(schema.sources)).length,
    1,
    "unlinking keeps the source tracked",
  );
});

test("bad input is refused before YouTube is asked, with a dictionary key", async () => {
  assert.deepEqual(await add({ url: "not a url" }), { ok: false, error: "research.error.url" });
  assert.deepEqual(await add({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), {
    ok: false,
    error: "research.error.notChannel",
  });
  assert.deepEqual(await add({ url: `https://www.youtube.com/channel/${CHANNEL_ID}` }, "nope"), {
    ok: false,
    error: "research.error.brand",
  });
  assert.deepEqual(
    await add({ url: `https://www.youtube.com/channel/${CHANNEL_ID}`, role: "rival" }),
    {
      ok: false,
      error: "research.error.role",
    },
  );
  assert.equal(youtubeCalls, 0);

  assert.deepEqual(await add({ url: "https://www.youtube.com/channel/UCunknown000000000000000" }), {
    ok: false,
    error: "research.error.notFound",
  });
  assert.equal((await db.select().from(schema.brandSources)).length, 0);
});
