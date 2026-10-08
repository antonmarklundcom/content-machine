import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  NUDGE_CANDIDATES_SQL,
  NUDGE_MARK_SQL,
} from "../../../src/lib/learn/nudge";
import {
  handleWebhook,
  LEARN_COMMIT_SQL,
  LEARN_DONE_SQL,
  resetBrandCache,
  SAVE_SQL,
  type Env,
  type Query,
} from "../src/handler";
import { runScheduledNudge } from "../src/nudge";

/** Build 4 §3.E: `/done`, `/commit` and the weekly nudge cron, with a mocked Neon client. */

const SECRET = "s3cret";
const CHAT = 111;
const ENV: Env = {
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_ALLOWED_CHAT_IDS: `${CHAT},222`,
  TELEGRAM_BOT_TOKEN: "123:abc",
};

type Call = { text: string; params: unknown[] };

function mockDb(learnIds: number[] = [5]) {
  const calls: Call[] = [];
  const query: Query = async (text, params) => {
    calls.push({ text, params });
    if (text === LEARN_DONE_SQL || text === LEARN_COMMIT_SQL) {
      const id = params[0] as number;
      return learnIds.includes(id) ? [{ id, title: "Hooks" }] : [];
    }
    if (text.startsWith("select id from brands")) return [];
    if (text === SAVE_SQL) return [{ id: 1, created: true }];
    if (text === NUDGE_CANDIDATES_SQL) {
      return [
        {
          id: 9,
          url: "https://x.test/9",
          title: "Old one",
          summary: "s",
          how_to_start: ["a"],
          learn_category: "other",
          committed_at: null,
          saved_at: "2026-01-01 00:00:00",
          last_nudged_at: null,
        },
      ];
    }
    if (text === NUDGE_MARK_SQL) return [];
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { calls, query };
}

function post(text: string, chatId = CHAT): Request {
  return new Request("https://worker.test/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ update_id: 1, message: { message_id: 7, chat: { id: chatId }, text } }),
  });
}

const replyText = async (res: Response) => ((await res.json()) as { text: string }).text;

beforeEach(resetBrandCache);

test("/done marks a learn clip implemented with one UPDATE", async () => {
  const db = mockDb();
  const text = await replyText(await handleWebhook(post("/done 5"), ENV, db.query));
  assert.equal(text, 'Marked "Hooks" implemented ✓');
  assert.deepEqual(db.calls, [{ text: LEARN_DONE_SQL, params: [5] }]);
});

test("/commit sets committed_at; an unknown or non-learn id says so", async () => {
  const db = mockDb();
  assert.match(await replyText(await handleWebhook(post("/commit 5"), ENV, db.query)), /Committed/);
  assert.equal(
    await replyText(await handleWebhook(post("/commit 6"), ENV, db.query)),
    "No learn item 6.",
  );
  assert.deepEqual(
    db.calls.map((c) => c.text),
    [LEARN_COMMIT_SQL, LEARN_COMMIT_SQL],
  );
});

test("commands from a chat outside the allowlist touch nothing", async () => {
  const db = mockDb();
  const res = await handleWebhook(post("/done 5", 999), ENV, db.query);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(db.calls.length, 0);
});

test("a link with #learn is still a capture, not a command", async () => {
  const db = mockDb();
  await handleWebhook(post("https://github.com/a/b #learn"), ENV, db.query);
  const save = db.calls.find((c) => c.text === SAVE_SQL);
  assert.equal(save?.params[4], "learn");
});

test("the cron picks one item, sends it to the first allowed chat, records the nudge", async () => {
  const db = mockDb();
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  }) as typeof fetch;
  const result = await runScheduledNudge(ENV, db.query, fakeFetch, new Date("2026-10-09T12:00:00Z"));
  assert.deepEqual(result, { status: "sent", clipId: 9 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, "https://api.telegram.org/bot123:abc/sendMessage");
  assert.equal(sent[0]!.body.chat_id, "111");
  assert.equal(sent[0]!.body.parse_mode, "HTML");
  assert.match(String(sent[0]!.body.text), /Old one/);
  assert.deepEqual(db.calls.at(-1), { text: NUDGE_MARK_SQL, params: ["learn-nudged:9"] });
});

test("the cron sends nothing without a token, and records nothing when Telegram refuses", async () => {
  const db = mockDb();
  const noFetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;
  const noToken = await runScheduledNudge({ ...ENV, TELEGRAM_BOT_TOKEN: "" }, db.query, noFetch);
  assert.equal(noToken.status, "failed");
  assert.equal(db.calls.length, 0);

  const refuse = (async () => Response.json({ ok: false, description: "chat not found" }, { status: 400 })) as typeof fetch;
  const refused = await runScheduledNudge(ENV, db.query, refuse);
  assert.deepEqual(refused, { status: "failed", error: "sendMessage failed: chat not found" });
  assert.ok(!db.calls.some((c) => c.text === NUDGE_MARK_SQL));
});
