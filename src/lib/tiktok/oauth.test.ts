import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ProviderApiError } from "@/lib/publish/provider-error";

import { tiktokConfig, tiktokRedirectUri } from "./config";
import { exchangeTikTokCode, refreshTikTokToken, tiktokAuthUrl, tiktokUserInfo } from "./oauth";

const RAW = (name: string) =>
  readFileSync(
    new URL(`../../../tests/integration/fixtures/video/tiktok/${name}.json`, import.meta.url),
    "utf8",
  );

const CONFIG = { clientKey: "awFAKEclientkey01", clientSecret: "FAKEsecret0000000000" };
const NOW = new Date("2026-10-07T12:00:00Z");

function fake(status: number, raw: string) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(raw, { status });
  };
  return { f, calls };
}

test("config and auth URL: client_key, comma-separated scopes, code, redirect, state", () => {
  assert.equal(tiktokConfig({}), null);
  const u = new URL(tiktokAuthUrl(CONFIG, tiktokRedirectUri("https://ce.example.com"), "st8"));
  assert.equal(u.origin + u.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(u.searchParams.get("client_key"), CONFIG.clientKey);
  assert.equal(u.searchParams.get("scope"), "user.info.basic,video.upload,video.publish");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(
    u.searchParams.get("redirect_uri"),
    "https://ce.example.com/api/tiktok/oauth/callback",
  );
  assert.equal(u.searchParams.get("state"), "st8");
});

test("code exchange and refresh: the form, both tokens and both expiries", async () => {
  const { f, calls } = fake(200, RAW("token"));
  const t = await exchangeTikTokCode(CONFIG, "FAKEcode", "https://x/cb", f, NOW);
  assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/oauth/token/");
  const form = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("client_key"), CONFIG.clientKey);
  assert.equal(form.get("redirect_uri"), "https://x/cb");
  assert.equal(t.openId, "-000FAKEopenIdCuentos01");
  assert.equal(t.accessExpiresAt.toISOString(), "2026-10-08T12:00:00.000Z");
  assert.equal(t.refreshExpiresAt?.toISOString(), "2027-10-07T12:00:00.000Z");
  assert.deepEqual(t.scopes, ["user.info.basic", "video.upload", "video.publish"]);

  const r = fake(200, RAW("token-refresh"));
  const fresh = await refreshTikTokToken(CONFIG, "rft.x", r.f, NOW);
  assert.equal(
    new URLSearchParams(String(r.calls[0].init?.body)).get("grant_type"),
    "refresh_token",
  );
  assert.match(fresh.accessToken, /^act\.FAKErefreshed/);

  const bad = fake(400, RAW("token-invalid-grant"));
  const err = await refreshTikTokToken(CONFIG, "rft.x", bad.f, NOW).catch((e: unknown) => e);
  assert.ok(err instanceof ProviderApiError && err.isAuthError);
  assert.match(err.message, /invalid_grant/);
});

test("user info: display name from the envelope", async () => {
  const { f, calls } = fake(200, RAW("user-info"));
  const u = await tiktokUserInfo("act.FAKE", f);
  assert.deepEqual(u, {
    openId: "-000FAKEopenIdCuentos01",
    displayName: "Cuentos PY",
    avatarUrl: "https://p16-sign.tiktokcdn-us.com/FAKE.jpeg",
  });
  assert.match(calls[0].url, /fields=open_id,avatar_url,display_name/);
});
