import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { latestScriptDerivatives, listScriptDerivatives } from "@/lib/bridge/derivatives";
import { createScript, getScript, listChildScripts } from "@/lib/bridge/scripts";
import {
  generatePack,
  makeProse,
  makeShorts,
  savePublishPack,
  savePublishUrl,
} from "@/lib/publish.actions";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import type { PublishPack } from "@/lib/studio/types";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Build 2b · C (ideas 6 and 7): the post-recording pack and repurposing,
 * through the server actions the pages call, against a real Postgres.
 *
 * The model is faked at the CLI seam rather than in the Gemini double: every
 * call here goes through `structuredJson` (§1.38), and with AI_PROVIDER=claude
 * that spawns `CLAUDE_CLI_BIN` — here a small Node script that answers by the
 * schema it was sent and logs the prompt. So the real prompt building, the
 * CLI envelope unwrapping and the JSON extraction all run; only the model is
 * canned. (`ai-fake.ts` belongs to another phase and has no pack/shorts/prose
 * payloads; see docs/log/b2b-c.md.)
 */

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

const BRAND = {
  id: "residency-guide",
  name: "Paraguay Residency Guide",
  domain: "paraguayresidencyguide.com",
  niche: "residency",
  market: "global",
  language: "es",
  voice: "Trustworthy expat guide.",
  platforms: ["youtube"],
};

// ---------------------------------------------------------------------------
// the stub CLI
// ---------------------------------------------------------------------------

const PACK = {
  description:
    "How long residency really takes, and what restarts the clock.\n\nWatch the whole thing before you book a flight.",
  tags: [
    "#Paraguay residency",
    "paraguay residency",
    "residency timeline",
    "migraciones",
    "temporary residency",
    "paraguay visa",
    "move to paraguay",
    "expat paraguay",
    "residency documents",
    "cedula paraguay",
    "paraguay 2026",
  ],
  pinnedComment: "Which document held your file up?",
  instagram: "45 days, not 90.\n#paraguay #residency #expat",
  facebook: "Residency takes about 45 days now if the file is complete.",
  tiktok: "45 days, not 90 #paraguay #residency #expat",
};

function short(title: string, spoken: string[]) {
  return {
    titleOptions: [
      { title, angle: "a" },
      { title: `${title} (alt 1)`, angle: "b" },
      { title: `${title} (alt 2)`, angle: "c" },
    ],
    thumbnailConcepts: [
      { description: "one", textOverlay: "45", imagePrompt: "vertical calendar" },
      { description: "two", textOverlay: "", imagePrompt: "vertical folder" },
      { description: "three", textOverlay: "NEW", imagePrompt: "vertical passport" },
    ],
    hookLines: ["Ninety days? Not anymore."],
    hookOnScreenText: ["90 → 45"],
    heading: title,
    spokenLines: spoken,
    talkingPoints: [],
    onScreenText: [],
    broll: [
      {
        spokenLine: spoken[0] ?? "x",
        description: "Stopwatch",
        imagePrompt: "Stopwatch",
        videoPrompt: "slow push-in",
        aspectRatio: "16:9",
      },
    ],
    sourceIds: ["s1", "nope"],
    ctaLines: ["Full video on the channel."],
  };
}

const SHORTS = {
  shorts: [
    short("45 days, not 90", ["It takes about forty-five days.", "If the file is complete."]),
    short("The document that restarts your file", ["An expired certificate restarts everything."]),
    // No spoken body: the contract refuses it, so it is counted and not saved.
    short("Broken", []),
  ],
};

const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  fs.appendFileSync(process.env.B2BC_STUB_LOG, JSON.stringify({ args: process.argv.slice(2), input }) + "\\n");
  const answers = JSON.parse(fs.readFileSync(process.env.B2BC_STUB_ANSWERS, "utf8"));
  const key = input.includes('"shorts"') ? "shorts" : input.includes('"markdown"') ? (input.includes("newsletter blurb") ? "newsletter" : "blog") : "pack";
  // The envelope \`claude -p --output-format json\` prints, answer wrapped in a code fence as models sometimes do.
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "\`\`\`json\\n" + JSON.stringify(answers[key]) + "\\n\`\`\`" }));
});
`;

let stubDir = "";
let logFile = "";
const saved = { provider: process.env.AI_PROVIDER, bin: process.env.CLAUDE_CLI_BIN };

before(async () => {
  stubDir = await mkdtemp(path.join(tmpdir(), "b2bc-cli-"));
  const script = path.join(stubDir, "claude-stub.cjs");
  const bin = process.platform === "win32" ? path.join(stubDir, "claude-stub.cmd") : script;
  logFile = path.join(stubDir, "calls.ndjson");
  await writeFile(script, STUB);
  if (process.platform === "win32") {
    // cmd.exe only launches .exe/.cmd shims; it cannot execute a .cjs file
    // directly as the Windows equivalent of the Unix shebang above.
    await writeFile(bin, '@echo off\r\nnode "%~dp0claude-stub.cjs" %*\r\n');
  } else {
    await chmod(bin, 0o755);
  }
  await writeFile(
    path.join(stubDir, "answers.json"),
    JSON.stringify({
      pack: PACK,
      shorts: SHORTS,
      blog: { markdown: "# Residency in 45 days\n\nIt takes about 45 days." },
      newsletter: { markdown: "**45 days, not 90.** New video: [VIDEO LINK]" },
    }),
  );
  process.env.AI_PROVIDER = "claude";
  process.env.CLAUDE_CLI_BIN = bin;
  process.env.B2BC_STUB_LOG = logFile;
  process.env.B2BC_STUB_ANSWERS = path.join(stubDir, "answers.json");
});

async function stubCalls(): Promise<{ args: string[]; input: string }[]> {
  const text = await readFile(logFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; input: string });
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      const store = workAsyncStorage.getStore()!;
      store.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/studio", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let owner = "";
let employee = "";
let scriptId = 0;

beforeEach(async () => {
  await resetTables();
  await rm(logFile, { force: true });
  await db.insert(schema.brands).values(BRAND);
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
  const body = sampleScriptBody();
  const row = await createScript(
    { brandId: BRAND.id, title: body.chosenTitle, language: body.language, body },
    validateScriptBody,
  );
  scriptId = row.id;
});

after(async () => {
  if (saved.provider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = saved.provider;
  if (saved.bin === undefined) delete process.env.CLAUDE_CLI_BIN;
  else process.env.CLAUDE_CLI_BIN = saved.bin;
  await rm(stubDir, { recursive: true, force: true });
  await teardown();
});

// ---------------------------------------------------------------------------
// idea 6 — the post-recording pack
// ---------------------------------------------------------------------------

test("saving a YouTube URL stores it normalised and marks the script posted; a bad URL saves nothing", async () => {
  const bad = await as(employee, () => savePublishUrl(scriptId, "https://vimeo.com/123"));
  assert.equal(bad.ok, false);
  assert.equal((await getScript(scriptId))!.youtubeUrl, null);

  const ok = await as(employee, () =>
    savePublishUrl(scriptId, " https://youtube.com/watch?v=abc123&t=9 "),
  );
  assert.ok(ok.ok);
  const row = (await getScript(scriptId))!;
  assert.equal(row.youtubeUrl, "https://www.youtube.com/watch?v=abc123");
  assert.equal(row.status, "posted");
  assert.ok(
    row.postedAt instanceof Date && row.recordedAt instanceof Date,
    "posted implies recorded",
  );

  // Clearing the URL does not move the status back.
  const cleared = await as(employee, () => savePublishUrl(scriptId, ""));
  assert.ok(cleared.ok);
  assert.equal((await getScript(scriptId))!.youtubeUrl, null);
  assert.equal((await getScript(scriptId))!.status, "posted");

  await assert.rejects(
    as("", () => savePublishUrl(scriptId, "https://youtu.be/x")),
    /redirect/,
  );
});

test("generate pack: through structuredJson, chapters from word counts, the script's sources, saved to publish_pack", async () => {
  await as(employee, () => savePublishUrl(scriptId, "https://youtu.be/abc123"));
  const result = await as(owner, () => generatePack(scriptId));
  assert.ok(result.ok, !result.ok ? result.error : "");
  assert.equal(result.costUsd, 0, "subscription mode costs the app nothing");

  const stored = (await getScript(scriptId))!.publishPack as PublishPack;
  assert.deepEqual(stored, result.pack);
  // Hook: 7 words → the first section starts at 7/150 min = 2.8 s.
  assert.deepEqual(stored.chapters, [
    { time: "0:00", title: "Intro" },
    { time: "0:02", title: "The real timeline" },
  ]);
  assert.match(stored.description, /^How long residency really takes/);
  assert.match(
    stored.description,
    /Sources:\n- Migraciones: https:\/\/example\.gov\.py\/migraciones\/plazos$/,
  );
  assert.equal(stored.tags[0], "Paraguay residency", "# stripped");
  assert.equal(stored.tags.length, 10, "the case-insensitive duplicate is dropped");
  assert.equal(stored.captions.tiktok, PACK.tiktok);

  const [call] = await stubCalls();
  assert.ok(call, "the CLI was run");
  assert.ok(!call.args.includes("WebSearch"), "the pack does not search the web");
  assert.match(call.input, /Write every field in English/);
  assert.match(
    call.input,
    /It takes about forty-five days\. If the file is complete\./,
    "the spoken script reaches the model",
  );
  assert.match(call.input, /https:\/\/youtu\.be\/abc123/, "and so does the saved URL");
});

test("only the owner generates; an edited pack is saved by anyone signed in, and an invalid edit is not", async () => {
  await assert.rejects(
    as(employee, () => generatePack(scriptId)),
    /Only the owner can generate a publish pack/,
  );
  assert.equal((await stubCalls()).length, 0, "nothing ran");

  const generated = await as(owner, () => generatePack(scriptId));
  assert.ok(generated.ok);
  const edited: PublishPack = {
    ...generated.pack,
    chapters: [
      { time: "0:00", title: "Start" },
      { time: "0:45", title: "The real timeline" },
    ],
    tags: ["one", "two"],
  };
  const ok = await as(employee, () => savePublishPack(scriptId, edited));
  assert.ok(ok.ok);
  assert.deepEqual(((await getScript(scriptId))!.publishPack as PublishPack).chapters[1], {
    time: "0:45",
    title: "The real timeline",
  });

  const bad = await as(employee, () =>
    savePublishPack(scriptId, { ...edited, chapters: [{ time: "later", title: "x" }] }),
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(
    ((await getScript(scriptId))!.publishPack as PublishPack).tags,
    ["one", "two"],
    "nothing was saved",
  );
});

// ---------------------------------------------------------------------------
// idea 7 — repurposing
// ---------------------------------------------------------------------------

test("make shorts: each valid short is a new draft script linked to its parent; a contract failure is counted, not saved", async () => {
  const result = await as(owner, () => makeShorts(scriptId));
  assert.ok(result.ok, !result.ok ? result.error : "");
  assert.equal(result.ids.length, 2);
  assert.equal(result.rejected, 1);

  const children = await listChildScripts(scriptId);
  assert.deepEqual(
    children.map((c) => c.id),
    result.ids,
  );
  for (const child of children) {
    assert.equal(child.status, "draft");
    assert.equal(child.parentScriptId, scriptId);
    assert.equal(child.brandId, BRAND.id);
    assert.equal(child.language, "en");
    assert.deepEqual(validateScriptBody(child.body), { ok: true });
    const body = child.body as ScriptBodyV1;
    assert.equal(body.targetMinutes, 1);
    assert.equal(child.title, body.chosenTitle);
    assert.ok(
      body.sections[0]!.broll.every((b) => b.aspectRatio === "9:16"),
      "shorts are vertical",
    );
    assert.deepEqual(
      body.sections[0]!.sourceIds,
      ["s1"],
      "an id the parent does not have is dropped",
    );
  }
  assert.equal(children[0]!.title, "45 days, not 90");

  const [call] = await stubCalls();
  assert.match(
    call!.input,
    /- s1: Complete applications take about 45 days\./,
    "the parent's sources are offered by id",
  );
});

test("blog post and newsletter blurb are stored as Markdown derivatives, newest shown per kind", async () => {
  const blog = await as(owner, () => makeProse(scriptId, "blog"));
  assert.ok(blog.ok, !blog.ok ? blog.error : "");
  assert.match(blog.content, /^# Residency in 45 days/);
  assert.match(
    blog.content,
    /## Sources\n\n- \[Migraciones\]\(https:\/\/example\.gov\.py\/migraciones\/plazos\)$/,
  );

  const letter = await as(owner, () => makeProse(scriptId, "newsletter"));
  assert.ok(letter.ok);
  assert.equal(letter.content, "**45 days, not 90.** New video: [VIDEO LINK]");

  const again = await as(owner, () => makeProse(scriptId, "blog"));
  assert.ok(again.ok);
  assert.equal(
    (await listScriptDerivatives(scriptId, "blog")).length,
    2,
    "a rewrite never overwrites",
  );
  const latest = await latestScriptDerivatives(scriptId);
  assert.equal(latest.blog!.id, again.derivativeId);
  assert.equal(latest.newsletter!.id, letter.derivativeId);

  await assert.rejects(
    as(employee, () => makeProse(scriptId, "blog")),
    /Only the owner/,
  );
  const unknown = await as(owner, () => makeProse(scriptId, "tweet" as "blog"));
  assert.equal(unknown.ok, false);
});

test("a missing script or one whose body breaks the contract is refused before any model call", async () => {
  const missing = await as(owner, () => makeShorts(scriptId + 999));
  assert.equal(missing.ok, false);
  await db.update(schema.scripts).set({ body: { version: 1 } });
  const broken = await as(owner, () => generatePack(scriptId));
  assert.equal(broken.ok, false);
  assert.match(!broken.ok ? broken.error : "", /does not match the contract/);
  assert.equal((await stubCalls()).length, 0);
});
