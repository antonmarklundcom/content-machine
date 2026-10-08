import assert from "node:assert/strict";
import { test } from "node:test";
import { YouTubeCommentsClient, YouTubeCommentsError } from "./comments";
import { QuotaExhaustedError } from "./quota";

function thread(id: string, text: string, likes = 0) {
  return {
    id,
    snippet: {
      totalReplyCount: 2,
      topLevelComment: {
        id,
        snippet: { textDisplay: text, likeCount: likes, publishedAt: "2026-09-01T10:00:00Z" },
      },
    },
  };
}

function errorBody(status: number, reason: string) {
  return new Response(JSON.stringify({ error: { code: status, errors: [{ reason }] } }), {
    status,
  });
}

function client(responses: Array<() => Response>, opts: { quotaBudget?: number } = {}) {
  const urls: URL[] = [];
  const c = new YouTubeCommentsClient({
    apiKey: "k",
    quotaBudget: opts.quotaBudget,
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      urls.push(new URL(String(input)));
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return next();
    }) as typeof fetch,
  });
  return { c, urls };
}

test("asks for one relevance-ordered plain-text page and parses the top-level comments", async () => {
  const { c, urls } = client([
    () =>
      Response.json({ items: [thread("a", " How deep? ", 5), thread("b", ""), { id: "junk" }] }),
  ]);
  const comments = await c.topComments("vid123");
  assert.equal(urls[0].pathname, "/youtube/v3/commentThreads");
  assert.equal(urls[0].searchParams.get("videoId"), "vid123");
  assert.equal(urls[0].searchParams.get("order"), "relevance");
  assert.equal(urls[0].searchParams.get("maxResults"), "100");
  assert.equal(urls[0].searchParams.get("textFormat"), "plainText");
  assert.equal(comments.length, 1);
  assert.equal(comments[0].text, "How deep?");
  assert.equal(comments[0].likeCount, 5);
  assert.equal(comments[0].replyCount, 2);
  assert.equal(c.unitsSpent, 1);
});

test("comments disabled is an empty list, not an error", async () => {
  const { c } = client([() => errorBody(403, "commentsDisabled")]);
  assert.deepEqual(await c.topComments("vid"), []);
});

test("quota exceeded throws at once, without retrying", async () => {
  const { c, urls } = client([
    () => errorBody(403, "quotaExceeded"),
    () => Response.json({ items: [] }),
  ]);
  await assert.rejects(c.topComments("vid"), QuotaExhaustedError);
  assert.equal(urls.length, 1);
});

test("the run budget is checked before calling", async () => {
  const { c, urls } = client([() => Response.json({ items: [] })], { quotaBudget: 1 });
  await c.topComments("a");
  await assert.rejects(c.topComments("b"), QuotaExhaustedError);
  assert.equal(urls.length, 1);
});

test("transient errors are retried; a bad request is not", async () => {
  const flaky = client([
    () => new Response("oops", { status: 503 }),
    () => Response.json({ items: [thread("a", "Why?")] }),
  ]);
  assert.equal((await flaky.c.topComments("vid")).length, 1);

  const bad = client([
    () => errorBody(400, "invalidParameter"),
    () => Response.json({ items: [] }),
  ]);
  await assert.rejects(bad.c.topComments("vid"), YouTubeCommentsError);
});
