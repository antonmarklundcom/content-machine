import assert from "node:assert/strict";
import { test } from "node:test";

import {
  languageName,
  loadPlaybook,
  loadPostStyleGuide,
  playbookFile,
  styleGuideFile,
} from "./guides";

test("style guides: the most specific tag wins, then the base language, then English", () => {
  assert.equal(styleGuideFile("es-PY"), "es-PY.md");
  assert.equal(styleGuideFile("es-AR"), "es.md");
  assert.equal(styleGuideFile("pt-BR"), "pt-BR.md");
  assert.equal(styleGuideFile("pt"), "pt-BR.md");
  assert.equal(styleGuideFile("sv"), "sv.md", "Swedish no longer falls back to English");
  assert.equal(styleGuideFile("fi"), "en.md");
  assert.equal(languageName("pt-BR"), "Brazilian Portuguese");
  assert.equal(languageName("xx"), "xx");
});

test("playbooks by platform; unknown platforms read Instagram's", () => {
  assert.equal(playbookFile("TikTok"), "tiktok.md");
  assert.equal(playbookFile("facebook"), "facebook.md");
  assert.equal(playbookFile("pinterest"), "instagram.md");
});

test("every guide and playbook the engine can name exists and is not empty", async () => {
  for (const tag of ["en", "es", "es-PY", "jopara", "pt-BR", "de", "nl", "sv"]) {
    assert.ok((await loadPostStyleGuide(tag)).trim().length > 200, tag);
  }
  for (const platform of ["instagram", "tiktok", "facebook"]) {
    const text = await loadPlaybook(platform);
    assert.ok(text.trim().length > 200, platform);
    assert.ok(text.split("\n").length <= 150, `${platform} playbook is at most 150 lines`);
  }
});
