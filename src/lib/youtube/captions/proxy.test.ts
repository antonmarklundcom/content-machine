import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import {
  captionDispatcher,
  configuredProxyUrl,
  parseProxyUrl,
  proxiedFetch,
  redactProxyUrl,
  resetProxyCache,
} from "./proxy";
import { CaptionError } from "./types";

/**
 * The proxy is off by default and must stay that way: an accidental "on" would
 * route every caption request through a metered third party. So the tests care
 * as much about what is NOT read (HTTPS_PROXY) and what happens when nothing is
 * set as about the proxy path itself.
 */

const PROXY_KEYS = ["CAPTION_PROXY_URL", "PROXY_URL", "HTTPS_PROXY", "https_proxy"] as const;

function withEnv(values: Partial<Record<(typeof PROXY_KEYS)[number], string>>, fn: () => void) {
  const previous = new Map(PROXY_KEYS.map((k) => [k, process.env[k]]));
  for (const key of PROXY_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  resetProxyCache();
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetProxyCache();
  }
}

test("no proxy is configured unless one of the two variables is set", () => {
  withEnv({}, () => assert.equal(configuredProxyUrl(), undefined));
});

test("HTTPS_PROXY is deliberately ignored", () => {
  // Sandboxes, CI images and corporate laptops all set this. Honouring it would
  // silently reroute production caption traffic through someone else's host.
  withEnv({ HTTPS_PROXY: "http://ambient.example:3128" }, () => {
    assert.equal(configuredProxyUrl(), undefined);
  });
});

test("CAPTION_PROXY_URL wins over the general PROXY_URL", () => {
  withEnv({ CAPTION_PROXY_URL: "http://a.example:1", PROXY_URL: "http://b.example:2" }, () => {
    assert.equal(configuredProxyUrl(), "http://a.example:1");
  });
});

test("PROXY_URL is used when no caption-specific value is set", () => {
  withEnv({ PROXY_URL: "http://b.example:2" }, () => {
    assert.equal(configuredProxyUrl(), "http://b.example:2");
  });
});

test("an empty or whitespace value means off, so captions can opt out of PROXY_URL", () => {
  withEnv({ CAPTION_PROXY_URL: "   ", PROXY_URL: "http://b.example:2" }, () => {
    assert.equal(configuredProxyUrl(), undefined);
  });
});

test("parseProxyUrl moves credentials into a Basic token", () => {
  const { uri, token } = parseProxyUrl("http://user:s3cret@proxy.example:8080");
  assert.equal(uri, "http://proxy.example:8080/");
  assert.equal(token, `Basic ${Buffer.from("user:s3cret").toString("base64")}`);
});

test("parseProxyUrl decodes percent-encoded credentials", () => {
  // Residential proxy passwords routinely contain ':' and '@', which have to be
  // encoded in the URL and must not reach the header still encoded.
  const { token } = parseProxyUrl("http://us%40er:p%3Ass@proxy.example:8080");
  assert.equal(token, `Basic ${Buffer.from("us@er:p:ss").toString("base64")}`);
});

test("parseProxyUrl leaves an anonymous proxy without a token", () => {
  const { uri, token } = parseProxyUrl("http://proxy.example:8080");
  assert.equal(uri, "http://proxy.example:8080/");
  assert.equal(token, undefined);
});

test("parseProxyUrl rejects a non-HTTP scheme as a configuration error", () => {
  // 'unavailable' rather than 'network': the strategy health tracker retires on
  // it immediately instead of retrying a URL that can never work.
  assert.throws(
    () => parseProxyUrl("socks5://proxy.example:1080"),
    (err: unknown) =>
      err instanceof CaptionError && err.reason === "unavailable" && /http:/.test(err.message),
  );
});

test("parseProxyUrl rejects a malformed URL", () => {
  assert.throws(
    () => parseProxyUrl("not a url"),
    (err: unknown) => err instanceof CaptionError && err.reason === "unavailable",
  );
});

test("redactProxyUrl hides credentials but keeps the host readable", () => {
  const redacted = redactProxyUrl("http://user:s3cret@proxy.example:8080/path");
  assert.equal(redacted.includes("s3cret"), false);
  assert.equal(redacted.includes("user"), false);
  assert.match(redacted, /proxy\.example:8080/);
});

test("redactProxyUrl passes through a credential-free URL", () => {
  assert.equal(redactProxyUrl("http://proxy.example:8080/"), "http://proxy.example:8080/");
});

test("redactProxyUrl never echoes a value it cannot parse", () => {
  // An unparseable value is the one most likely to be a mistyped password.
  assert.equal(redactProxyUrl("http://user:s3cret@:::"), "<unparseable proxy url>");
});

test("captionDispatcher builds nothing when no proxy is configured", async () => {
  const previous = process.env.CAPTION_PROXY_URL;
  const previousGeneric = process.env.PROXY_URL;
  delete process.env.CAPTION_PROXY_URL;
  delete process.env.PROXY_URL;
  resetProxyCache();
  try {
    assert.equal(await captionDispatcher(), undefined);
  } finally {
    if (previous !== undefined) process.env.CAPTION_PROXY_URL = previous;
    if (previousGeneric !== undefined) process.env.PROXY_URL = previousGeneric;
    resetProxyCache();
  }
});

test("captionDispatcher builds one dispatcher and reuses it", async () => {
  const previous = process.env.CAPTION_PROXY_URL;
  process.env.CAPTION_PROXY_URL = "http://proxy.invalid:8080";
  resetProxyCache();
  try {
    const first = await captionDispatcher();
    const second = await captionDispatcher();
    assert.ok(first, "a configured proxy must produce a dispatcher");
    // Memoised: a fresh agent (and connection pool) per request would defeat
    // the point of using one.
    assert.equal(first, second);
  } finally {
    if (previous === undefined) delete process.env.CAPTION_PROXY_URL;
    else process.env.CAPTION_PROXY_URL = previous;
    resetProxyCache();
  }
});

/**
 * The unset path has to stay a plain fetch. Served from localhost so the test
 * needs no network and no proxy.
 */
let server: Server | null = null;

after(() => {
  server?.close();
});

test("proxiedFetch is an ordinary fetch when no proxy is configured", async () => {
  const previous = process.env.CAPTION_PROXY_URL;
  const previousGeneric = process.env.PROXY_URL;
  delete process.env.CAPTION_PROXY_URL;
  delete process.env.PROXY_URL;
  resetProxyCache();

  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("direct");
  });
  const port = await new Promise<number>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  try {
    const res = await proxiedFetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "direct");
  } finally {
    if (previous !== undefined) process.env.CAPTION_PROXY_URL = previous;
    if (previousGeneric !== undefined) process.env.PROXY_URL = previousGeneric;
    resetProxyCache();
  }
});
