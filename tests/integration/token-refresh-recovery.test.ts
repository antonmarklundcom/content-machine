import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { getConnection, saveConnection, accessToken } from "@/lib/publish/connections";
import { resetTables, teardown } from "./setup";
beforeEach(async () => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  await resetTables();
});
after(async () => {
  delete process.env.ENCRYPTION_KEY;
  await teardown();
});
const input = (access: string, refresh: string, expires: Date) => ({
  provider: "youtube" as const,
  accountRef: "synthetic-channel",
  label: "synthetic",
  scopes: [],
  loginExpiresAt: null,
  tokens: { accessToken: access, refreshToken: refresh, accessExpiresAt: expires },
});
test("BUG-09: a stale caller re-reads a reconnected token and never refreshes old credentials", async () => {
  const old = await saveConnection(input("old", "old-refresh", new Date(0)));
  await saveConnection(input("new", "new-refresh", new Date(Date.now() + 3600000)));
  let calls = 0;
  const result = await accessToken(old, async () => {
    calls++;
    throw Error("stale refresh must never run");
  });
  assert.deepEqual(result, { ok: true, token: "new" });
  assert.equal(calls, 0);
  assert.equal((await getConnection("youtube", old.id))?.status, "ok");
});
test("BUG-09: repeated stale callers use the first durable refresh, without a second paid/login call", async () => {
  const old = await saveConnection(input("old", "refresh", new Date(0)));
  let calls = 0;
  const renew = async () => {
    calls++;
    return {
      accessToken: "fresh",
      refreshToken: "rotated",
      accessExpiresAt: new Date(Date.now() + 3600000),
    };
  };
  assert.deepEqual(await accessToken(old, renew), { ok: true, token: "fresh" });
  assert.deepEqual(await accessToken(old, renew), { ok: true, token: "fresh" });
  assert.equal(calls, 1);
});

test(
  "native PostgreSQL: competing refresh callers use one rotated token",
  { skip: !!(globalThis as { auditPglite?: unknown }).auditPglite },
  async () => {
    const old = await saveConnection(input("old", "refresh", new Date(0)));
    let release!: () => void,
      entered!: () => void,
      calls = 0;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const firstEntered = new Promise<void>((r) => {
      entered = r;
    });
    const refresh = async () => {
      calls++;
      entered();
      await held;
      return {
        accessToken: "fresh",
        refreshToken: "rotated",
        accessExpiresAt: new Date(Date.now() + 3600000),
      };
    };
    const first = accessToken(old, refresh);
    await firstEntered;
    const second = accessToken(old, refresh);
    release();
    assert.deepEqual(await Promise.all([first, second]), [
      { ok: true, token: "fresh" },
      { ok: true, token: "fresh" },
    ]);
    assert.equal(calls, 1);
  },
);
