import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const previous = {
  appUrl: process.env.APP_URL,
  appMode: process.env.APP_MODE,
  secret: process.env.SESSION_SECRET,
};
before(() => {
  process.env.APP_MODE = "online";
  process.env.SESSION_SECRET = "synthetic-public-origin-middleware-secret-00000000000";
});
after(() => {
  for (const [key, value] of Object.entries({
    APP_URL: previous.appUrl,
    APP_MODE: previous.appMode,
    SESSION_SECRET: previous.secret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const request = () =>
  new NextRequest("http://0.0.0.0:51234/api/media/asset/1", {
    headers: {
      host: "content.synthetic.invalid",
      "x-forwarded-host": "attacker.invalid",
      "x-forwarded-proto": "https",
    },
  });

test("CM-BUG-27: proxy login redirects to configured public origin", async () => {
  process.env.APP_URL = "https://content.synthetic.invalid";
  const response = await middleware(request());
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://content.synthetic.invalid/youtube/login");
});

test("hosted origin missing or malformed fails closed before redirect", async () => {
  for (const value of [
    undefined,
    "https://user:secret@content.synthetic.invalid",
    "http://content.synthetic.invalid",
  ]) {
    if (value === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = value;
    const response = await middleware(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Application configuration is incomplete.");
  }
});
