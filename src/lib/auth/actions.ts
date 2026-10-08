"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { endSession, startSession } from "./session";

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

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) return { ok: false, error: "Wrong email or password." };

  await startSession(user.id);
  redirect("/youtube");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/youtube/login");
}
