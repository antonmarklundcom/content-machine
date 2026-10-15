import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { applicationSettings } from "@/db/schema";
import {
  automationAllowed,
  AutomationPausedError,
  parseAutomationPolicy,
  type AutomationFeature,
  type AutomationPolicy,
} from "./policy";

export async function getAutomationPolicy(): Promise<AutomationPolicy> {
  const [row] = await db
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, "automation"))
    .limit(1);
  return parseAutomationPolicy(row?.value);
}
export async function saveAutomationPolicy(value: AutomationPolicy): Promise<void> {
  const policy = parseAutomationPolicy(value);
  await db
    .insert(applicationSettings)
    .values({ key: "automation", value: policy, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { value: policy, updatedAt: new Date() } });
}
export async function isAutomationAllowed(feature: AutomationFeature): Promise<boolean> {
  return automationAllowed(await getAutomationPolicy(), feature);
}
export async function requireAutomation(feature: AutomationFeature): Promise<void> {
  if (!(await isAutomationAllowed(feature))) throw new AutomationPausedError(feature);
}
