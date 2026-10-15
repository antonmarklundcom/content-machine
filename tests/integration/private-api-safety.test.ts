import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { GET as brands } from "@/app/api/brands/route";
import { GET as ideas } from "@/app/api/ideas/route";
import { PATCH as patchIdea } from "@/app/api/ideas/[id]/route";
import { POST as ingest } from "@/app/api/ingest/route";
import { callRoute, signIn } from "./route";
import { prepareDatabase, resetTables, teardown } from "./setup";

beforeEach(resetTables);
after(teardown);

function requests(cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return [
    { handler: () => brands(), request: new Request("http://localhost/api/brands", { headers }) },
    {
      handler: ideas,
      request: new Request("http://localhost/api/ideas?brandId=propia", { headers }),
    },
    {
      handler: (r: Request) => patchIdea(r, { params: Promise.resolve({ id: "1" }) }),
      request: new Request("http://localhost/api/ideas/1", {
        method: "PATCH",
        headers,
        body: '{"title":"new"}',
      }),
    },
    {
      handler: ingest,
      request: new Request("http://localhost/api/ingest", {
        method: "POST",
        headers,
        body: '{"url":"invalid"}',
      }),
    },
  ];
}

test("private routes reject missing and deleted-user sessions before work", async () => {
  for (const { handler, request } of requests()) {
    assert.equal((await callRoute(handler, request)).status, 401);
  }
  const signed = await signIn("owner");
  await db.delete(schema.users).where(eq(schema.users.id, signed.userId));
  for (const { handler, request } of requests(signed.cookie)) {
    assert.equal((await callRoute(handler, request)).status, 401);
  }
});

test("employees retain free reading, authoring and ingest validation access", async () => {
  const { cookie } = await signIn("employee");
  const cases = requests(cookie);
  assert.equal((await callRoute(cases[0].handler, cases[0].request)).status, 200);
  assert.equal((await callRoute(cases[1].handler, cases[1].request)).status, 200);
  // No idea exists: authenticated editing reaches the lookup, not an owner gate.
  assert.equal((await callRoute(cases[2].handler, cases[2].request)).status, 404);
  assert.equal((await callRoute(cases[3].handler, cases[3].request)).status, 400);
});

test("idea edits reject malformed bodies and non-positive or unsafe ids", async () => {
  const { cookie } = await signIn("owner");
  for (const body of ["null", "[]", "{", '"text"']) {
    const response = await callRoute(
      (request) => patchIdea(request, { params: Promise.resolve({ id: "1" }) }),
      new Request("http://localhost/api/ideas/1", { method: "PATCH", headers: { cookie }, body }),
    );
    assert.equal(response.status, 400, body);
  }
  for (const id of ["0", "-1", "1.5", "1e2", "9007199254740992"]) {
    const response = await callRoute(
      (request) => patchIdea(request, { params: Promise.resolve({ id }) }),
      new Request("http://localhost/api/ideas/invalid", {
        method: "PATCH",
        headers: { cookie },
        body: '{"title":"new"}',
      }),
    );
    assert.equal(response.status, 400, id);
  }
});

test("destructive helpers revalidate environment even after migration cache is populated", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousOptIn = process.env.ALLOW_DESTRUCTIVE_TEST_DB;
  try {
    // An unreachable endpoint ensures the safety error precedes any SQL/network work.
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:1/production";
    assert.throws(() => prepareDatabase(), /dedicated \*_test database/);
    await assert.rejects(resetTables(), /dedicated \*_test database/);
    process.env.DATABASE_URL = previousUrl;
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    assert.throws(() => prepareDatabase(), /ALLOW_DESTRUCTIVE_TEST_DB/);
    await assert.rejects(resetTables(), /ALLOW_DESTRUCTIVE_TEST_DB/);
  } finally {
    process.env.DATABASE_URL = previousUrl;
    process.env.ALLOW_DESTRUCTIVE_TEST_DB = previousOptIn;
  }
});
