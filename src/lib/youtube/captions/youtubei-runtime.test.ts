import assert from "node:assert/strict";
import { test } from "node:test";

test(
  "installed YouTube library supports the app's caption APIs without network",
  { timeout: 5_000 },
  async () => {
    const { Innertube, YT } = await import("youtubei.js");
    let requests = 0;
    const client = await Innertube.create({
      lang: "en",
      location: "US",
      retrieve_player: false,
      generate_session_locally: true,
      retrieve_innertube_config: false,
      enable_session_cache: false,
      fetch: async () => {
        requests += 1;
        throw new Error("Synthetic runtime compatibility check forbids network.");
      },
    });
    assert.equal(typeof client.getInfo, "function");
    assert.equal(typeof YT.VideoInfo.prototype.getTranscript, "function");
    assert.equal(requests, 0);
  },
);
