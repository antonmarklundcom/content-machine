import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedSourceText, factsSourceUrl } from "./source-url";

test("fact source allows only HTTPS raw GitHub without credentials/custom ports", () => {
  assert.equal(
    factsSourceUrl("https://raw.githubusercontent.com/owner/repo/main/facts.ts").hostname,
    "raw.githubusercontent.com",
  );
  for (const url of [
    "not a url",
    "http://raw.githubusercontent.com/o/r/main/f",
    "https://127.0.0.1/f",
    "https://raw.githubusercontent.com.evil.example/f",
    "https://raw.githubusercontent.com@localhost/f",
    "https://u:p@raw.githubusercontent.com/f",
    "https://raw.githubusercontent.com:8443/f",
    "file:///etc/passwd",
  ]) {
    assert.throws(() => factsSourceUrl(url), /raw.githubusercontent.com/);
  }
});

test("byte limit counts UTF-8 bytes rather than characters", async () => {
  await assert.rejects(boundedSourceText(new Response("ññ"), 3), /too large/);
  assert.equal(await boundedSourceText(new Response("ññ"), 4), "ññ");
});

test("oversized streams are cancelled even without an honest length header", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedSourceText(new Response(body, { headers: { "content-length": "1" } }), 4),
    /too large/,
  );
  assert.equal(cancelled, true);
});

test("declared oversized response is cancelled before reading", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedSourceText(new Response(body, { headers: { "content-length": "100" } }), 4),
    /too large/,
  );
  assert.equal(cancelled, true);
});
