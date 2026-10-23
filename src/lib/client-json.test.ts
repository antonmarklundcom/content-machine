import assert from "node:assert/strict";
import { test } from "node:test";
import { postClientJson } from "./client-json";

test("capture keeps a valid save receipt distinct from HTTP or malformed response failures", async () => {
  const saved = await postClientJson(
    "/api/clips",
    { url: "https://synthetic.example/" },
    async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { url: "https://synthetic.example/" });
      return Response.json({ clip: { id: 1 }, created: true }, { status: 201 });
    },
  );
  assert.equal(saved.ok, true);
  for (const response of [
    new Response("<html>Upstream error</html>"),
    Response.json({ error: "Denied" }, { status: 403 }),
  ]) {
    const result = await postClientJson("/api/clips", {}, async () => response);
    assert.equal(result.ok, false);
    assert.equal(result.expired, false);
  }
});

test("expired sessions are recognized for JSON 401 and followed login redirects", async () => {
  for (const response of [
    Response.json({ error: "Sign in first." }, { status: 401 }),
    new Response("<html>Sign in</html>"),
  ]) {
    if (response.status === 200)
      Object.defineProperties(response, {
        redirected: { value: true },
        url: { value: "https://synthetic.example/youtube/login" },
      });
    const result = await postClientJson("/api/scripts", {}, async () => response);
    assert.equal(result.expired, true);
    assert.equal(result.ok, false);
  }
});

test("network failures remain distinguishable so forms can preserve fields and offer retry", async () => {
  await assert.rejects(
    postClientJson("/api/clips", {}, async () => {
      throw new TypeError("Synthetic offline failure");
    }),
    /Synthetic offline failure/,
  );
});
