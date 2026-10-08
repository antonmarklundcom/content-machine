/**
 * GitHub README grounding for learn summaries, ported from aiinsights'
 * `github.ts`: a github.com link gets its README excerpt so the steps come
 * from the repo, not from a guess at its name. `GITHUB_TOKEN` is optional
 * (it only raises the unauthenticated rate limit).
 */

const README_TIMEOUT_MS = 10_000;
/** Read at most this much of the response; the excerpt kept is smaller still. */
const README_MAX_BYTES = 200_000;
export const README_EXCERPT_CHARS = 6_000;

/** Paths under github.com that are not `<owner>/<repo>`. */
const NOT_OWNERS = new Set([
  "orgs",
  "users",
  "settings",
  "marketplace",
  "features",
  "topics",
  "collections",
  "explore",
  "sponsors",
  "login",
  "about",
  "pricing",
  "search",
]);

/** `{ owner, repo }` of a github.com repo link, or null. */
export function githubRepoFromUrl(input: string): { owner: string; repo: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "github.com") return null;
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo || NOT_OWNERS.has(owner.toLowerCase())) return null;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

/** The first github.com repo link in a piece of text (a note, a caption). */
export function findGithubRepoUrl(text: string | null | undefined): string | null {
  for (const m of (text ?? "").matchAll(/https?:\/\/(?:www\.)?github\.com\/[^\s<>"')\]]+/gi)) {
    const ref = githubRepoFromUrl(m[0]);
    if (ref) return `https://github.com/${ref.owner}/${ref.repo}`;
  }
  return null;
}

/**
 * The repo's README, trimmed to an excerpt, or null on any failure (best
 * effort: a missing README must never fail the summary). `fetchImpl` is the
 * test seam.
 */
export async function fetchRepoReadme(
  repoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const ref = githubRepoFromUrl(repoUrl);
  if (!ref) return null;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw+json",
    "User-Agent": "content-engine-learn",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/readme`,
      { headers, signal: AbortSignal.timeout(README_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > README_MAX_BYTES * 10) return null;
    const text = (await res.text()).slice(0, README_MAX_BYTES);
    return text.slice(0, README_EXCERPT_CHARS).trim() || null;
  } catch {
    return null;
  }
}
