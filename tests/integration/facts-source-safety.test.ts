import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchFactsSource, FactsImportError } from "@/lib/facts/import";

const source = "https://raw.githubusercontent.com/owner/repo/main/facts.ts";

test("fact fetch rejects untrusted URLs before fetch and disables redirects", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  let options: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    calls++;
    options = init;
    return new Response('{"lesson":"saved"}');
  };
  try {
    await assert.rejects(fetchFactsSource("http://127.0.0.1/private"), FactsImportError);
    assert.equal(calls, 0);
    assert.equal(await fetchFactsSource(source), '{"lesson":"saved"}');
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fact fetch aborts and cancels an oversized source", async () => {
  const previousFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  let cancelled = false;
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2_000_001));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  };
  try {
    await assert.rejects(fetchFactsSource(source), /too large/);
    assert.equal(cancelled, true);
    assert.equal(signal?.aborted, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
