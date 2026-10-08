import assert from "node:assert/strict";
import { test } from "node:test";
import { JobState } from "@google/genai";
import { batchFailureReason, isStaleBatch, mapProviderStatus, STALE_BATCH_HOURS } from "./batch";

/**
 * What these guard, across the Anthropic → Gemini swap (PLAN.md §5.O3): a
 * failed batch entry has to record something a reader can act on. The original
 * bug was an error envelope whose own type was the constant "error", so a
 * billing failure and a malformed request were indistinguishable in the
 * analyses table. Gemini's JobError carries a status code instead, and the code
 * is the discriminator — dropping it would reintroduce the same blindness under
 * a new provider.
 */

function errored(code: number, message: string) {
  return { code, message, details: [] };
}

test("errored: reports the status code, not just a generic failure", () => {
  const reason = batchFailureReason(errored(400, "maxOutputTokens too large"));
  assert.equal(reason, "batch error: 400: maxOutputTokens too large");
  assert.ok(!reason.includes("unknown_error"));
});

test("errored: distinguishes failures that would otherwise collapse into one string", () => {
  const billing = batchFailureReason(errored(403, "billing account is not active"));
  const rate = batchFailureReason(errored(429, "slow down"));
  assert.notEqual(billing, rate);
  assert.ok(billing.includes("403"));
  assert.ok(rate.includes("429"));
});

test("errored: falls back to the code alone when the message is empty", () => {
  assert.equal(batchFailureReason(errored(500, "   ")), "batch error: 500");
});

test("errored: survives an error object missing its detail, and never reads as free", () => {
  assert.equal(batchFailureReason({}), "batch error: unknown_error");
  assert.equal(batchFailureReason(undefined), "batch error: unknown_error");
  assert.equal(batchFailureReason(null), "batch error: unknown_error");
});

test("only a SUCCEEDED job is collectable; anything else stays open", () => {
  assert.equal(mapProviderStatus(JobState.JOB_STATE_SUCCEEDED), "ended");
  assert.equal(mapProviderStatus(JobState.JOB_STATE_RUNNING), "in_progress");
  assert.equal(mapProviderStatus(JobState.JOB_STATE_QUEUED), "in_progress");
  assert.equal(mapProviderStatus(JobState.JOB_STATE_PENDING), "in_progress");
  // Mid-cancel can still settle with results that were already paid for, so
  // calling it terminal here would drop them.
  assert.equal(mapProviderStatus(JobState.JOB_STATE_CANCELLING), "in_progress");
  assert.equal(mapProviderStatus(JobState.JOB_STATE_PAUSED), "in_progress");
  // A state this app has never seen must not read as collectable either.
  assert.equal(mapProviderStatus(undefined), "in_progress");
  assert.equal(mapProviderStatus("JOB_STATE_SOMETHING_NEW"), "in_progress");
});

/**
 * PR-27: an unreadable batch row used to be retried on every poll forever. Since
 * PR-26 it also holds its estimate against the monthly cap, so "harmless noise"
 * became "eventually refuses all work". The cutoff decides when to give up, and
 * being wrong in the early direction discards results that were paid for.
 */

const HOUR = 3_600_000;

test("a batch is not stale until the cutoff has fully elapsed", () => {
  const submitted = new Date("2026-08-01T00:00:00Z");
  const at = (hours: number) => new Date(submitted.getTime() + hours * HOUR);

  // The provider's own ceiling is 24 hours: a batch that is merely late must
  // stay open, because its results are still readable and already paid for.
  assert.equal(isStaleBatch(submitted, at(1)), false);
  assert.equal(isStaleBatch(submitted, at(24)), false);
  assert.equal(isStaleBatch(submitted, at(71.9)), false);
  assert.equal(isStaleBatch(submitted, at(STALE_BATCH_HOURS)), true, "exactly at the cutoff");
  assert.equal(isStaleBatch(submitted, at(240)), true);
});

test("clock skew backwards never makes a batch stale", () => {
  // submitted_at is written by MySQL and compared against this process's clock;
  // if they disagree the answer must fail towards "keep waiting".
  const submitted = new Date("2026-08-01T00:00:00Z");
  assert.equal(isStaleBatch(submitted, new Date("2026-07-31T00:00:00Z")), false);
});

test("the cutoff is configurable per call, for tests and for tuning", () => {
  const submitted = new Date("2026-08-01T00:00:00Z");
  const twoHoursLater = new Date(submitted.getTime() + 2 * HOUR);
  assert.equal(isStaleBatch(submitted, twoHoursLater, 1), true);
  assert.equal(isStaleBatch(submitted, twoHoursLater, 3), false);
});
