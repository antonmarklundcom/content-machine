import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import {
  escapeHtml,
  formatNudgeMessage,
  nudgeItemFromRow,
  parseLearnCommand,
  pickNudge,
  RENUDGE_AFTER_MS,
  type NudgeItem,
} from "./nudge";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function item(id: number, over: Partial<NudgeItem> = {}): NudgeItem {
  return {
    id,
    url: `https://x.test/${id}`,
    title: `Item ${id}`,
    summary: "What it is.",
    howToStart: ["step one"],
    learnCategory: "ai-coding-tool",
    implementedAt: null,
    committedAt: null,
    savedAt: ago(30 - id),
    lastNudgedAt: null,
    ...over,
  };
}

test("nothing open → null", () => {
  assert.equal(pickNudge([], NOW), null);
  assert.equal(pickNudge([item(1, { implementedAt: ago(1) })], NOW), null);
});

test("committed-but-not-done wins, the most recent commitment first", () => {
  const picked = pickNudge(
    [
      item(1),
      item(2, { committedAt: ago(10) }),
      item(3, { committedAt: ago(2) }),
      item(4, { committedAt: ago(1), implementedAt: ago(0) }),
    ],
    NOW,
  );
  assert.equal(picked?.id, 3);
});

test("otherwise the oldest saved item not nudged recently", () => {
  const items = [
    item(1, { savedAt: ago(40), lastNudgedAt: ago(3) }),
    item(2, { savedAt: ago(30) }),
    item(3, { savedAt: ago(35), lastNudgedAt: new Date(NOW.getTime() - RENUDGE_AFTER_MS - 1) }),
  ];
  assert.equal(pickNudge(items, NOW)?.id, 3);
});

test("everything nudged lately → the least recently nudged", () => {
  const items = [item(1, { lastNudgedAt: ago(2) }), item(2, { lastNudgedAt: ago(5) })];
  assert.equal(pickNudge(items, NOW)?.id, 2);
});

test("summarised items come before unsummarised ones", () => {
  const items = [item(1, { learnCategory: null, savedAt: ago(90) }), item(2)];
  assert.equal(pickNudge(items, NOW)?.id, 2);
  assert.equal(pickNudge([item(1, { learnCategory: null })], NOW)?.id, 1);
});

test("the message is escaped HTML with steps, link and the reply commands", () => {
  const text = formatNudgeMessage(
    item(7, { title: "a <b> & c", howToStart: ["npm i x", " ", "run <it>"] }),
    "https://app.test/",
  );
  assert.ok(text.startsWith("<b>This week: implement one thing</b>"));
  assert.ok(text.includes("<b>a &lt;b&gt; &amp; c</b>"));
  assert.ok(text.includes("1. npm i x\n2. run &lt;it&gt;"));
  assert.ok(text.includes("https://x.test/7"));
  assert.ok(text.includes("/commit 7"));
  assert.ok(text.endsWith("https://app.test/learn"));
  assert.ok(text.length < 4096);
});

test("a committed item asks whether it happened; a screenshot hides its pseudo-URL", () => {
  const text = formatNudgeMessage(
    item(8, { committedAt: ago(1), title: null, url: "https://telegram.invalid/file/x" }),
  );
  assert.ok(text.startsWith("<b>You committed to this one."));
  assert.ok(text.includes("<b>Learn item 8</b>"));
  assert.ok(!text.includes("telegram.invalid"));
  assert.ok(text.includes("Reply /done 8"));
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});

test("parseLearnCommand reads /done and /commit, nothing else", () => {
  assert.deepEqual(parseLearnCommand("/done 12"), { command: "done", id: 12 });
  assert.deepEqual(parseLearnCommand(" /Commit@MyBot #5 "), { command: "commit", id: 5 });
  assert.equal(parseLearnCommand("/done"), null);
  assert.equal(parseLearnCommand("/done 12 extra"), null);
  assert.equal(parseLearnCommand("https://x.test #learn"), null);
  assert.equal(parseLearnCommand(undefined), null);
});

test("nudgeItemFromRow accepts predecoded JSON arrays and Date objects", () => {
  const row = nudgeItemFromRow({
    id: "3",
    url: "https://x.test",
    title: null,
    summary: "s",
    how_to_start: ["a"],
    learn_category: "other",
    committed_at: null,
    saved_at: "2026-10-01 10:00:00",
    last_nudged_at: new Date("2026-10-02T00:00:00Z"),
  });
  assert.equal(row.id, 3);
  assert.deepEqual(row.howToStart, ["a"]);
  assert.equal(row.committedAt, null);
  assert.equal(row.savedAt.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.equal(row.lastNudgedAt?.toISOString(), "2026-10-02T00:00:00.000Z");
});

test("raw MariaDB JSON text and fractional UTC datetime strings keep their value", () => {
  const row = nudgeItemFromRow({
    id: 9,
    url: "https://x.test/9",
    how_to_start: '["Run npm install","Leer ñandú"]',
    committed_at: "2026-10-02T08:30:00-04:00",
    saved_at: "2026-10-01 10:00:00.125",
    last_nudged_at: "2026-10-03 09:10:11.123",
  });
  assert.deepEqual(row.howToStart, ["Run npm install", "Leer ñandú"]);
  assert.equal(row.savedAt.toISOString(), "2026-10-01T10:00:00.125Z");
  assert.equal(row.committedAt?.toISOString(), "2026-10-02T12:30:00.000Z");
  assert.equal(row.lastNudgedAt?.toISOString(), "2026-10-03T09:10:11.123Z");
});

test("missing/non-array JSON produces no steps while corrupted JSON fails visibly", () => {
  const base = { id: 1, url: "https://x.test", saved_at: null };
  for (const how_to_start of [null, "null", "{}", undefined]) {
    const row = nudgeItemFromRow({ ...base, how_to_start });
    assert.equal(row.howToStart, null);
    assert.equal(row.savedAt.getTime(), 0);
  }
  assert.throws(() => nudgeItemFromRow({ ...base, how_to_start: "[broken" }), SyntaxError);
});

test("zone-less raw MariaDB timestamps are UTC on the owner's non-UTC PC", () => {
  const moduleUrl = new URL("./nudge.ts", import.meta.url).href;
  const script = `import { nudgeItemFromRow } from ${JSON.stringify(moduleUrl)};
    const row = nudgeItemFromRow({id:1,url:"https://x.test",saved_at:"2026-10-01 10:00:00"});
    process.stdout.write(row.savedAt.toISOString());`;
  const result = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: { ...process.env, TZ: "America/Asuncion" },
    },
  );
  assert.equal(result, "2026-10-01T10:00:00.000Z");
});
