import type { User } from "@/db/schema";

/**
 * The permission boundary is spend, not CRUD (PLAN.md §9 PR-24).
 *
 * An employee can add and pause sources, ingest metadata, and read everything —
 * all of which is free. What they cannot do is start work that costs money, or
 * destroy work that has already been paid for. Those two are the same category
 * from the owner's point of view: both turn money into nothing.
 */
export class ForbiddenError extends Error {
  constructor(action: string) {
    super(`Only the owner can ${action}.`);
    this.name = "ForbiddenError";
  }
}

export function isOwner(user: User | null): boolean {
  return user?.role === "owner";
}

/** Both authenticated roles may prepare content and inspect library media. */
export function canAccessAuthoringMedia(user: User | null): boolean {
  return user !== null;
}

/**
 * The server-side gate itself lives in ./session (requireOwner) — this module
 * stays free of `server-only` and of any database import so the UI and its
 * tests can use isOwner() without dragging a connection along.
 */
