import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { createPool } from "mysql2/promise";

import { db, schema } from "@/db";
import { fakeGeminiClient, validate } from "@/lib/ai-fake";
import { acquireLease } from "@/lib/lease";
import {
  aiinsightsUrl,
  importAiinsights,
  mapAiinsightsItem,
  readAiinsightsItems,
} from "@/lib/learn/import";
import { learnCategoryCounts, listLearnClips } from "@/lib/learn/list";
import { NUDGE_CANDIDATES_SQL, NUDGE_MARK_SQL } from "@/lib/learn/nudge";
import {
  eligibleLearnClipIds,
  learnClipLease,
  processLearnClip,
  processLearnClips,
  type LearnDeps,
} from "@/lib/learn/process";
import { learnQueryFrom } from "@/lib/learn/query";
import { runWeeklyNudge } from "@/lib/learn/send";
import { LEARN_SUMMARY_JSON_SCHEMA, type LearnModelRunner } from "@/lib/learn/summarize";
import { monthToDateUsd } from "@/lib/spend";
import { databaseOptions } from "@/db/driver";
import {
  handleWebhook,
  LEARN_DONE_SQL,
  resetBrandCache,
  type Query,
} from "../../workers/telegram-capture/src/handler";

import { resetTables, teardown } from "./setup";

/**
 * Phase E (build 4 §3.E): processLearnClip with the model behind a seam and
 * the screenshot path on the real Gemini fake, the /learn query, the weekly
 * nudge, the aiinsights import, and the Worker's learn SQL on real MariaDB.
 */

const CANNED = {
  title: "Claude Code hooks",
  whatItIs: "Shell commands Claude Code runs on events.",
  whyItMatters: "Automates checks.",
  howToStart: ["Install it", "Add a hook"],
  category: "ai-coding-tool",
  tags: ["Hooks", "claude"],
};

/** The learn schema is new to the Gemini fake, so the runner is faked here — and held to the schema. */
function fakeRunner() {
  const prompts: string[] = [];
  const run: LearnModelRunner = async (opts) => {
    assert.equal(opts.schema, LEARN_SUMMARY_JSON_SCHEMA);
    validate(CANNED, opts.schema);
    prompts.push(opts.prompt);
    return { text: JSON.stringify(CANNED), costUsd: 0.002 };
  };
  return { run, prompts };
}

function deps(over: Partial<LearnDeps> = {}): Partial<LearnDeps> {
  return {
    fetchPage: async () => ({ title: "Page title", description: "Page description" }),
    fetchReadme: async () => "# repo\nnpm i repo",
    fetchCaptions: async () => null,
    describeScreenshot: async () => {
      throw new Error("no screenshot expected");
    },
    ...over,
  };
}

async function addClip(values: Partial<typeof schema.clips.$inferInsert> & { url: string }) {
  const [row] = await insertReturning(db, schema.clips, {
    purpose: "learn",
    source: "telegram",
    ...values,
  });
  return row!;
}

const getClip = async (id: number) =>
  (await db.select().from(schema.clips).where(eq(schema.clips.id, id)))[0]!;

const pool = createPool({ ...databaseOptions(process.env.DATABASE_URL), flags: ["-FOUND_ROWS"] });
const mysqlQuery: Query = async (text, params) => {
  const [rows] = await pool.execute(text, params as never[]);
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

beforeEach(async () => {
  await resetTables();
  resetBrandCache();
});
after(async () => {
  await pool.query("drop table if exists aiinsights_test_items");
  await pool.end();
  await teardown();
});

// ---------------------------------------------------------------------------
// processLearnClip
// ---------------------------------------------------------------------------

test("a GitHub learn clip is grounded with its README and summarised", async () => {
  const clip = await addClip({ url: "https://github.com/a/repo", note: "try it", tags: ["ai"] });
  const { run, prompts } = fakeRunner();
  const readmes: string[] = [];
  const outcome = await processLearnClip(clip.id, {
    deps: deps({
      run,
      fetchReadme: async (u) => {
        readmes.push(u);
        return "# repo\nnpm i repo";
      },
    }),
  });
  assert.deepEqual(outcome, {
    status: "done",
    clipId: clip.id,
    category: "ai-coding-tool",
    costUsd: 0.002,
  });
  assert.deepEqual(readmes, ["https://github.com/a/repo"]);
  assert.match(prompts[0]!, /Repo README excerpt:\n# repo/);
  assert.match(prompts[0]!, /The user's own note about it: try it/);
  assert.match(prompts[0]!, /Page description/);

  const row = await getClip(clip.id);
  assert.equal(row.learnCategory, "ai-coding-tool");
  assert.deepEqual(row.howToStart, ["Install it", "Add a hook"]);
  assert.equal(
    row.summary,
    "Shell commands Claude Code runs on events.\n\nWhy it matters: Automates checks.",
  );
  assert.deepEqual(row.tags, ["ai", "hooks", "claude"]);
  assert.equal(row.title, "Page title");
  assert.equal(row.error, null);
  assert.equal(row.note, "try it");
});

test("a repo link in the note is grounded too; YouTube clips get captions", async () => {
  const yt = await addClip({
    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    platform: "youtube",
    note: "code at https://github.com/x/y",
  });
  const { run, prompts } = fakeRunner();
  const asked: string[] = [];
  await processLearnClip(yt.id, {
    deps: deps({
      run,
      fetchCaptions: async (id) => {
        asked.push(id);
        return "caption words";
      },
      fetchReadme: async (u) => `readme of ${u}`,
    }),
  });
  assert.deepEqual(asked, ["dQw4w9WgXcQ"]);
  assert.match(prompts[0]!, /Video transcript \(may be partial or noisy\):\ncaption words/);
  assert.match(prompts[0]!, /readme of https:\/\/github.com\/x\/y/);
  assert.equal((await getClip(yt.id)).transcript, "caption words");
});

test("skips: not learn, already summarised (unless forced), held by another run", async () => {
  const other = await addClip({ url: "https://x.test/inspo", purpose: "inspo", note: "n" });
  const done = await addClip({ url: "https://x.test/done", note: "n", learnCategory: "other" });
  const held = await addClip({ url: "https://x.test/held", note: "n" });
  const { run, prompts } = fakeRunner();

  assert.equal((await processLearnClip(other.id, { deps: deps({ run }) })).status, "skipped");
  assert.equal((await processLearnClip(done.id, { deps: deps({ run }) })).status, "skipped");
  assert.equal(prompts.length, 0);
  assert.equal(
    (await processLearnClip(done.id, { force: true, deps: deps({ run }) })).status,
    "done",
  );

  assert.ok(await acquireLease(learnClipLease(held.id), 60_000));
  const outcome = await processLearnClip(held.id, { deps: deps({ run }) });
  assert.deepEqual(outcome, {
    status: "skipped",
    clipId: held.id,
    reason: "another run is processing it",
  });
  assert.equal((await getClip(held.id)).learnCategory, null);
});

test("nothing to summarise sets clips.error and keeps the URL + note floor", async () => {
  const clip = await addClip({ url: "https://instagram.com/reel/abc", platform: "instagram" });
  const { run, prompts } = fakeRunner();
  const outcome = await processLearnClip(clip.id, {
    deps: deps({ run, fetchPage: async () => null }),
  });
  assert.equal(outcome.status, "failed");
  assert.equal(prompts.length, 0);
  const row = await getClip(clip.id);
  assert.match(row.error ?? "", /Nothing to summarise yet/);
  assert.equal(row.url, "https://instagram.com/reel/abc");
  assert.equal(row.learnCategory, null);
});

test("a model failure is recorded on the clip, not thrown", async () => {
  const clip = await addClip({ url: "https://x.test/a", note: "n" });
  const outcome = await processLearnClip(clip.id, {
    deps: deps({ run: async () => ({ text: "{}", costUsd: 0 }) }),
  });
  assert.equal(outcome.status, "failed");
  assert.match((await getClip(clip.id)).error ?? "", /Learn summary failed/);
});

test("a screenshot is downloaded via the Bot API and read by Gemini vision under the cap", async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const server: Server = createServer((req, res) => {
    if (req.url?.includes("/getFile")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { file_path: "photos/p.jpg", file_size: 7 } }));
    } else if (req.url?.includes("/file/bot")) {
      res.end(image);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.TELEGRAM_BOT_TOKEN = "1:test";
  try {
    const clip = await addClip({
      url: "https://telegram.invalid/file/AQAD",
      telegramFileId: "file-1",
      note: null,
    });
    const { run, prompts } = fakeRunner();
    const { describeScreenshot: _unused, ...rest } = deps({ run });
    void _unused;
    const outcome = await processLearnClip(clip.id, { deps: rest });
    assert.equal(outcome.status, "done");

    const calls = fakeGeminiClient().calls.filter((c) => c.responseKind === "transcript");
    assert.equal(calls.length, 1);
    const parts = (
      calls[0]!.params as {
        contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[];
      }
    ).contents[0]!.parts;
    assert.equal(parts[0]!.inlineData?.mimeType, "image/jpeg");
    assert.equal(parts[0]!.inlineData?.data, image.toString("base64"));

    assert.match(prompts[0]!, /Screenshot, as read:\nOn screen: RESIDENCIA EN 45 DÍAS/);
    assert.match(prompts[0]!, /Platform: screenshot/);
    assert.doesNotMatch(prompts[0]!, /telegram\.invalid/);
    assert.ok((await monthToDateUsd()) > 0, "vision spend is recorded");
  } finally {
    delete process.env.TELEGRAM_API_BASE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    await new Promise((r) => server.close(r));
  }
});

test("a screenshot that cannot be read still summarises from the note", async () => {
  const clip = await addClip({
    url: "https://telegram.invalid/file/BQAD",
    telegramFileId: "file-2",
    note: "cursor rules trick",
  });
  const { run } = fakeRunner();
  const outcome = await processLearnClip(clip.id, {
    deps: deps({
      run,
      describeScreenshot: async () => {
        throw new Error("The Telegram file is not an image.");
      },
    }),
  });
  assert.equal(outcome.status, "done");
});

test("the batch takes unsummarised, error-free learn clips oldest first", async () => {
  const a = await addClip({ url: "https://x.test/1", note: "n", savedAt: new Date("2026-01-01") });
  const b = await addClip({ url: "https://x.test/2", note: "n", savedAt: new Date("2026-01-02") });
  await addClip({ url: "https://x.test/3", note: "n", error: "earlier failure" });
  await addClip({ url: "https://x.test/4", note: "n", learnCategory: "other" });
  await addClip({ url: "https://x.test/5", note: "n", purpose: "inspo" });
  assert.deepEqual(await eligibleLearnClipIds(), [a.id, b.id]);
  assert.equal((await eligibleLearnClipIds({ retryFailed: true })).length, 3);
  assert.equal((await eligibleLearnClipIds({ force: true })).length, 4);

  const { run } = fakeRunner();
  const result = await processLearnClips({ deps: deps({ run }) });
  assert.equal(result.outcomes.length, 2);
  assert.ok(result.outcomes.every((o) => o.status === "done"));
  assert.equal(result.costUsd, 0.004);
});

// ---------------------------------------------------------------------------
// /learn query
// ---------------------------------------------------------------------------

test("the /learn query filters by category, implemented, committed and search; badges count", async () => {
  await addClip({
    url: "https://x.test/hooks",
    title: "Hooks",
    learnCategory: "ai-coding-tool",
    implementedAt: new Date(),
  });
  await addClip({
    url: "https://x.test/ollama",
    summary: "Run models locally",
    learnCategory: "self-hosting",
    committedAt: new Date(),
  });
  await addClip({ url: "https://x.test/raw", note: "50% off scraping", tags: ["scrapers"] });
  await addClip({ url: "https://x.test/inspo", purpose: "inspo", title: "Hooks too" });

  const urls = async (p: Record<string, string>) =>
    (await listLearnClips(learnQueryFrom(p))).clips.map((c) => c.url).sort();

  assert.equal((await listLearnClips(learnQueryFrom({}))).total, 3);
  assert.deepEqual(await urls({ category: "self-hosting" }), ["https://x.test/ollama"]);
  assert.deepEqual(await urls({ category: "none" }), ["https://x.test/raw"]);
  assert.deepEqual(await urls({ implemented: "yes" }), ["https://x.test/hooks"]);
  assert.deepEqual(await urls({ implemented: "no" }), [
    "https://x.test/ollama",
    "https://x.test/raw",
  ]);
  assert.deepEqual(await urls({ committed: "yes" }), ["https://x.test/ollama"]);
  assert.deepEqual(await urls({ q: "hooks" }), ["https://x.test/hooks"]);
  assert.deepEqual(await urls({ q: "LOCALLY" }), ["https://x.test/ollama"]);
  assert.deepEqual(await urls({ q: "scrapers" }), ["https://x.test/raw"]);
  assert.deepEqual(await urls({ q: "50%" }), ["https://x.test/raw"]);

  assert.deepEqual(await learnCategoryCounts(learnQueryFrom({})), {
    "ai-coding-tool": 1,
    "self-hosting": 1,
    none: 1,
  });
  assert.deepEqual(
    await learnCategoryCounts(learnQueryFrom({ implemented: "no", category: "x" })),
    {
      "self-hosting": 1,
      none: 1,
    },
  );
});

// ---------------------------------------------------------------------------
// weekly nudge
// ---------------------------------------------------------------------------

test("the nudge picks one open item, sends it, and rotates past it next time", async () => {
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "42, 7";
  try {
    const old = await addClip({
      url: "https://x.test/old",
      title: "Old",
      learnCategory: "other",
      savedAt: new Date("2026-01-01"),
    });
    const newer = await addClip({
      url: "https://x.test/new",
      title: "New",
      learnCategory: "other",
      savedAt: new Date("2026-02-01"),
    });
    await addClip({
      url: "https://x.test/done",
      learnCategory: "other",
      implementedAt: new Date(),
    });

    const sent: { chat: string; text: string }[] = [];
    const send = async (chat: string, text: string) => {
      sent.push({ chat, text });
      return { ok: true as const };
    };
    const first = await runWeeklyNudge({ send });
    assert.equal(first.status, "sent");
    assert.equal(first.status === "sent" && first.item.id, old.id);
    assert.equal(sent[0]!.chat, "42");
    assert.match(sent[0]!.text, /<b>Old<\/b>/);

    const second = await runWeeklyNudge({ send });
    assert.equal(second.status === "sent" && second.item.id, newer.id);

    const dry = await runWeeklyNudge({ dryRun: true, send });
    assert.equal(dry.status, "dry-run");
    assert.equal(sent.length, 2);

    // Committing wins over rotation.
    await db
      .update(schema.clips)
      .set({ committedAt: new Date() })
      .where(eq(schema.clips.id, old.id));
    const third = await runWeeklyNudge({ send });
    assert.equal(third.status === "sent" && third.item.id, old.id);
    assert.match(sent[2]!.text, /You committed to this one/);
  } finally {
    delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  }
});

test("the Worker's learn SQL runs on real MariaDB: /done, candidates, nudge mark", async () => {
  const clip = await addClip({ url: "https://x.test/w", title: "W", learnCategory: "other" });
  const inspo = await addClip({ url: "https://x.test/i", purpose: "inspo" });
  const env = { TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_ALLOWED_CHAT_IDS: "1" };
  const post = (text: string) =>
    new Request("https://w.test/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "s" },
      body: JSON.stringify({ message: { message_id: 1, chat: { id: 1 }, text } }),
    });

  const candidates = await mysqlQuery(NUDGE_CANDIDATES_SQL, []);
  assert.deepEqual(
    candidates.map((r) => Number(r.id)),
    [clip.id],
  );
  await mysqlQuery(NUDGE_MARK_SQL, [`learn-nudged:${clip.id}`]);
  await mysqlQuery(NUDGE_MARK_SQL, [`learn-nudged:${clip.id}`]);
  const [marked] = await mysqlQuery(NUDGE_CANDIDATES_SQL, []);
  const lastNudgedAt = new Date(String(marked!.last_nudged_at));
  assert.ok(
    Number.isFinite(lastNudgedAt.getTime()),
    "MariaDB's dateStrings value is a valid timestamp",
  );

  const res = await handleWebhook(post(`/done ${clip.id}`), env, mysqlQuery);
  assert.match(((await res.json()) as { text: string }).text, /Marked "W" implemented/);
  assert.ok((await getClip(clip.id)).implementedAt);
  assert.equal((await mysqlQuery(NUDGE_CANDIDATES_SQL, [])).length, 0);

  // Not a learn clip: untouched.
  assert.equal((await mysqlQuery(LEARN_DONE_SQL, [inspo.id])).length, 0);
  assert.equal((await getClip(inspo.id)).implementedAt, null);
});

// ---------------------------------------------------------------------------
// aiinsights import
// ---------------------------------------------------------------------------

before(async () => {
  await pool.query(`create table if not exists aiinsights_test_items (
    id int not null auto_increment primary key,
    url text not null,
    platform varchar(20) not null,
    source_caption text, transcript text, user_note text,
    repo_url text, repo_readme text, image_file_id text,
    title text, summary text, category text,
    tags json, how_to_start json,
    ai_model varchar(60), ai_input_tokens integer, ai_output_tokens integer,
    status varchar(20) not null default 'pending',
    implemented boolean not null default false,
    committed_at datetime(3), last_nudged_at datetime(3), dismissed_at datetime(3),
    processing_error text, attempts integer not null default 0, last_attempt_at datetime(3),
    telegram_chat_id bigint, telegram_message_id bigint,
    created_at datetime(3) not null default current_timestamp(3),
    updated_at datetime(3) not null default current_timestamp(3)
  )`);
});

async function seedAiinsightsFixture() {
  await pool.query("delete from aiinsights_test_items");
  await pool.query(`insert into aiinsights_test_items
    (url, platform, user_note, repo_url, title, summary, category, tags, how_to_start, status, implemented, created_at, updated_at, source_caption)
  values
    ('https://github.com/a/b?utm_source=x', 'other', 'note a', 'https://github.com/a/b', 'A', 'Sum A', 'ai-coding-tool', '["cli"]', '["step 1","step 2"]', 'done', true, '2025-05-01', '2025-06-01', 'cap'),
    ('https://www.instagram.com/reel/xyz/?igsh=1', 'instagram', null, 'https://github.com/c/d', 'B', 'Sum B', 'self-hosting', '[]', '["s"]', 'done', false, '2025-05-02', '2025-05-02', null),
    ('tg://photo/AgACphoto', 'other', 'screenshot note', null, null, null, null, '[]', '[]', 'pending', false, '2025-05-03', '2025-05-03', null),
    ('https://github.com/a/b', 'other', 'dup', null, 'A again', 'Sum', 'other', '[]', '[]', 'done', false, '2025-05-04', '2025-05-04', null),
    ('https://example.com/existing', 'other', null, null, 'E', 'Sum E', 'productivity', '[]', '[]', 'done', false, '2025-05-05', '2025-05-05', null)`);
  await pool.query(
    "update aiinsights_test_items set image_file_id = 'AgACphoto', committed_at = '2025-05-10' where url like 'tg://%'",
  );
}

async function readSyntheticAiinsightsItems() {
  return readAiinsightsItems(
    async (text) =>
      (await mysqlQuery(text, [])).map((row) => ({
        ...row,
        // The real aiinsights source is PostgreSQL, whose boolean driver value
        // is true/false; mysql2 represents this MariaDB fixture as 1/0.
        implemented: row.implemented === true || row.implemented === 1,
      })),
    "aiinsights_test_items",
  );
}

test("aiinsights rows map onto learn clips (URL, steps, category, implemented, saved date)", async () => {
  await seedAiinsightsFixture();
  const rows = await readSyntheticAiinsightsItems();
  assert.equal(rows.length, 5);
  const a = mapAiinsightsItem(rows[0]!)!;
  assert.equal(a.url, "https://github.com/a/b");
  assert.equal(a.purpose, "learn");
  assert.equal(a.learnCategory, "ai-coding-tool");
  assert.deepEqual(a.howToStart, ["step 1", "step 2"]);
  assert.deepEqual(a.tags, ["cli", "aiinsights"]);
  assert.equal(a.note, "note a");
  assert.equal(a.postText, "cap");
  assert.equal(a.implementedAt?.toISOString(), new Date("2025-06-01").toISOString());
  assert.equal(a.savedAt?.toISOString(), new Date("2025-05-01").toISOString());

  const b = mapAiinsightsItem(rows[1]!)!;
  assert.equal(b.platform, "instagram");
  assert.equal(b.note, "Repo: https://github.com/c/d");
  assert.equal(b.implementedAt, null);

  const photo = mapAiinsightsItem(rows[2]!)!;
  assert.equal(photo.url, "https://telegram.invalid/aiinsights/AgACphoto");
  assert.equal(photo.telegramFileId, "AgACphoto");
  assert.equal(photo.learnCategory, null, "unsummarised → left for learn:process");
  assert.ok(photo.committedAt);
  assert.equal(
    aiinsightsUrl({ id: 9, url: "mailto:x@y.z" }),
    "https://telegram.invalid/aiinsights/item-9",
  );
  assert.equal(mapAiinsightsItem({ url: null }), null);
});

test("the import is idempotent by canonical URL and honours --dry-run", async () => {
  await seedAiinsightsFixture();
  await db.insert(schema.clips).values({ url: "https://example.com/existing", purpose: "inspo" });
  const rows = await readSyntheticAiinsightsItems();

  const dry = await importAiinsights(rows, { dryRun: true });
  assert.deepEqual(
    { read: dry.read, inserted: dry.inserted, existing: dry.existing, unusable: dry.unusable },
    { read: 5, inserted: 3, existing: 2, unusable: 0 },
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.clips);
  assert.equal(n, 1, "dry run writes nothing");

  const first = await importAiinsights(rows);
  assert.equal(first.inserted, 3);
  const second = await importAiinsights(rows);
  assert.equal(second.inserted, 0);
  assert.equal(second.existing, 5);

  const learn = await db.select().from(schema.clips).where(eq(schema.clips.purpose, "learn"));
  assert.equal(learn.length, 3);
  const existing = (
    await db.select().from(schema.clips).where(eq(schema.clips.url, "https://example.com/existing"))
  )[0]!;
  assert.equal(existing.purpose, "inspo", "a clip saved another way is left alone");
  assert.deepEqual(await eligibleLearnClipIds(), [
    learn.find((c) => c.url.startsWith("https://telegram.invalid/"))!.id,
  ]);
});
