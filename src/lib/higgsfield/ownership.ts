import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export type WorkerIdentity = { host: string; instance: string };
export type JobOwnership = {
  workerHost: string | null;
  workerInstance: string | null;
  heartbeatAt: Date | null;
};

/** A restart always gets a new instance; numeric process IDs are never identity. */
export const workerIdentity: WorkerIdentity = {
  host: (process.env.HIGGSFIELD_WORKER_HOST?.trim() || hostname()).toLowerCase().slice(0, 255),
  instance: randomUUID(),
};

export function ownedByWorker(job: JobOwnership, identity = workerIdentity): boolean {
  return job.workerHost === identity.host && job.workerInstance === identity.instance;
}

/** Legacy/foreign rows require their owning worker; a missing heartbeat proves nothing. */
export function staleWorkerJob(
  job: JobOwnership,
  now: Date,
  graceMs: number,
  identity = workerIdentity,
): boolean {
  return !!(
    job.workerHost === identity.host &&
    job.workerInstance &&
    job.heartbeatAt &&
    job.heartbeatAt.getTime() < now.getTime() - graceMs
  );
}
