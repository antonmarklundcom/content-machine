import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { ForbiddenError } from "./roles";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS, verifySessionToken } from "./token";

/**
 * The session secret. Required — there is no development fallback on purpose:
 * a default secret that works locally is a default secret that ships.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return secret;
}

export async function startSession(userId: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(userId, sessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production only: over plain http (a local dev server) a secure
    // cookie is silently dropped and login appears to do nothing.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The current user, or null.
 *
 * Re-reads the row rather than trusting the token's contents beyond the id: a
 * deleted user, or one whose role changed, must not keep the access their
 * token was minted with.
 */
export async function getSession(): Promise<User | null> {
  const store = await cookies();
  const payload = await verifySessionToken(store.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!payload) return null;

  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  return user ?? null;
}

/** For pages and actions that must not run for a signed-out visitor. */
export async function requireUser(): Promise<User> {
  const user = await getSession();
  if (!user) redirect("/youtube/login");
  return user;
}

/**
 * The owner gate (PR-24). The UI hides owner-only controls, but hiding a button
 * is presentation, not permission — a server action is a public endpoint and
 * has to check for itself.
 */
export async function requireOwner(action: string): Promise<User> {
  const user = await requireUser();
  if (user.role !== "owner") throw new ForbiddenError(action);
  return user;
}
