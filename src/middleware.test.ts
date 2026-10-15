import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { createSessionToken, SESSION_COOKIE } from "./lib/auth/token";
test("protected requests get a server marker; spoofed markers cannot bypass login", async () => {
  const prior = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    APP_MODE: process.env.APP_MODE,
    APP_URL: process.env.APP_URL,
  };
  const secret = "private-pilot-middleware-synthetic-secret-at-least-32";
  Object.assign(process.env, {
    SESSION_SECRET: secret,
    APP_MODE: "online",
    APP_URL: "https://content.antonmarklund.com",
  });
  try {
    const blocked = await middleware(
      new NextRequest("https://content.antonmarklund.com/", {
        headers: { "x-content-machine-protected": "1" },
      }),
    );
    assert.equal(blocked.status, 307);
    const token = await createSessionToken(1, secret);
    const passed = await middleware(
      new NextRequest("https://content.antonmarklund.com/", {
        headers: { cookie: `${SESSION_COOKIE}=${token}`, "x-content-machine-protected": "0" },
      }),
    );
    assert.equal(passed.headers.get("x-middleware-request-x-content-machine-protected"), "1");
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("login resets a stale protected marker after logout without unlocking private routes", async () => {
  const login = await middleware(
    new NextRequest("https://content.antonmarklund.com/youtube/login", {
      headers: { "x-content-machine-protected": "1" },
    }),
  );
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("location"), null);
  assert.equal(login.headers.get("x-middleware-request-x-content-machine-protected"), "0");
});
