"use server";

/**
 * Settings writes (local mode, §1.27). Two guards: the owner, and a request
 * that reached the app on localhost — a deployed copy must never rewrite its
 * own environment from a web form.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { resetGeminiClient } from "@/lib/ai";
import { aiProvider } from "@/lib/ai-cli";
import { requireOwner } from "@/lib/auth/session";
import { writeEnv } from "@/lib/settings/envfile";
import { EDITABLE_KEYS } from "@/lib/settings/fields";

export type SettingsResult = { ok: true; message?: string } | { ok: false; error: string };

const ENV_PATH = () => path.join(process.cwd(), ".env");

export async function isLocalRequest(): Promise<boolean> {
  if (process.env.VERCEL) return false;
  const host = ((await headers()).get("host") ?? "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

async function guard(): Promise<string | null> {
  try {
    await requireOwner("change settings");
  } catch {
    return "Only the owner can change settings.";
  }
  if (!(await isLocalRequest())) return "Settings can only be changed on localhost.";
  return null;
}

export async function saveSettingsAction(
  _prev: SettingsResult | null,
  form: FormData,
): Promise<SettingsResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };

  const updates: Record<string, string | null> = {};
  for (const key of EDITABLE_KEYS) {
    if (form.get(`clear:${key}`) === "on") {
      updates[key] = null;
      continue;
    }
    const raw = form.get(key);
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "") continue; // empty = keep
    if (/[\r\n]/.test(value)) return { ok: false, error: `${key} must be one line.` };
    updates[key] = value;
  }
  if (updates.MONTHLY_SPEND_CAP_USD && !/^\d+(\.\d+)?$/.test(updates.MONTHLY_SPEND_CAP_USD)) {
    return { ok: false, error: "The spend cap must be a number, e.g. 20." };
  }
  if (Object.keys(updates).length === 0) return { ok: true };

  const current = await readFile(ENV_PATH(), "utf8").catch(() => "");
  try {
    await writeFile(ENV_PATH(), writeEnv(current, updates), "utf8");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // Apply now: most code reads process.env at call time.
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  resetGeminiClient();
  revalidatePath("/settings");
  return { ok: true };
}

function runVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["--version"], { shell: process.platform === "win32" });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timed out"));
    }, 15000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`exit code ${code}`));
    });
  });
}

/** A free check that the saved value works. Never spends money. */
export async function testSettingAction(
  which: "gemini" | "youtube" | "cli",
): Promise<SettingsResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    if (which === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, error: "No Gemini key saved yet." };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
      );
      return res.ok
        ? { ok: true, message: "Gemini key works." }
        : { ok: false, error: `Gemini said HTTP ${res.status}. Check the key.` };
    }
    if (which === "youtube") {
      const key = process.env.YOUTUBE_API_KEY;
      if (!key) return { ok: false, error: "No YouTube key saved yet." };
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`,
      );
      return res.ok
        ? { ok: true, message: "YouTube key works (used 1 of 10,000 free daily units)." }
        : {
            ok: false,
            error: `YouTube said HTTP ${res.status}. Is “YouTube Data API v3” enabled for this key's project?`,
          };
    }
    const provider = aiProvider();
    if (provider === "gemini")
      return { ok: true, message: "Using the Gemini API — nothing to test here." };
    const bin =
      provider === "claude-cli"
        ? process.env.CLAUDE_CLI_BIN || "claude"
        : process.env.CODEX_CLI_BIN || "codex";
    const version = await runVersion(bin);
    return {
      ok: true,
      message: `${bin} found: ${version}. Make sure you have logged in to it once.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Test failed: ${err instanceof Error ? err.message : String(err)}. Is it installed and on PATH?`,
    };
  }
}
