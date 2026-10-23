type Env = Record<string, string | undefined>;
export function groundingBudgetMode(env: Env = process.env): "estimated" | "strict" {
  const mode = (env.GROUNDING_BUDGET_MODE ?? "estimated").trim().toLowerCase();
  if (mode !== "estimated" && mode !== "strict")
    throw new Error("GROUNDING_BUDGET_MODE must be estimated or strict.");
  return mode;
}
/** Google Search has no enforceable maximum-query parameter for this adapter. */
export function assertGroundingBudgetPolicy(env: Env = process.env): void {
  if (groundingBudgetMode(env) === "strict")
    throw new Error(
      "Strict budget mode blocks Google Search grounding because its final query cost cannot be bounded before dispatch. Use a source-based task without Search, or deliberately select estimated grounding in Settings.",
    );
}
