"use server";

/**
 * The Higgsfield bridge's writes from the UI (build 4 §1.14): preflight,
 * start, cancel, retry. Owner-only — a run spends subscription credits.
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message.
 *
 * A start returns as soon as the CLI is spawned; the run goes on in this
 * server process and writes its progress to `higgsfield_jobs`.
 */

import { revalidatePath } from "next/cache";

import { HIGGSFIELD_JOB_KINDS, type HiggsfieldJobKind } from "@/db/schema";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { refreshPreflight, type Preflight } from "@/lib/higgsfield/preflight";
import {
  cancelJob,
  HiggsfieldBusyError,
  HiggsfieldInputError,
  retryJob,
  startJob,
  type Started,
} from "@/lib/higgsfield/run";

export type HiggsfieldActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type StartHiggsfieldInput = {
  kind: HiggsfieldJobKind;
  targetRef?: string | null;
  brandId?: string | null;
  maxCredits: number;
  description?: string | null;
  range?: string | null;
};

async function owner(action: string): Promise<string | null> {
  try {
    await requireOwner(action);
    return null;
  } catch (error) {
    if (error instanceof ForbiddenError) return "Only the owner can start Higgsfield runs.";
    throw error;
  }
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof HiggsfieldInputError || error instanceof HiggsfieldBusyError)
    return { ok: false, error: error.message };
  console.error("[higgsfield]", error);
  return { ok: false, error: "The run could not be started. See the server log." };
}

function launched(started: Started): HiggsfieldActionResult<{ jobId: number; status: string }> {
  // The run outlives this request; its outcome is in the row.
  started.finished.catch((error) => console.error("[higgsfield] run", error));
  revalidatePath("/higgsfield");
  return { ok: true, jobId: started.job.id, status: started.job.status };
}

export async function higgsfieldPreflightAction(): Promise<
  HiggsfieldActionResult<{ preflight: Preflight }>
> {
  const denied = await owner("check Higgsfield");
  if (denied) return { ok: false, error: denied };
  return { ok: true, preflight: await refreshPreflight() };
}

export async function startHiggsfieldJobAction(
  input: StartHiggsfieldInput,
): Promise<HiggsfieldActionResult<{ jobId: number; status: string }>> {
  const denied = await owner("start a Higgsfield run");
  if (denied) return { ok: false, error: denied };
  if (!input || !HIGGSFIELD_JOB_KINDS.includes(input.kind))
    return { ok: false, error: "Unknown kind of run." };
  try {
    return launched(
      await startJob({
        kind: input.kind,
        targetRef: input.targetRef ?? null,
        brandId: input.brandId ?? null,
        maxCredits: Number(input.maxCredits),
        description: input.description ?? null,
        range: input.range ?? null,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function cancelHiggsfieldJobAction(
  id: number,
): Promise<HiggsfieldActionResult<{ status: string }>> {
  const denied = await owner("cancel a Higgsfield run");
  if (denied) return { ok: false, error: denied };
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Not a job id." };
  const row = await cancelJob(id);
  if (!row) return { ok: false, error: `Job ${id} is not running.` };
  revalidatePath("/higgsfield");
  return { ok: true, status: row.status };
}

export async function retryHiggsfieldJobAction(
  id: number,
  maxCredits?: number,
): Promise<HiggsfieldActionResult<{ jobId: number; status: string }>> {
  const denied = await owner("start a Higgsfield run");
  if (denied) return { ok: false, error: denied };
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Not a job id." };
  try {
    return launched(await retryJob(id, maxCredits === undefined ? undefined : Number(maxCredits)));
  } catch (error) {
    return failure(error);
  }
}
