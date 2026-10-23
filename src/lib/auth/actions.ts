"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { endSession, startSession } from "./session";
import { clearLoginAttempts, consumeLoginAttempt } from "./throttle";

export type LoginResult = { ok: false; error: string };

/**
 * Login (PLAN.md §9 PR-23).
 *
 * One failure message for every cause — unknown email, no password set, wrong
 * password. Distinguishing them tells an attacker which addresses exist, and
 * tells a legitimate user nothing they can act on that "check both" doesn't.
 */
export async function login(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { ok: false, error: "Enter an email and a password." };
  if (email.length > 255 || password.length > 1024)
    return { ok: false, error: "Wrong email or password." };
  if (!(await consumeLoginAttempt(email)))
    return { ok: false, error: "Too many sign-in attempts. Try again in 15 minutes." };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) return { ok: false, error: "Wrong email or password." };
  await clearLoginAttempts(email);

  await startSession(user.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/youtube/login");
}

/** Return a safe retry message instead of relying on production error details. */
export async function logoutWithResult(
  _previous: LoginResult | null,
  _form: FormData,
): Promise<LoginResult> {
  try {
    await endSession();
  } catch {
    return {
      ok: false,
      error:
        "Sign-out could not be recorded. Please retry; your session was kept so it can be revoked safely.",
    };
  }
  redirect("/youtube/login");
}
