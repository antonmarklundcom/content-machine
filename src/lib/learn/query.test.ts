import assert from "node:assert/strict";
import { test } from "node:test";

import { MySqlDialect } from "drizzle-orm/mysql-core";

import { learnConditions, learnQueryFrom, learnSearchString, likePattern } from "./query";

const dialect = new MySqlDialect();
const render = (q: Parameters<typeof learnConditions>[0], withCategory = true) =>
  dialect.sqlToQuery(learnConditions(q, withCategory));

test("learnQueryFrom keeps known values and drops the rest", () => {
  assert.deepEqual(
    learnQueryFrom({
      category: "self-hosting",
      implemented: "no",
      committed: "yes",
      q: "  hooks ",
      page: "3",
    }),
    { category: "self-hosting", implemented: "no", committed: "yes", search: "hooks", page: 3 },
  );
  assert.deepEqual(learnQueryFrom({ category: "bogus", implemented: "maybe", page: "-2" }), {
    category: undefined,
    implemented: undefined,
    committed: undefined,
    search: undefined,
    page: 1,
  });
  assert.equal(learnQueryFrom({ category: "none" }).category, "none");
});

test("learnSearchString round-trips the filter and can swap the category", () => {
  const q = learnQueryFrom({ category: "other", implemented: "yes", q: "a b" });
  assert.equal(learnSearchString(q), "?category=other&implemented=yes&q=a+b");
  assert.equal(learnSearchString(q, { category: undefined }), "?implemented=yes&q=a+b");
  assert.equal(learnSearchString(learnQueryFrom({})), "");
});

test("no filters: learn clips only", () => {
  const { sql, params } = render({});
  assert.match(sql, /`clips`\.`purpose` = \?/);
  assert.deepEqual(params, ["learn"]);
});

test("every filter becomes its condition; search spans title, note, summary, url, tags", () => {
  const { sql, params } = render({
    category: "ai-coding-tool",
    implemented: "no",
    committed: "yes",
    search: "50%_off",
  });
  assert.match(sql, /`clips`\.`learn_category` = \?/);
  assert.match(sql, /`clips`\.`implemented_at` is null/);
  assert.match(sql, /`clips`\.`committed_at` is not null/);
  for (const col of ["title", "note", "summary", "url"]) {
    assert.match(sql, new RegExp("lower\\(`clips`\\.`" + col + "`\\) like lower\\(\\?\\)"));
  }
  assert.match(
    sql,
    /lower\(cast\(`clips`\.`tags` as char character set utf8mb4\)\) like lower\(\?\)/,
  );
  assert.equal(params[1], "ai-coding-tool");
  assert.deepEqual(params.slice(2), Array(5).fill("%50\\%\\_off%"));
  assert.doesNotMatch(sql, /ilike|::|\$\d/i);
});

test("category none means not summarised; withCategory=false (the badges) leaves it out", () => {
  assert.match(render({ category: "none" }).sql, /`clips`\.`learn_category` is null/);
  assert.doesNotMatch(render({ category: "other" }, false).sql, /learn_category/);
  assert.equal(likePattern("a\\b"), "%a\\\\b%");
});

test("literal percent, underscore and backslash searches stay parameters in every field", () => {
  const term = String.raw`100%_C:\tools`;
  const expected = String.raw`%100\%\_C:\\tools%`;
  assert.equal(likePattern(term), expected);
  const { sql, params } = render({ search: term });
  assert.deepEqual(params, ["learn", ...Array(5).fill(expected)]);
  assert.equal(sql.match(/\?/g)?.length, params.length);
  assert.ok(!sql.includes(term));
});

test("mixed-case and quote-containing search text is lowered in SQL and never interpolated", () => {
  const search = "MBA’E ' OR 1=1 --";
  const { sql, params } = render({ search });
  assert.deepEqual(params, ["learn", ...Array(5).fill(`%${search}%`)]);
  assert.equal(sql.match(/like lower\(\?\)/g)?.length, 5);
  assert.ok(!sql.includes(search));
});
