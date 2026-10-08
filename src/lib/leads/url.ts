/**
 * Lead links (build 4 §3.G). A post's call to action points at the brand's
 * lead page (its site or a VenderCRM form) with UTM parameters, so a lead that
 * lands in VenderCRM says which platform, account and post it came from.
 * Pure: no database, no fetch.
 */

export type LeadUrlParts = {
  /** `instagram`, `facebook`, … — becomes `utm_source`. */
  platform: string;
  /** The account's handle; the default `utm_campaign` when no campaign is given. */
  accountHandle: string;
  postId: number;
  campaign?: string | null;
};

export class LeadUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadUrlError";
  }
}

/** Lower-case, `@` dropped, anything but letters/digits/`-_.` turned into `-`. */
export function utmToken(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Null when `base` is an http(s) URL a lead link can be built on, else why not. */
export function leadBaseProblem(base: string): string | null {
  const trimmed = base.trim();
  if (!trimmed) return "The lead base URL is empty.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "The lead base URL is not a full URL (it needs https://…).";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "The lead base URL must start with https:// or http://.";
  }
  if (trimmed.length > 900) return "The lead base URL is too long.";
  return null;
}

/**
 * `base` plus `utm_source=<platform>`, `utm_medium=social`,
 * `utm_campaign=<campaign or handle>` and `utm_content=post-<id>`.
 *
 * The base is kept byte for byte: its own query parameters (including any
 * `utm_*` it already sets — those win, they are never overwritten) and its
 * `#fragment` survive. The new parameters are appended before the fragment.
 * Throws `LeadUrlError` for a base that is not an http(s) URL.
 */
export function buildLeadUrl(base: string, parts: LeadUrlParts): string {
  const problem = leadBaseProblem(base);
  if (problem) throw new LeadUrlError(problem);
  const trimmed = base.trim();

  const hashAt = trimmed.indexOf("#");
  const beforeHash = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
  const fragment = hashAt >= 0 ? trimmed.slice(hashAt) : "";
  const queryAt = beforeHash.indexOf("?");
  const existing = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");

  const campaign = utmToken(parts.campaign ?? "") || utmToken(parts.accountHandle) || "social";
  const wanted: [string, string][] = [
    ["utm_source", utmToken(parts.platform) || "social"],
    ["utm_medium", "social"],
    ["utm_campaign", campaign],
    ["utm_content", `post-${parts.postId}`],
  ];
  const added = wanted
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  if (added.length === 0) return trimmed;

  let head = beforeHash;
  if (queryAt < 0) head += "?";
  else if (!head.endsWith("?") && !head.endsWith("&")) head += "&";
  return `${head}${added.join("&")}${fragment}`;
}
