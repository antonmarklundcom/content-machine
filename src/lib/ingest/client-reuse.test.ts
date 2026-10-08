import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestRef } from "./index";
import type { YouTubeDataClient } from "@/lib/youtube/data-api";

/**
 * ingestRef must use a caller-supplied client rather than constructing its own,
 * so the poller's single QuotaTracker spans the whole run.
 *
 * The proof is indirect but exact: with no YOUTUBE_API_KEY in the environment,
 * constructing a client throws. If the passed client reaches the resolve call,
 * ingestRef fails on the *resolve* result instead — which can only happen if it
 * never built one of its own.
 */

function stubClient(): { client: YouTubeDataClient; resolveCalls: number } {
  const state = { resolveCalls: 0 };
  const client = {
    resolve: async () => {
      state.resolveCalls += 1;
      return null;
    },
    quota: { summary: () => "0u spent of 10000u" },
  } as unknown as YouTubeDataClient;
  return {
    client,
    get resolveCalls() {
      return state.resolveCalls;
    },
  };
}

test("ingestRef uses the supplied client instead of building its own", async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    const stub = stubClient();
    await assert.rejects(
      ingestRef({ kind: "channel", channelId: "UC_test" }, { client: stub.client }),
      /no such entity/,
      "should fail on resolve, not on a missing API key",
    );
    assert.equal(stub.resolveCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
  }
});

test("without a client, ingestRef still constructs one and reports the missing key", async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    await assert.rejects(ingestRef({ kind: "channel", channelId: "UC_test" }), /YOUTUBE_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
  }
});
