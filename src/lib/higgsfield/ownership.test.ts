import assert from "node:assert/strict";
import { test } from "node:test";
import { ownedByWorker, staleWorkerJob } from "./ownership";

const pc = { host: "pc", instance: "current-process" };
const now = new Date("2026-10-08T12:00:00Z");
const old = new Date("2026-10-08T11:30:00Z");

test("a persisted PID never gives another host or restarted process ownership", () => {
  const job = {
    workerHost: "pc",
    workerInstance: "old-process",
    heartbeatAt: old,
    pid: process.pid,
  };
  assert.equal(ownedByWorker(job, pc), false, "PID reuse does not grant ownership");
  assert.equal(ownedByWorker(job, { host: "hostinger", instance: "old-process" }), false);
  assert.equal(ownedByWorker({ ...job, workerInstance: pc.instance }, pc), true);
});

test("only identified same-host rows with stale heartbeats are cleanup candidates", () => {
  const job = { workerHost: "pc", workerInstance: "old-process", heartbeatAt: old };
  assert.equal(staleWorkerJob(job, now, 600_000, pc), true);
  assert.equal(staleWorkerJob({ ...job, heartbeatAt: now }, now, 600_000, pc), false);
  assert.equal(staleWorkerJob({ ...job, workerHost: "foreign-pc" }, now, 600_000, pc), false);
  assert.equal(staleWorkerJob({ ...job, workerInstance: null }, now, 600_000, pc), false);
  assert.equal(staleWorkerJob({ ...job, heartbeatAt: null }, now, 600_000, pc), false);
});
