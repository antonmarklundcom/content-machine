/**
 * Features that only run on Anton's PC (docs/DEPLOY-HOSTINGER.md §8): voice
 * takes, video renders, the story studio and the Higgsfield bridge need ffmpeg,
 * the logged-in Claude Code CLI, CUENTOS_ROOT or the external media drive —
 * none of which exist on the Hostinger slot. The online deploy sets
 * `APP_MODE=online`; there, these features refuse with one clear message
 * instead of failing half-way. Pure: no imports, safe in any runtime.
 */

type Env = Record<string, string | undefined>;

/** True on the online deploy (`APP_MODE=online`). Unset or anything else = the PC. */
export function isOnlineDeploy(env: Env = process.env): boolean {
  return (env.APP_MODE ?? "").trim().toLowerCase() === "online";
}

export class PcOnlyError extends Error {
  constructor(feature: string) {
    super(
      `${feature} runs on the PC, not on the online app: it needs ffmpeg, the media drive` +
        " (MEDIA_ROOT) or Claude Code. Open content-engine on your PC (start.bat) to do this.",
    );
    this.name = "PcOnlyError";
  }
}

/** Throws `PcOnlyError` on the online deploy; does nothing on the PC. */
export function assertOnPc(feature: string, env: Env = process.env): void {
  if (isOnlineDeploy(env)) throw new PcOnlyError(feature);
}
