export const AUTOMATION_FEATURES = [
  "youtubeMonitoring",
  "captureAnalysis",
  "learningSummaries",
  "publishing",
] as const;
export type AutomationFeature = (typeof AUTOMATION_FEATURES)[number];
export type AutomationPolicy = Record<AutomationFeature | "enabled", boolean>;
export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  enabled: false,
  youtubeMonitoring: false,
  captureAnalysis: false,
  learningSummaries: false,
  publishing: false,
};

/** Only literal true enables work; missing/malformed fields fail closed. */
export function parseAutomationPolicy(value: unknown): AutomationPolicy {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.keys(DEFAULT_AUTOMATION_POLICY).map((key) => [key, raw[key] === true]),
  ) as AutomationPolicy;
}
export function automationAllowed(policy: AutomationPolicy, feature: AutomationFeature): boolean {
  return policy.enabled && policy[feature];
}
export class AutomationPausedError extends Error {
  constructor(feature: AutomationFeature) {
    super(`Automatic ${feature} is paused. Change Automation in Settings to enable it.`);
    this.name = "AutomationPausedError";
  }
}
