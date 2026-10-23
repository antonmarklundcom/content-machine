import assert from "node:assert/strict";
import { test } from "node:test";
import type { buildConnector } from "undici";
import {
  checkListingUrl,
  fetchListing,
  isPublicListingAddress,
  pinnedListingConnector,
  type ListingLookup,
} from "./listing-fetch";

const publicLookup: ListingLookup = async () => [{ address: "93.184.215.14", family: 4 }];
const html = () =>
  new Response("<title>Synthetic property</title>", { headers: { "content-type": "text/html" } });

test("listing URL validation rejects private, mapped, transition and reserved literals", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.2",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "fc00::1",
    "fe80::1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "3fff::1",
  ]) {
    assert.equal(isPublicListingAddress(address), false, address);
    assert.throws(
      () => checkListingUrl(`http://${address.includes(":") ? `[${address}]` : address}/`),
      /not a public web address/,
    );
  }
  for (const address of [
    "93.184.215.14",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicListingAddress(address), true, address);
  assert.throws(() => checkListingUrl("http://2130706433/"), /not a public web address/);
  assert.throws(() => checkListingUrl("http://localhost./"), /not a public web address/);
  assert.throws(
    () => checkListingUrl("https://user:password@property.example/"),
    /without a username/,
  );
});

test("fc/fd are ordinary public hostname prefixes; no hostname allowlist", async () => {
  for (const host of ["fda.gov", "fc-property.example", "arbitrary-property.example"]) {
    assert.equal(checkListingUrl(`https://${host}/`).hostname, host);
    const result = await fetchListing(`https://${host}/`, {
      lookup: publicLookup,
      fetchImpl: async () => html(),
    });
    assert.equal(result.title, "Synthetic property");
  }
});

test("every DNS address must be public before any HTTP transport is invoked", async () => {
  let calls = 0;
  for (const addresses of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.215.14", family: 4 },
      { address: "fd00::1", family: 6 },
    ],
    [{ address: "::ffff:169.254.169.254", family: 6 }],
    [{ address: "93.184.215.14", family: 6 }],
  ]) {
    await assert.rejects(
      fetchListing("https://property.example/", {
        lookup: async () => addresses,
        fetchImpl: async () => {
          calls++;
          return html();
        },
      }),
      /not a public web address/,
    );
  }
  assert.equal(calls, 0);
});

test("a stalled response body is cancelled when the overall deadline expires", async () => {
  let cancelled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      fetchListing("https://property.example/", {
        lookup: publicLookup,
        timeoutMs: 10,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("<title>Incomplete"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "text/html" } },
          ),
      }),
      /did not answer within/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(cancelled, true);
});

test("same-host redirect re-resolves and refuses a DNS rebind before the second request", async () => {
  let resolutions = 0;
  let requests = 0;
  await assert.rejects(
    fetchListing("https://property.example/first", {
      lookup: async () => [
        { address: ++resolutions === 1 ? "93.184.215.14" : "127.0.0.1", family: 4 },
      ],
      fetchImpl: async () => {
        requests++;
        return new Response(null, { status: 302, headers: { location: "/second" } });
      },
    }),
    /not a public web address/,
  );
  assert.equal(resolutions, 2);
  assert.equal(requests, 1);
});

test("connector pins the approved IP and preserves the requested TLS identity", () => {
  let destination: buildConnector.Options | undefined;
  const sentinel = new Error("Synthetic connector: no socket created");
  const connect: buildConnector.connector = (options, callback) => {
    destination = options;
    callback(sentinel, null);
  };
  const pinned = pinnedListingConnector(
    new URL("https://property.example/house"),
    { address: "93.184.215.14", family: 4 },
    connect,
  );
  pinned(
    { hostname: "property.example", host: "property.example", protocol: "https:", port: "443" },
    (...args) => assert.equal(args[0], sentinel),
  );
  assert.equal(destination?.hostname, "93.184.215.14");
  assert.equal(destination?.servername, "property.example");
  assert.equal(destination?.host, "property.example");
  destination = undefined;
  pinned({ hostname: "other.example", protocol: "https:", port: "443" }, (...args) =>
    assert.match(args[0]!.message, /not a public web address/),
  );
  assert.equal(destination, undefined);
});

test("streamed size limit counts actual bytes and cancels an oversized response", async () => {
  let cancelled = false;
  await assert.rejects(
    fetchListing("https://property.example/", {
      lookup: publicLookup,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(3_000_001));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "text/html", "content-length": "1" } },
        ),
    }),
    /too large/,
  );
  assert.equal(cancelled, true);
});

test("DNS failure and timeout stop the read without requesting a page", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return html();
  };
  await assert.rejects(
    fetchListing("https://property.example/", {
      lookup: async () => {
        throw new Error("Synthetic DNS failure");
      },
      fetchImpl,
    }),
    /could not be reached/,
  );
  // Keep the test process alive while AbortSignal.timeout's unref'd timer runs.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      fetchListing("https://property.example/", {
        lookup: () => new Promise(() => {}),
        timeoutMs: 5,
        fetchImpl,
      }),
      /did not answer within/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(calls, 0);
});
