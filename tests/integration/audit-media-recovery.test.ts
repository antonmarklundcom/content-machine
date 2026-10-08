import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerFile, sha256File } from "@/lib/media/register";
import { scanMediaRoot } from "@/lib/media/scan";
import { cancelJob, reapJobs, settleRuns, startJob } from "@/lib/higgsfield/run";
import { buildVoiceRunPrompt, voiceArgument, parseVoiceManifest } from "@/lib/higgsfield/voice";
import { queueHiggsfieldVoice, repairOrphanedHiggsfieldTakes } from "@/lib/voice/higgsfield-takes";
import { resetTables, teardown } from "./setup";
import { createScript, updateScriptBody } from "@/lib/bridge/scripts";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import { validateScriptBody } from "@/lib/scripts/contract";

let root = "";
beforeEach(async () => {
  await resetTables();
  root = mkdtempSync(path.join(tmpdir(), "audit-media-recovery-"));
  process.env.MEDIA_ROOT = root;
  process.env.CLAUDE_CLI_PATH = path.resolve("tests/fixtures/fake-claude-recovery.mjs");
  process.env.HIGGSFIELD_MCP_SERVER = "higgsfield";
  delete process.env.FAKE_RECOVERY_MODE;
  delete process.env.FAKE_RECOVERY_MARKERS;
  delete process.env.FAKE_RECOVERY_READY;
});
afterEach(async () => {
  await settleRuns();
  rmSync(root, { recursive: true, force: true });
});
after(teardown);

test("a recovered script cannot silently overwrite a newer saved body", async () => {
  const original = sampleScriptBody();
  const script = await createScript(
    { brandId: "audit", title: original.chosenTitle, language: original.language, body: original },
    validateScriptBody,
  );
  const newer = { ...original, chosenTitle: "Newer saved copy" };
  assert.ok(
    await updateScriptBody(script.id, newer, validateScriptBody, { expectedBody: original }),
  );
  const stale = { ...original, chosenTitle: "Recovered older edit" };
  assert.equal(
    await updateScriptBody(script.id, stale, validateScriptBody, { expectedBody: original }),
    null,
  );
  const [saved] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, script.id));
  assert.deepEqual(saved.body, newer);
});

test("scan distinguishes equal-size replacements and preserves an approved asset's original bytes", async () => {
  const file = path.join(root, "input.pdf");
  const firstBytes = Buffer.from("%PDF-1.7 original A");
  writeFileSync(file, firstBytes);
  const registered = await registerFile("input.pdf", { status: "approved" });
  assert.equal(registered.status, "created");
  if (registered.status !== "created") return;
  writeFileSync(file, "%PDF-1.7 replaced B");
  assert.equal((await scanMediaRoot()).status, "ok");
  let rows = await db.select().from(schema.assets);
  assert.equal(rows.length, 2);
  const old = rows.find((row) => row.id === registered.asset.id)!;
  assert.equal(old.status, "approved");
  assert.deepEqual(readFileSync(path.join(root, old.localPath!)), firstBytes);
  assert.equal(await sha256File(path.join(root, old.localPath!)), old.sha256);
  assert.equal(rows.find((row) => row.id !== old.id)!.status, "new");
  writeFileSync(file, "%PDF-1.7 replacement with a different size");
  await scanMediaRoot();
  rows = await db.select().from(schema.assets);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.localPath)).size, 3);
  await scanMediaRoot();
  assert.equal((await db.select().from(schema.assets)).length, 3);
});

for (const mode of ["crash", "hang"] as const)
  test(`terminal ${mode} run recovers files without HF_FILE and ignores unrelated folders`, async () => {
    mkdirSync(path.join(root, "unrelated"));
    writeFileSync(path.join(root, "unrelated", "outside.pdf"), "%PDF-1.7 unrelated");
    process.env.FAKE_RECOVERY_MODE = mode;
    process.env.FAKE_RECOVERY_READY = path.join(root, "ready.txt");
    const started = await startJob({
      kind: "free",
      argument: '```json\n{"folder":"planned/run-1"}\n```',
      maxCredits: 1,
    });
    if (mode === "hang") {
      for (let i = 0; i < 100 && !existsSync(process.env.FAKE_RECOVERY_READY); i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        assert.ok(existsSync(process.env.FAKE_RECOVERY_READY));
      } finally {
        await cancelJob(started.job.id);
      }
    }
    const job = await started.finished;
    assert.equal(job.status, mode === "crash" ? "failed" : "cancelled");
    assert.deepEqual(job.outputPaths.sort(), ["planned/run-1/1.pdf", "planned/run-1/2.pdf"]);
    assert.equal((await db.select().from(schema.assets)).length, 2);
    await reapJobs();
    assert.equal((await db.select().from(schema.assets)).length, 2);
  });

const pending = (extra: Partial<typeof schema.narrations.$inferInsert> = {}) => ({
  ownerKind: "free" as const,
  ownerRef: "free:orphan",
  language: "en",
  inputText: "Synthetic text",
  textHash: "a".repeat(64),
  provider: "higgsfield" as const,
  status: "pending" as const,
  createdAt: new Date(Date.now() - 20 * 60_000),
  ...extra,
});

test("durable job preparation rolls back both the job and linked narration on failure before dispatch", async () => {
  await assert.rejects(
    startJob(
      { kind: "voice", targetRef: "voice:atomic", argument: "", maxCredits: 1 },
      {
        prepareArgument: async (tx, id) => {
          await tx.insert(schema.narrations).values(pending({ higgsfieldJobId: id }));
          throw new Error("Synthetic interruption before transaction commit");
        },
      },
    ),
    /before transaction commit/,
  );
  assert.equal((await db.select().from(schema.higgsfieldJobs)).length, 0);
  assert.equal((await db.select().from(schema.narrations)).length, 0);
});

test("old orphan pending rows are safely failed or linked from the durable manifest without submission", async () => {
  const [orphan, linked, completed] = await insertReturning(db, schema.narrations, [
    pending(),
    pending({ ownerRef: "free:linked" }),
    pending({ ownerRef: "free:done", status: "done" }),
  ]);
  const argument = voiceArgument({
    jobRef: null,
    ceilingCredits: 1,
    lines: [
      {
        lineId: linked.id,
        model: "qwen_audio_tts",
        voiceType: "preset",
        voiceId: "synthetic",
        text: linked.inputText,
        outFile: "voice/free/linked/en/take.hf.mp3",
        estimateCredits: 0.01,
      },
    ],
  });
  const [job] = await insertReturning(db, schema.higgsfieldJobs, {
    kind: "voice",
    prompt: "",
    maxCredits: 1,
    status: "running",
    pid: process.pid,
  });
  await db
    .update(schema.higgsfieldJobs)
    .set({
      prompt: buildVoiceRunPrompt({ jobId: job.id, argument, maxCredits: 1, mediaRoot: root }),
    })
    .where(eq(schema.higgsfieldJobs.id, job.id));
  assert.deepEqual((await repairOrphanedHiggsfieldTakes()).sort(), [orphan.id, linked.id].sort());
  const rows = await db.select().from(schema.narrations);
  assert.equal(rows.find((row) => row.id === orphan.id)!.status, "failed");
  assert.equal(rows.find((row) => row.id === linked.id)!.higgsfieldJobId, job.id);
  assert.equal(rows.find((row) => row.id === completed.id)!.status, "done");
});

test("voice queue commits pending takes, linkage and manifest before dispatch", async () => {
  const [profile] = await insertReturning(db, schema.voiceProfiles, {
    key: "audit-voice",
    name: "Synthetic voice",
    provider: "higgsfield",
    providerVoiceId: "synthetic",
    languages: ["en"],
    settings: {
      higgsfield: { model: "qwen_audio_tts", voiceType: "preset", voiceId: "synthetic" },
    },
  });
  process.env.FAKE_RECOVERY_MODE = "hang";
  const queued = await queueHiggsfieldVoice({
    targetRef: "voice:audit",
    maxCredits: 1,
    lines: [
      {
        ownerKind: "free",
        ownerRef: "free:audit",
        language: "en",
        voiceProfileId: profile.id,
        text: "Hello, synthetic world.",
      },
    ],
  });
  const [row] = await db
    .select()
    .from(schema.narrations)
    .where(eq(schema.narrations.id, queued.narrationIds[0]));
  assert.equal(row.status, "pending");
  assert.equal(row.higgsfieldJobId, queued.job.id);
  assert.equal(parseVoiceManifest(queued.job.prompt)?.lines[0].lineId, row.id);
  await cancelJob(queued.job.id);
  await queued.finished;
  assert.equal(
    (await db.select().from(schema.narrations).where(eq(schema.narrations.id, row.id)))[0].status,
    "failed",
  );
});
