import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { handleWebhook, resetBrandCache, SAVE_SQL, type Env, type Query } from "../src/handler";
import { secretsMatch } from "../src/secret";

/** Worker unit tests with a mocked Neon client (PLAN.md §6.S16 exit). */

const SECRET = "s3cret_token-for-tests";
const CHAT = 111;
const ENV: Env = {
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_ALLOWED_CHAT_IDS: `${CHAT}, 222`,
  TELEGRAM_BRAND_ALIASES: '{"guia":"guide","ghost":"gone"}',
};

type Call = { text: string; params: unknown[] };

/** A fake `neon()`: brand list for the read, and a url-keyed table for the upsert. */
function mockDb(brands = ["guide", "residency"]) {
  const calls: Call[] = [];
  const rows = new Map<string, { note: string | null }>();
  const query: Query = async (text, params) => {
    calls.push({ text, params });
    if (text.startsWith("select id from brands")) return brands.map((id) => ({ id }));
    if (text === SAVE_SQL) {
      const [url, , note] = params as [string, string, string | null];
      const existing = rows.get(url);
      if (existing) {
        existing.note = note ?? existing.note;
        return [{ id: 1, created: false }];
      }
      rows.set(url, { note });
      return [{ id: 1, created: true }];
    }
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { calls, rows, query, saves: () => calls.filter((c) => c.text === SAVE_SQL) };
}

function update(message: Record<string, unknown>, chatId: number = CHAT) {
  return { update_id: 1, message: { message_id: 7, chat: { id: chatId }, ...message } };
}

function post(body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return new Request("https://worker.test/", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function replyText(res: Response): Promise<string> {
  const body = (await res.json()) as { method: string; text: string; chat_id: number };
  assert.equal(body.method, "sendMessage");
  assert.equal(body.chat_id, CHAT);
  return body.text;
}

beforeEach(resetBrandCache);

test("secretsMatch compares exactly", async () => {
  assert.equal(await secretsMatch(SECRET, SECRET), true);
  assert.equal(await secretsMatch(SECRET + "x", SECRET), false);
  assert.equal(await secretsMatch("", SECRET), false);
  assert.equal(await secretsMatch(null, SECRET), false);
});

test("a wrong or missing secret token is refused before anything is read", async () => {
  const db = mockDb();
  const body = update({ text: "https://instagram.com/reel/abc" });
  assert.equal((await handleWebhook(post(body, "nope"), ENV, db.query)).status, 401);
  assert.equal((await handleWebhook(post(body, null), ENV, db.query)).status, 401);
  assert.equal(db.calls.length, 0);
});

test("no configured secret fails closed", async () => {
  const db = mockDb();
  const res = await handleWebhook(
    post(update({ text: "x" })),
    { ...ENV, TELEGRAM_WEBHOOK_SECRET: "" },
    db.query,
  );
  assert.equal(res.status, 500);
  assert.equal(db.calls.length, 0);
});

test("a chat outside the allowlist is ignored silently", async () => {
  const db = mockDb();
  const res = await handleWebhook(post(update({ text: "https://x.com/a" }, 999)), ENV, db.query);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "", "no reply at all");
  assert.equal(db.calls.length, 0);
});

test("an empty allowlist serves nobody", async () => {
  const db = mockDb();
  const env = { ...ENV, TELEGRAM_ALLOWED_CHAT_IDS: "" };
  const res = await handleWebhook(post(update({ text: "https://x.com/a" })), env, db.query);
  assert.equal(await res.text(), "");
  assert.equal(db.calls.length, 0);
});

test("parse: link, brand alias, purpose, tags and note go into one upsert", async () => {
  const db = mockDb();
  const res = await handleWebhook(
    post(
      update({
        text: "https://www.instagram.com/reel/abc/?igsh=zz #guia #factcheck #visa says 90 days?",
      }),
    ),
    ENV,
    db.query,
  );
  assert.equal(await replyText(res), "Saved ✓ (guide, fact-check)");
  const [save] = db.saves();
  assert.ok(save);
  assert.deepEqual(save.params, [
    "https://instagram.com/reel/abc",
    "instagram",
    "says 90 days?",
    "guide",
    "fact_check",
    '["visa"]',
    null,
  ]);
  assert.equal(db.saves().length, 1, "exactly one write statement");
});

test("an alias pointing at an unknown brand is dropped and becomes a tag", async () => {
  const db = mockDb();
  const res = await handleWebhook(post(update({ text: "https://x.com/a #ghost" })), ENV, db.query);
  assert.equal(await replyText(res), "Saved ✓ (no brand, no purpose)");
  assert.equal(db.saves()[0]!.params[5], '["ghost"]');
});

test("duplicate: the second save replies 'Already saved, note updated'", async () => {
  const db = mockDb();
  await handleWebhook(post(update({ text: "https://youtu.be/abc first" })), ENV, db.query);
  const res = await handleWebhook(
    post(update({ text: "https://youtu.be/abc second" })),
    ENV,
    db.query,
  );
  assert.equal(await replyText(res), "Already saved, note updated");
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.get("https://youtu.be/abc")?.note, "second");
});

test("the SQL upsert only touches the note on an exact URL conflict", () => {
  const onDuplicate = SAVE_SQL.slice(SAVE_SQL.indexOf("on duplicate key"));
  assert.match(
    onDuplicate,
    /id = last_insert_id\(id\), note = if\(url = values\(url\), coalesce\(values\(note\), clips\.note\), clips\.note\)/i,
  );
  assert.match(SAVE_SQL, /'telegram'/);
  assert.doesNotMatch(SAVE_SQL, /on conflict|returning|::jsonb/i);
});

test("a video sent as a file stores its file_id; with no link it gets a stable URL", async () => {
  const db = mockDb();
  const video = { file_id: "BAAD-file", file_unique_id: "uniq1", mime_type: "video/mp4" };
  const res = await handleWebhook(
    post(update({ document: video, caption: "#own b-roll" })),
    ENV,
    db.query,
  );
  assert.equal(await replyText(res), "Saved ✓ (no brand, own)");
  const params = db.saves()[0]!.params;
  assert.equal(params[0], "https://telegram.invalid/file/uniq1");
  assert.equal(params[6], "BAAD-file");
  assert.equal(params[2], "b-roll");
});

test("a compressed photo uses the largest size", async () => {
  const db = mockDb();
  const photo = [
    { file_id: "small", file_unique_id: "s" },
    { file_id: "large", file_unique_id: "l" },
  ];
  await handleWebhook(post(update({ photo, caption: "https://x.com/a" })), ENV, db.query);
  assert.equal(db.saves()[0]!.params[6], "large");
});

test("a message with no link and no file gets a hint and no write", async () => {
  const db = mockDb();
  const res = await handleWebhook(post(update({ text: "hello" })), ENV, db.query);
  assert.match(await replyText(res), /No link found/);
  assert.equal(db.saves().length, 0);
});

test("a database error replies instead of failing the webhook", async () => {
  const query: Query = async () => {
    throw new Error("boom");
  };
  const res = await handleWebhook(post(update({ text: "https://x.com/a" })), ENV, query);
  assert.equal(res.status, 200);
  assert.match(await replyText(res), /Not saved/);
});

test("non-message updates and non-POST requests are answered without a write", async () => {
  const db = mockDb();
  const edit = await handleWebhook(post({ update_id: 2, edited_message: {} }), ENV, db.query);
  assert.equal(edit.status, 200);
  const get = await handleWebhook(new Request("https://worker.test/"), ENV, db.query);
  assert.equal(get.status, 405);
  assert.equal(db.calls.length, 0);
});

test("the brand list is read once per isolate, not once per message", async () => {
  const db = mockDb();
  await handleWebhook(post(update({ text: "https://x.com/a" })), ENV, db.query);
  await handleWebhook(post(update({ text: "https://x.com/b" })), ENV, db.query);
  assert.equal(db.calls.filter((c) => c.text.startsWith("select id from brands")).length, 1);
});
