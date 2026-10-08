import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ProviderApiError, redactTokens } from "@/lib/publish/provider-error";

import { googleConfig, youtubeRedirectUri } from "./config";
import { exchangeGoogleCode, googleAuthUrl, listChannels, refreshGoogleToken } from "./oauth";

const FIX = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../tests/integration/fixtures/video/youtube/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

const CONFIG = {
  clientId: "123-abc.apps.googleusercontent.com",
  clientSecret: "GOCSPX-FAKEsecret",
};
const NOW = new Date("2026-10-07T12:00:00Z");

type Call = { url: string; init?: RequestInit };
function fake(answer: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer({ url, init });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  };
  return { f, calls };
}

test("config: both halves or nothing; the redirect URI", () => {
  assert.equal(googleConfig({ GOOGLE_OAUTH_CLIENT_ID: "x" }), null);
  assert.deepEqual(
    googleConfig({
      GOOGLE_OAUTH_CLIENT_ID: " id ",
      GOOGLE_OAUTH_CLIENT_SECRET: "s",
    }),
    { clientId: "id", clientSecret: "s" },
  );
  assert.equal(
    youtubeRedirectUri("http://localhost:3000/"),
    "http://localhost:3000/api/youtube/oauth/callback",
  );
});

test("auth URL: upload + readonly scopes, offline access, consent prompt, the state", () => {
  const u = new URL(
    googleAuthUrl(CONFIG, "http://localhost:3000/api/youtube/oauth/callback", "st8"),
  );
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("client_id"), CONFIG.clientId);
  assert.equal(
    u.searchParams.get("redirect_uri"),
    "http://localhost:3000/api/youtube/oauth/callback",
  );
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(
    u.searchParams.get("scope"),
    "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  );
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("state"), "st8");
});

test("code exchange: posts the form, returns both tokens and the access expiry", async () => {
  const { f, calls } = fake(() => ({ body: FIX("token") }));
  const t = await exchangeGoogleCode(CONFIG, "4/FAKEcode", "http://x/cb", f, NOW);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].init?.method, "POST");
  const form = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "4/FAKEcode");
  assert.equal(form.get("redirect_uri"), "http://x/cb");
  assert.equal(form.get("client_secret"), CONFIG.clientSecret);
  assert.equal(t.accessToken, "ya29.FAKEaccessToken0000000000000000");
  assert.equal(t.refreshToken, "1//FAKErefreshToken000000000000000");
  assert.equal(t.accessExpiresAt.toISOString(), "2026-10-07T12:59:59.000Z");
  assert.equal(t.scopes.length, 2);

  const noRefresh = fake(() => ({ body: FIX("token-refresh") }));
  await assert.rejects(
    exchangeGoogleCode(CONFIG, "c", "http://x/cb", noRefresh.f, NOW),
    /no refresh token/,
  );
});

test("refresh: a new access token; invalid_grant is an auth error, a 503 is transient", async () => {
  const { f, calls } = fake(() => ({ body: FIX("token-refresh") }));
  const r = await refreshGoogleToken(CONFIG, "1//FAKErefresh", f, NOW);
  assert.equal(r.accessToken, "ya29.FAKErefreshedAccess00000000000");
  assert.equal(r.refreshToken, "1//FAKErefresh", "kept when Google sends none");
  const form = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "1//FAKErefresh");

  const revoked = fake(() => ({ status: 400, body: FIX("token-invalid-grant") }));
  const err = await refreshGoogleToken(CONFIG, "1//x", revoked.f, NOW).catch((e: unknown) => e);
  assert.ok(err instanceof ProviderApiError);
  assert.equal(err.isAuthError, true);
  assert.equal(err.code, "invalid_grant");

  const down = fake(() => ({ status: 503, body: FIX("error-backend") }));
  const err2 = await refreshGoogleToken(CONFIG, "1//x", down.f, NOW).catch((e: unknown) => e);
  assert.ok(err2 instanceof ProviderApiError && err2.isTransient && !err2.isAuthError);
});

test("channels: mine=true with the bearer token", async () => {
  const { f, calls } = fake(() => ({ body: FIX("channels") }));
  const list = await listChannels("ya29.FAKE", f);
  assert.deepEqual(list, [
    {
      id: "UCfakeCuentosPy0000000001",
      title: "Cuentos PY",
      customUrl: "@cuentospy",
      thumbnailUrl: "https://yt3.ggpht.com/FAKE=s88",
    },
  ]);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("mine"), "true");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer ya29.FAKE");
});

test("redaction: no token survives an error message", () => {
  const text = redactTokens(
    'Bearer ya29.abc refresh_token=1//xyz {"access_token":"act.123456789012345"} ya29.zzz 1//qqq rft.abcdefghijklmnop',
  );
  assert.ok(!/ya29\.|1\/\/|act\.1|rft\.a/.test(text), text);
});
