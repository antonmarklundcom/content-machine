"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { AUTOMATION_FEATURES, DEFAULT_AUTOMATION_POLICY } from "./policy";
import { saveAutomationPolicy } from "./store";
export async function updateAutomation(form: FormData): Promise<void> {
  await requireOwner("change automation");
  await saveAutomationPolicy({
    enabled: form.get("enabled") === "on",
    ...Object.fromEntries(AUTOMATION_FEATURES.map((key) => [key, form.get(key) === "on"])),
  } as typeof DEFAULT_AUTOMATION_POLICY);
  revalidatePath("/settings");
  revalidatePath("/youtube/sources");
  revalidatePath("/");
}
export async function pauseAutomation(): Promise<void> {
  await requireOwner("pause automation");
  await saveAutomationPolicy(DEFAULT_AUTOMATION_POLICY);
  revalidatePath("/settings");
  revalidatePath("/youtube/sources");
  revalidatePath("/");
}
