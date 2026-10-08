import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { GET } from "@/app/api/ideas/route";
import { getIdea, ideaCountsByStatus, listIdeas } from "@/lib/bridge";
import { deleteIdea, saveIdeaEdits, setIdeaStatus } from "@/lib/ideas.actions";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * The ideas workflow's server actions and bridge reads (PLAN.md §6.S6).
 *
 * The actions read the session through `cookies()`, so each call runs inside
 * `callRoute` with the signed-in user's cookie — the same real-token path the
 * route tests use — wrapped in a handler that returns the result as JSON.
 *
 * `revalidatePath` also needs `incrementalCache` on the work store, which a
 * route handler never touches and so `callRoute` does not set. The handler
 * below adds a stub, and collects what the action revalidated.
 */

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

let revalidated: string[] = [];

const BRAND = "residency-guide";

async function seedIdea(status: schema.IdeaStatus = "proposed", brandId = BRAND): Promise<number> {
  const [idea] = await insertReturning(
    db,
    schema.ideas,
    {
      brandId,
      title: "The 45-day timeline",
      angle: "Everyone still quotes 90 days.",
      format: "carousel",
      platform: "instagram",
      draftCopy: "45 días.",
      status,
    },
    { id: schema.ideas.id },
  );
  return idea.id;
}

/** Run a server action as the user whose cookie is given; resolves to its result or rejects. */
async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore()!;
      store.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      revalidated = (store.pendingRevalidatedTags as string[] | undefined) ?? [];
      return new Response(null);
    },
    new Request("http://localhost/brand/residency-guide", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let owner = "";
let employee = "";

beforeEach(async () => {
  await resetTables();
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});
after(teardown);

test("proposed → approved → posted round-trips, stamping posted_at", async () => {
  const id = await seedIdea();

  const approved = await as(employee, () => setIdeaStatus(id, "approved"));
  assert.equal(approved.status, "approved");
  assert.equal(approved.postedAt, null);

  const posted = await as(employee, () => setIdeaStatus(id, "posted"));
  assert.equal(posted.status, "posted");
  assert.ok(posted.postedAt instanceof Date, "posted_at stamped on the way in");

  const again = await as(owner, () => setIdeaStatus(id, "posted"));
  assert.equal(again.postedAt?.getTime(), posted.postedAt?.getTime(), "a repeat keeps the stamp");

  const back = await as(owner, () => setIdeaStatus(id, "approved"));
  assert.equal(back.postedAt, null, "cleared on the way out");
  assert.deepEqual(revalidated, [`_N_T_/brand/${BRAND}`], "the brand page is revalidated");
});

test("setIdeaStatus refuses an unknown status and a missing idea", async () => {
  const id = await seedIdea();
  await assert.rejects(
    as(owner, () => setIdeaStatus(id, "scheduled" as schema.IdeaStatus)),
    /Unknown status/,
  );
  await assert.rejects(
    as(owner, () => setIdeaStatus(id + 1000, "approved")),
    /no longer exists/,
  );
  assert.equal((await getIdea(id))?.status, "proposed");
});

test("signed out, every action is refused", async () => {
  const id = await seedIdea("rejected");
  // requireUser redirects; the test harness's redirect() throws.
  await assert.rejects(
    as("", () => setIdeaStatus(id, "approved")),
    /redirect/,
  );
  await assert.rejects(
    as("", () => saveIdeaEdits(id, { title: "x" })),
    /redirect/,
  );
  await assert.rejects(
    as("", () => deleteIdea(id)),
    /redirect/,
  );
  assert.ok(await getIdea(id));
});

test("saveIdeaEdits saves title/angle/caption and leaves status alone", async () => {
  const id = await seedIdea("approved");
  const saved = await as(employee, () =>
    saveIdeaEdits(id, { title: "  New title  ", angle: "New angle", draftCopy: "New caption" }),
  );
  assert.equal(saved.title, "New title");
  assert.equal(saved.angle, "New angle");
  assert.equal(saved.draftCopy, "New caption");
  assert.equal(saved.status, "approved");
  await assert.rejects(
    as(employee, () => saveIdeaEdits(id, { title: "   " })),
    /cannot be empty/,
  );
});

test("deleteIdea: owner only, and only a rejected idea", async () => {
  const rejected = await seedIdea("rejected");
  const approved = await seedIdea("approved");

  await assert.rejects(
    as(employee, () => deleteIdea(rejected)),
    { name: "ForbiddenError" },
  );
  assert.ok(await getIdea(rejected), "an employee cannot delete");

  await assert.rejects(
    as(owner, () => deleteIdea(approved)),
    /Only a rejected idea/,
  );
  assert.ok(await getIdea(approved), "a non-rejected idea stays");

  await as(owner, () => deleteIdea(rejected));
  assert.equal(await getIdea(rejected), null);
  await assert.rejects(
    as(owner, () => deleteIdea(rejected)),
    /no longer exists/,
  );
});

test("filtering by status: listIdeas, counts and GET ?status=", async () => {
  const a = await seedIdea("proposed");
  const b = await seedIdea("approved");
  await seedIdea("approved");
  await seedIdea("posted");
  await seedIdea("approved", "propia");

  const approved = await listIdeas({ brandId: BRAND, status: "approved" });
  assert.equal(approved.total, 2);
  assert.ok(approved.ideas.every((i) => i.status === "approved" && i.brandId === BRAND));
  assert.equal((await listIdeas({ brandId: BRAND })).total, 4);

  assert.deepEqual(await ideaCountsByStatus(BRAND), {
    proposed: 1,
    approved: 2,
    rejected: 0,
    posted: 1,
  });

  await as(owner, () => setIdeaStatus(a, "approved"));
  await as(owner, () => setIdeaStatus(b, "posted"));
  assert.deepEqual(await ideaCountsByStatus(BRAND), {
    proposed: 0,
    approved: 2,
    rejected: 0,
    posted: 2,
  });

  const response = await GET(
    new Request(`http://localhost/api/ideas?brandId=${BRAND}&status=posted`),
  );
  const body = (await response.json()) as { id: number; status: string }[];
  assert.equal(body.length, 2);
  assert.ok(body.every((i) => i.status === "posted"));

  const all = (await (
    await GET(new Request(`http://localhost/api/ideas?brandId=${BRAND}`))
  ).json()) as unknown[];
  assert.equal(all.length, 4, "without ?page the list is unpaged, as before");
  assert.equal(
    (await GET(new Request(`http://localhost/api/ideas?brandId=${BRAND}&status=nope`))).status,
    400,
  );
});
