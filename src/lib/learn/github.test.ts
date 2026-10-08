import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchRepoReadme,
  findGithubRepoUrl,
  githubRepoFromUrl,
  README_EXCERPT_CHARS,
} from "./github";

test("githubRepoFromUrl reads owner/repo and refuses non-repo pages", () => {
  assert.deepEqual(githubRepoFromUrl("https://github.com/anthropics/claude-code"), {
    owner: "anthropics",
    repo: "claude-code",
  });
  assert.deepEqual(githubRepoFromUrl("https://www.github.com/a/b.git/tree/main"), {
    owner: "a",
    repo: "b",
  });
  assert.equal(githubRepoFromUrl("https://github.com/anthropics"), null);
  assert.equal(githubRepoFromUrl("https://github.com/topics/ai"), null);
  assert.equal(githubRepoFromUrl("https://gitlab.com/a/b"), null);
  assert.equal(githubRepoFromUrl("ftp://github.com/a/b"), null);
  assert.equal(githubRepoFromUrl("not a url"), null);
});

test("findGithubRepoUrl finds the first repo link in a note", () => {
  assert.equal(
    findGithubRepoUrl(
      "see (https://github.com/x/y/blob/main/README.md) and https://github.com/z/w",
    ),
    "https://github.com/x/y",
  );
  assert.equal(findGithubRepoUrl("no links"), null);
  assert.equal(findGithubRepoUrl(null), null);
});

test("fetchRepoReadme asks the API for the raw README, sends the token, trims", async () => {
  const seen: { url: string; auth?: string }[] = [];
  process.env.GITHUB_TOKEN = "tok";
  const fake = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), auth: (init?.headers as Record<string, string>).Authorization });
    return new Response("#".repeat(README_EXCERPT_CHARS + 100), { status: 200 });
  }) as typeof fetch;
  const text = await fetchRepoReadme("https://github.com/a/b", fake);
  delete process.env.GITHUB_TOKEN;
  assert.equal(text?.length, README_EXCERPT_CHARS);
  assert.equal(seen[0]?.url, "https://api.github.com/repos/a/b/readme");
  assert.equal(seen[0]?.auth, "Bearer tok");
});

test("fetchRepoReadme is best effort: 404, network error and non-repo → null", async () => {
  const notFound = (async () => new Response("", { status: 404 })) as typeof fetch;
  const broken = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await fetchRepoReadme("https://github.com/a/b", notFound), null);
  assert.equal(await fetchRepoReadme("https://github.com/a/b", broken), null);
  assert.equal(await fetchRepoReadme("https://example.com/a/b", notFound), null);
});
