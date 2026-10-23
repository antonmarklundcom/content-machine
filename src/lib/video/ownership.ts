export const RENDER_LEASE_TTL_MS = 2 * 60_000;
export function renderLeaseName(id: number): string {
  return `render:${id}`;
}
