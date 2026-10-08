import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationOrigin } from "./app-origin";

const request = (url = "http://container.internal:51234/api/media/asset/1", headers = {}) => ({
  url,
  headers: new Headers(headers),
});

test("configured public origin wins over internal and forged proxy headers", () => {
  assert.equal(
    applicationOrigin(
      request(undefined, {
        host: "untrusted.invalid",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
      }),
      { appMode: "online", appUrl: "https://content.synthetic.invalid/" },
    ),
    "https://content.synthetic.invalid",
  );
});

test("online mode requires a configured HTTPS origin", () => {
  for (const appUrl of [undefined, "", "  ", "http://content.synthetic.invalid"]) {
    assert.throws(() => applicationOrigin(request(), { appMode: " ONLINE ", appUrl }), /APP_URL/);
  }
});

test("origin configuration refuses credentials, paths, queries and unsupported schemes", () => {
  for (const appUrl of [
    "not a URL",
    "javascript:alert(1)",
    "https://user:secret@content.synthetic.invalid",
    "https://content.synthetic.invalid/path",
    "https://content.synthetic.invalid?x=1",
    "https://content.synthetic.invalid#x",
  ]) {
    assert.throws(() => applicationOrigin(request(), { appMode: "online", appUrl }), /APP_URL/);
  }
});

test("local loopback HTTP remains supported", () => {
  assert.equal(
    applicationOrigin(request("http://localhost:3000/settings"), {}),
    "http://localhost:3000",
  );
  assert.equal(
    applicationOrigin(request(), { appMode: "pc", appUrl: "http://127.0.0.1:3000" }),
    "http://127.0.0.1:3000",
  );
});

test("local proxy fallback retains first host/protocol without accepting a path", () => {
  assert.equal(
    applicationOrigin(
      request(undefined, {
        "x-forwarded-host": "dev.synthetic.invalid, other.invalid",
        "x-forwarded-proto": "https, http",
      }),
      {},
    ),
    "https://dev.synthetic.invalid",
  );
  assert.throws(
    () => applicationOrigin(request(undefined, { host: "bad.invalid/path" }), {}),
    /APP_URL/,
  );
});
