import {
  deleteReturning,
  insertIfAbsent,
  insertReturning,
  isDuplicateKey,
  updateReturning,
  type DbHandle,
} from "@/db/mutations";
import assert from "node:assert/strict";
import { createPool } from "mysql2/promise";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { databaseOptions } from "@/db/driver";
import {
  completeSpendCommit,
  dispatchSpend,
  listUncertainSpendHolds,
  markSpendUncertain,
  monthToDateUsd,
  recordSpend,
  releaseSpend,
  reserveSpend,
  retainBatchUncertainty,
  spendStatus,
  SpendCapExceededError,
  withSpendAttempt,
  withSpendCap,
} from "@/lib/spend";
import { acquireLease, releaseLease } from "@/lib/lease";
import { setConnectionStatus, saveConnection, getConnection } from "@/lib/publish/connections";
import { generateEncryptionKey } from "@/lib/crypto";
import { cancelJob, reapJobs } from "@/lib/higgsfield/run";
import { finalizeHiggsfieldVoiceJob } from "@/lib/voice/higgsfield-takes";
import { buildVoiceRunPrompt, voiceArgument } from "@/lib/higgsfield/voice";
import { insertAnalysis } from "@/lib/analysis/run";

import { resetTables, teardown } from "./setup";

const originalEnv = {
  monthlyCap: process.env.MONTHLY_SPEND_CAP_USD,
  encryptionKey: process.env.ENCRYPTION_KEY,
  appMode: process.env.APP_MODE,
};
const recoveryPool = createPool(databaseOptions(process.env.DATABASE_URL));

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = "10";
  await resetTables();
});
after(async () => {
  if (originalEnv.monthlyCap === undefined) delete process.env.MONTHLY_SPEND_CAP_USD;
  else process.env.MONTHLY_SPEND_CAP_USD = originalEnv.monthlyCap;
  if (originalEnv.encryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEnv.encryptionKey;
  if (originalEnv.appMode === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = originalEnv.appMode;
  await recoveryPool.end();
  await teardown();
});

test("insert/update/delete helpers return only the requested projection", async () => {
  const [inserted] = await insertReturning(
    db,
    schema.clips,
    { url: "https://safety.test/projection", purpose: "learn" },
    { id: schema.clips.id, url: schema.clips.url },
  );
  assert.deepEqual(inserted, { id: inserted.id, url: "https://safety.test/projection" });

  const [updated] = await updateReturning(
    db,
    schema.clips,
    { title: "Updated" },
    eq(schema.clips.id, inserted.id),
    { id: schema.clips.id, title: schema.clips.title },
  );
  assert.deepEqual(updated, { id: inserted.id, title: "Updated" });

  const [deleted] = await deleteReturning(db, schema.clips, eq(schema.clips.id, inserted.id), {
    id: schema.clips.id,
    title: schema.clips.title,
  });
  assert.deepEqual(deleted, { id: inserted.id, title: "Updated" });
});

test("a duplicate on a different unique key is not mistaken for the requested conflict", async () => {
  const original = {
    id: 7001,
    provider: "youtube" as const,
    accountRef: "channel-a",
    label: "Original",
  };
  await db.insert(schema.integrations).values(original);

  await assert.rejects(
    insertIfAbsent(
      db,
      schema.integrations,
      { ...original, accountRef: "channel-b", label: "Must not overwrite" },
      {
        target: [schema.integrations.provider, schema.integrations.accountRef],
        set: { label: "Wrong row" },
      },
    ),
    (error: unknown) => {
      return isDuplicateKey(error);
    },
  );
  const [stillOriginal] = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.id, original.id));
  assert.equal(stillOriginal.accountRef, "channel-a");
  assert.equal(stillOriginal.label, "Original");
});

test("two independent lease callers cannot both acquire the same live name", async () => {
  const results = await Promise.all([
    acquireLease("safety-concurrent", 60_000),
    acquireLease("safety-concurrent", 60_000),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const winner = results.find((item) => item !== null)!;
  await releaseLease(winner);
});

/** Inject a separate writer after the mutation helper has captured its primary keys. */
function interleavePhantom(method: "update" | "delete", inject: () => Promise<void>): DbHandle {
  let injected = false;
  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, property) {
        if (property === "then") {
          const then = Reflect.get(target, property, target) as (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => unknown;
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            (async () => {
              if (!injected) {
                injected = true;
                await inject();
              }
              return new Promise((done, fail) => then.call(target, done, fail));
            })().then(resolve, reject);
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (...args: unknown[]) => {
              const next = value.apply(target, args);
              return next && typeof next === "object" ? wrapBuilder(next) : next;
            }
          : value;
      },
    });
  const transaction = Reflect.get(db, "transaction", db) as (...args: unknown[]) => unknown;
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction")
        return (callback: (tx: object) => Promise<unknown>, ...args: unknown[]) =>
          transaction.call(
            target,
            (tx: object) =>
              callback(
                new Proxy(tx, {
                  get(txTarget, txProperty) {
                    const value = Reflect.get(txTarget, txProperty, txTarget);
                    if (txProperty === method && typeof value === "function")
                      return (...callArgs: unknown[]) =>
                        wrapBuilder(value.apply(txTarget, callArgs));
                    return typeof value === "function" ? value.bind(txTarget) : value;
                  },
                }),
              ),
            ...args,
          );
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DbHandle;
}

for (const method of ["update", "delete"] as const) {
  test(`${method} projection does not capture a matching phantom row`, async () => {
    const [original] = await insertReturning(db, schema.clips, {
      url: `https://safety.test/phantom-${method}-original`,
      purpose: "learn",
    });
    const phantomUrl = `https://safety.test/phantom-${method}-inserted`;
    const controlled = interleavePhantom(method, async () => {
      await db.insert(schema.clips).values({ url: phantomUrl, purpose: "learn" });
    });
    const predicate = eq(schema.clips.purpose, "learn");
    if (method === "update") {
      const rows = await updateReturning(
        controlled,
        schema.clips,
        { purpose: "inspo" },
        predicate,
        { id: schema.clips.id },
      );
      assert.deepEqual(rows, [{ id: original.id }]);
    } else {
      const rows = await deleteReturning(controlled, schema.clips, predicate, {
        id: schema.clips.id,
      });
      assert.deepEqual(rows, [{ id: original.id }]);
    }
    const [phantom] = await db.select().from(schema.clips).where(eq(schema.clips.url, phantomUrl));
    assert.equal(phantom.purpose, "learn", "the new matching row was outside the captured key set");
  });
}

test("spend reservation releases when validation fails before provider dispatch", async () => {
  await assert.rejects(
    withSpendCap(2, async () => {
      throw new Error("pre-dispatch validation failure");
    }),
    /pre-dispatch validation failure/,
  );
  assert.equal((await spendStatus()).projectedUsd, 0);
});

test("unknown dispatched spend remains uncertain and blocks another paid attempt", async () => {
  await assert.rejects(
    withSpendCap(3, async () =>
      dispatchSpend(async () => {
        throw new Error("response was lost after send");
      }),
    ),
    /response was lost after send/,
  );
  const [uncertain] = await listUncertainSpendHolds();
  assert.equal(uncertain.status, "uncertain");
  assert.equal(Number(uncertain.uncertainUsd), 3);
  assert.equal((await spendStatus()).projectedUsd, 3);
  await assert.rejects(
    withSpendCap(8, async () => "must not call provider"),
    SpendCapExceededError,
  );
});

test("a provider response with missing usage cannot be committed as verified free work", async () => {
  await withSpendCap(2, async () => {
    await dispatchSpend(async () => ({ accepted: true, usage: undefined }));
    markSpendUncertain();
    completeSpendCommit();
  });
  const [hold] = await listUncertainSpendHolds();
  assert.equal(hold.status, "uncertain");
  assert.equal(Number(hold.uncertainUsd), 2);
  assert.equal((await spendStatus()).projectedUsd, 2);
});

test("accepted billing settles the hold under the same spend ledger transaction", async () => {
  await withSpendCap(4, async () => {
    await dispatchSpend(async () => ({ accepted: true }));
    await recordSpend(1.25);
  });
  assert.equal(await monthToDateUsd(), 1.25);
  const status = await spendStatus();
  assert.equal(status.projectedUsd, 1.25);
  assert.equal((await listUncertainSpendHolds()).length, 0);
});

test("recordSpend leaves dispatch pending until its outer transaction commits", async () => {
  await withSpendCap(2, async () => {
    await dispatchSpend(async () => ({ accepted: true, usage: { inputTokens: 1 } }));
    await assert.rejects(
      db.transaction(async (tx) => {
        await recordSpend(0.75, new Date(), tx);
        throw new Error("synthetic outer transaction rollback");
      }),
      /synthetic outer transaction rollback/,
    );
  });
  assert.equal(await monthToDateUsd(), 2, "the rolled-back billing row is replaced by uncertainty");
  assert.equal(Number((await listUncertainSpendHolds())[0].uncertainUsd), 2);
});

test("verified late billing replaces an uncertain estimate exactly once", async () => {
  let finishProvider!: (value: { usage: { inputTokens: number } }) => void;
  let entered!: () => void;
  const inFlight = new Promise<void>((resolve) => (entered = resolve));
  const result = withSpendCap(3, async () => {
    await dispatchSpend(
      () =>
        new Promise((resolve) => {
          finishProvider = resolve;
          entered();
        }),
    );
    await recordSpend(1.25);
  });
  await inFlight;
  const [live] = await db
    .select()
    .from(schema.spendHolds)
    .where(eq(schema.spendHolds.status, "held"));
  await db
    .update(schema.spendHolds)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.spendHolds.id, live.id));
  await spendStatus();
  finishProvider({ usage: { inputTokens: 10 } });
  await result;
  const [settled] = await db.select().from(schema.spendHolds).where(eq(schema.spendHolds.id, live.id));
  assert.equal(settled.status, "released");
  assert.equal(Number(settled.actualUsd), 1.25);
  assert.equal(Number(settled.uncertainUsd), 0);
  assert.equal(await monthToDateUsd(), 1.25, "the estimate is replaced by verified actual spend");
  assert.equal((await spendStatus()).projectedUsd, 1.25);
  await releaseSpend(live.id, true);
  assert.equal(await monthToDateUsd(), 1.25, "repeating verified release does not subtract twice");
});

test("a partially billed concurrent attempt retains only its unknown remainder", async () => {
  await withSpendCap(4, async () => {
    await withSpendAttempt(async () => {
      await dispatchSpend(async () => ({ accepted: true }));
      await recordSpend(1.25);
    });
    await assert.rejects(
      withSpendAttempt(() => dispatchSpend(async () => Promise.reject(new Error("stream lost")))),
      /stream lost/,
    );
  });
  const [uncertain] = await listUncertainSpendHolds();
  assert.equal(Number(uncertain.settledUsd), 1.25);
  assert.equal(Number(uncertain.uncertainUsd), 2.75);
  assert.equal((await spendStatus()).projectedUsd, 4);
});

test("an accepted batch whose durable ledger write fails stays uncertain", async () => {
  await assert.rejects(
    withSpendCap(2, async () => {
      await dispatchSpend(async () => ({ remoteBatchId: "synthetic-accepted" }));
      throw new Error("batch identity write failed");
    }),
    /batch identity write failed/,
  );
  assert.equal(Number((await listUncertainSpendHolds())[0].uncertainUsd), 2);
  assert.equal((await spendStatus()).projectedUsd, 2);
});

test("late finally cannot release an expired hold after another call marked it uncertain", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  const work = withSpendCap(2, async () => {
    entered();
    await gate;
  });
  await started;
  const [hold] = await db.select().from(schema.spendHolds);
  await db
    .update(schema.spendHolds)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.spendHolds.id, hold.id));
  assert.equal((await spendStatus()).projectedUsd, 2);
  finish();
  await work;
  const [late] = await db
    .select()
    .from(schema.spendHolds)
    .where(eq(schema.spendHolds.id, hold.id));
  assert.equal(late.status, "released", "successful work with no dispatch verifies that nothing was paid");
  assert.equal((await spendStatus()).projectedUsd, 0);
});

test("releaseSpend without verified outcome never clears an uncertain estimate", async () => {
  const id = await reserveSpend(2);
  assert.ok(id);
  await db
    .update(schema.spendHolds)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.spendHolds.id, id));
  await spendStatus();
  await releaseSpend(id);
  const [hold] = await listUncertainSpendHolds();
  assert.equal(hold.status, "uncertain");
  assert.equal((await spendStatus()).projectedUsd, 2);
});

test("batch uncertainty transfer is atomic and idempotent", async () => {
  await db.insert(schema.batches).values({
    providerBatchId: "safety-batch-uncertain",
    status: "ended",
    model: "gemini-3.1-flash-lite",
    estimatedUsd: "2.500000",
  });
  assert.equal(await retainBatchUncertainty("safety-batch-uncertain", "synthetic response lost"), 2.5);
  assert.equal(await retainBatchUncertainty("safety-batch-uncertain", "retry after crash"), 0);
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.providerBatchId, "safety-batch-uncertain"));
  assert.equal(batch.status, "uncertain");
  const holds = await listUncertainSpendHolds();
  assert.equal(holds.length, 1);
  assert.equal(holds[0].owner, "batch:safety-batch-uncertain");
  assert.equal(Number(holds[0].uncertainUsd), 2.5);
  assert.equal(await monthToDateUsd(), 2.5, "the estimated bill entered spend once");
});

test("analysis and billing roll back together and a collection retry records one result and charge", async () => {
  const [video] = await insertReturning(db, schema.videos, {
    youtubeId: `safety${process.pid}${Date.now()}`,
    title: "Synthetic batch result",
  });
  const trigger = `safety_spend_failure_${process.pid}_${Date.now()}`;
  await recoveryPool.query(
    `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON spend_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic spend ledger failure'`,
  );
  const input = {
    videoId: video.id,
    model: "gemini-3.1-flash-lite" as const,
    batchId: `safety-batch-${process.pid}-${video.id}`,
    status: "failed" as const,
    error: "Synthetic collected result",
    usage: { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.5,
  };
  try {
    await assert.rejects(insertAnalysis(input), /synthetic spend ledger failure/i);
    assert.equal(
      (await db.select().from(schema.analyses).where(eq(schema.analyses.videoId, video.id))).length,
      0,
      "failed billing transaction did not leave a collected result behind",
    );
    assert.equal(await monthToDateUsd(), 0);
  } finally {
    await recoveryPool.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }

  const first = await insertAnalysis(input);
  const retry = await insertAnalysis(input);
  assert.equal(retry.id, first.id, "same batch/video retry resolves to the durable row");
  assert.equal(
    (await db.select().from(schema.analyses).where(eq(schema.analyses.videoId, video.id))).length,
    1,
  );
  assert.equal(await monthToDateUsd(), 0.5, "the successful retry billed exactly once");
});

test("an expired token's stale status write cannot expire a reconnected credential", async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  const input = (accessToken: string) => ({
    provider: "youtube" as const,
    accountRef: "channel-fence",
    label: "synthetic channel",
    tokens: {
      accessToken,
      refreshToken: `refresh-${accessToken}`,
      accessExpiresAt: new Date(Date.now() + 60 * 60_000),
    },
    scopes: [],
    loginExpiresAt: null,
  });
  const old = await saveConnection(input("token-a"));
  await saveConnection(input("token-b"));
  await setConnectionStatus(old.id, "expired", "stale 401", old.credentialVersion);
  const current = await getConnection("youtube", old.id);
  assert.equal(current?.credentialVersion, old.credentialVersion + 1);
  assert.equal(current?.status, "ok");
});

test("concurrent saves for one provider channel keep a single integration row", async () => {
  process.env.ENCRYPTION_KEY = generateEncryptionKey();
  const input = (token: string) => ({
    provider: "youtube" as const,
    accountRef: "one-channel-only",
    label: token,
    tokens: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      accessExpiresAt: new Date(Date.now() + 60 * 60_000),
    },
    scopes: [],
    loginExpiresAt: null,
  });
  await Promise.all([saveConnection(input("one")), saveConnection(input("two"))]);
  assert.equal(
    (
      await db
        .select()
        .from(schema.integrations)
        .where(eq(schema.integrations.accountRef, "one-channel-only"))
    ).length,
    1,
  );
});

test("online mode cannot reap or cancel a persisted local Higgsfield process", async () => {
  const [job] = await insertReturning(db, schema.higgsfieldJobs, {
    kind: "free",
    prompt: "synthetic persisted job",
    maxCredits: 1,
    status: "running",
    pid: 990011,
    workerHost: "different-pc",
    workerInstance: "instance-a",
    heartbeatAt: new Date(0),
  });
  process.env.APP_MODE = "online";
  assert.deepEqual(await reapJobs(new Date()), []);
  await assert.rejects(cancelJob(job.id), /owning PC worker/);
  const [untouched] = await db
    .select()
    .from(schema.higgsfieldJobs)
    .where(eq(schema.higgsfieldJobs.id, job.id));
  assert.equal(untouched.status, "running");
  assert.equal(untouched.pid, 990011, "no process is killed based on a persisted PID");
});

test("an old voice finalizer cannot claim a take reassigned to its successor job", async () => {
  const [take] = await insertReturning(db, schema.narrations, {
    ownerKind: "free",
    ownerRef: "free:fenced-take",
    language: "en",
    inputText: "Synthetic voice line",
    textHash: "b".repeat(64),
    provider: "higgsfield",
    status: "pending",
  });
  const argument = voiceArgument({
    jobRef: null,
    ceilingCredits: 1,
    lines: [
      {
        lineId: take.id,
        model: "qwen_audio_tts",
        voiceType: "preset",
        voiceId: "synthetic",
        text: take.inputText,
        outFile: "voice/free/fenced/en/take.hf.mp3",
        estimateCredits: 0.01,
      },
    ],
  });
  const [oldJob] = await insertReturning(db, schema.higgsfieldJobs, {
    kind: "voice",
    prompt: buildVoiceRunPrompt({ jobId: 8001, argument, maxCredits: 1, mediaRoot: "." }),
    maxCredits: 1,
    status: "failed",
  });
  const [successor] = await insertReturning(db, schema.higgsfieldJobs, {
    kind: "voice",
    prompt: "successor job",
    maxCredits: 0,
    status: "running",
  });
  await db
    .update(schema.narrations)
    .set({ higgsfieldJobId: successor.id })
    .where(eq(schema.narrations.id, take.id));

  const result = await finalizeHiggsfieldVoiceJob(oldJob.id, null);
  assert.deepEqual(result.done, []);
  assert.deepEqual(result.failed, []);
  const [stillPending] = await db
    .select()
    .from(schema.narrations)
    .where(eq(schema.narrations.id, take.id));
  assert.equal(stillPending.status, "pending");
  assert.equal(stillPending.higgsfieldJobId, successor.id);
});
