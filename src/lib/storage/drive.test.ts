import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVE_NOT_CONFIGURED,
  DRIVE_READ_ONLY,
  driveConfig,
  driveDriver,
  driveFileIdFromUrl,
  driveViewUrl,
} from "./drive";

/** [O14] The read-only Google Drive driver: id parsing, links and typed results. */

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123";

type Call = { url: URL; headers: Record<string, string> };

function fakeFetch(respond: (call: Call) => Response, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
}

test("file ids come out of every Drive and Docs link shape", () => {
  assert.equal(driveFileIdFromUrl(ID), ID);
  assert.equal(driveFileIdFromUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID);
  assert.equal(driveFileIdFromUrl(`https://drive.google.com/open?id=${ID}`), ID);
  assert.equal(driveFileIdFromUrl(`https://drive.google.com/uc?id=${ID}&export=download`), ID);
  assert.equal(driveFileIdFromUrl(`https://docs.google.com/document/d/${ID}/edit`), ID);
  assert.equal(driveFileIdFromUrl(`https://example.com/file/d/${ID}/view`), null);
  assert.equal(driveFileIdFromUrl("not a link"), null);
  assert.equal(driveFileIdFromUrl("https://drive.google.com/file/d/../view"), null);
});

test("the view link needs no configuration", () => {
  assert.equal(driveDriver({}).link(ID), driveViewUrl(ID));
  assert.equal(driveViewUrl(ID), `https://drive.google.com/file/d/${ID}/view`);
});

test("config reads GOOGLE_DRIVE_API_KEY, blank is unset", () => {
  assert.deepEqual(driveConfig({ GOOGLE_DRIVE_API_KEY: " k " }), { apiKey: "k" });
  assert.deepEqual(driveConfig({ GOOGLE_DRIVE_API_KEY: " " }), {});
});

test("writes are always refused: the driver is read-only", async () => {
  const drive = driveDriver({ apiKey: "k" }, { fetch: fakeFetch(() => assert.fail("no call")) });
  assert.deepEqual(await drive.put(ID, Buffer.from("x")), {
    ok: false,
    reason: "rejected",
    message: DRIVE_READ_ONLY,
  });
  assert.equal((await drive.remove(ID)).ok, false);
});

test("without a key or token, reads say so instead of calling Google", async () => {
  const drive = driveDriver({}, { fetch: fakeFetch(() => assert.fail("no call")) });
  assert.deepEqual(await drive.get(ID), {
    ok: false,
    reason: "missing",
    message: DRIVE_NOT_CONFIGURED,
  });
  assert.equal((await drive.exists(ID)).ok, false);
});

test("a bad id is rejected before any request", async () => {
  const drive = driveDriver({ apiKey: "k" }, { fetch: fakeFetch(() => assert.fail("no call")) });
  const result = await drive.get("../etc/passwd");
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "rejected");
});

test("get downloads with the API key and returns the bytes", async () => {
  const calls: Call[] = [];
  const drive = driveDriver(
    { apiKey: "k" },
    {
      fetch: fakeFetch(
        () => new Response("PNGDATA", { headers: { "content-type": "image/png" } }),
        calls,
      ),
    },
  );
  const result = await drive.get(ID);
  assert.ok(result.ok);
  assert.equal(result.data.toString(), "PNGDATA");
  assert.equal(result.mime, "image/png");
  assert.equal(calls[0].url.pathname, `/drive/v3/files/${ID}`);
  assert.equal(calls[0].url.searchParams.get("alt"), "media");
  assert.equal(calls[0].url.searchParams.get("key"), "k");
});

test("an access token is preferred over the key and sent as a header", async () => {
  const calls: Call[] = [];
  const drive = driveDriver(
    { apiKey: "k" },
    {
      accessToken: async () => "tok",
      fetch: fakeFetch(() => Response.json({ id: ID, trashed: false }), calls),
    },
  );
  assert.deepEqual(await drive.exists(ID), { ok: true, exists: true });
  assert.equal(calls[0].headers.authorization, "Bearer tok");
  assert.equal(calls[0].url.searchParams.get("key"), null);
});

test("exists: 404 and trashed are false, 403 is a typed refusal", async () => {
  const status = (code: number, body: unknown = { error: { message: "nope" } }) =>
    driveDriver({ apiKey: "k" }, { fetch: fakeFetch(() => Response.json(body, { status: code })) });
  assert.deepEqual(await status(404).exists(ID), { ok: true, exists: false });
  assert.deepEqual(await status(200, { id: ID, trashed: true }).exists(ID), {
    ok: true,
    exists: false,
  });
  const refused = await status(403).get(ID);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, "rejected");
  assert.match(!refused.ok ? refused.message : "", /nope/);
  const gone = await status(404).get(ID);
  assert.equal(!gone.ok && gone.reason, "not_found");
});

test("a network error is a typed failure, not a throw", async () => {
  const drive = driveDriver(
    { apiKey: "k" },
    {
      fetch: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    },
  );
  const result = await drive.get(ID);
  assert.equal(!result.ok && result.reason, "error");
});
