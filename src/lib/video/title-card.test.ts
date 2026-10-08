import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cardColor,
  DEFAULT_CARD_COLOR,
  escapeXml,
  textColorFor,
  titleCardSvg,
  wrapCardText,
} from "./title-card";

test("cardColor accepts #rgb and #rrggbb, else the default", () => {
  assert.equal(cardColor("#ABC"), "#aabbcc");
  assert.equal(cardColor("#0F766E"), "#0f766e");
  assert.equal(cardColor("teal"), DEFAULT_CARD_COLOR);
  assert.equal(cardColor(null), DEFAULT_CARD_COLOR);
});

test("text colour contrasts with the card", () => {
  assert.equal(textColorFor("#ffffff"), "#111111");
  assert.equal(textColorFor("#fde047"), "#111111");
  assert.equal(textColorFor("#1f2937"), "#ffffff");
});

test("wrapCardText wraps and cuts with an ellipsis", () => {
  assert.deepEqual(wrapCardText("uno dos tres cuatro", 8, 5), ["uno dos", "tres", "cuatro"]);
  assert.deepEqual(wrapCardText("a b c d e f", 1, 2), ["a", "b…"]);
});

test("the SVG escapes text and carries the size and colours", () => {
  const svg = titleCardSvg({
    width: 1920,
    height: 1080,
    text: 'Residencia & "costos" <2026>',
    background: "#0f766e",
  });
  assert.ok(svg.includes('width="1920" height="1080"'));
  assert.ok(svg.includes('fill="#0f766e"'));
  assert.ok(
    svg.includes("&amp;") && svg.includes("&quot;costos&quot;") && svg.includes("&lt;2026&gt;"),
  );
  assert.ok(!svg.includes("<2026>"));
  assert.equal(escapeXml("'"), "&apos;");
});
