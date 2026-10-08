import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { translator } from "@/lib/i18n";

import { loginCheck, mcpCheck, parseMcpList, runPreflight } from "./preflight";

const FAKE = path.resolve("tests/fixtures/fake-claude-higgsfield.mjs");
const KEYS = [
  "MEDIA_ROOT",
  "CLAUDE_CLI_PATH",
  "FAKE_CLAUDE_MCP",
  "FAKE_CLAUDE_LOGIN",
  "HIGGSFIELD_MCP_SERVER",
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const base = mkdtempSync(path.join(tmpdir(), "hf-pre-"));

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const LIST = `Checking MCP server health...

github: npx -y @modelcontextprotocol/server-github - ✓ Connected
higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ✓ Connected
claude.ai Higgsfield: https://mcp.higgsfield.ai/mcp - ✗ Failed to connect
`;

test("parseMcpList reads name, target and status", () => {
  const lines = parseMcpList(LIST);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[1], {
    name: "higgsfield",
    target: "https://mcp.higgsfield.ai/mcp (HTTP)",
    status: "Connected",
    connected: true,
  });
  assert.equal(lines[2].name, "claude.ai Higgsfield");
  assert.equal(lines[2].connected, false);
});

test("mcpCheck: connected, failed, needs auth, missing, set by hand", () => {
  const ok = mcpCheck({ code: 0, stdout: LIST, stderr: "" }, []);
  assert.equal(ok.check.ok, true);
  assert.deepEqual(ok.servers, ["higgsfield"]);

  const failed = mcpCheck(
    { code: 0, stdout: "higgsfield: https://x.higgsfield.ai - ✗ Failed to connect", stderr: "" },
    [],
  );
  assert.equal(failed.check.ok, false);
  assert.equal(failed.check.fix, "mcp_failed");

  const auth = mcpCheck(
    {
      code: 0,
      stdout: "hf: https://mcp.higgsfield.ai/mcp (HTTP) - ⚠ Needs authentication",
      stderr: "",
    },
    [],
  );
  assert.equal(auth.check.fix, "mcp_auth");

  const none = mcpCheck({ code: 0, stdout: "No MCP servers configured.", stderr: "" }, []);
  assert.equal(none.check.ok, false);
  assert.equal(none.check.fix, "mcp_missing");

  const byHand = mcpCheck({ code: 0, stdout: "", stderr: "" }, ["my_hf"]);
  assert.equal(byHand.check.ok, true);
  assert.deepEqual(byHand.servers, ["my_hf"]);
});

test("loginCheck: logged out, ok, API key warning", () => {
  const out = loginCheck({
    code: 1,
    stdout: JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" }),
    stderr: "",
  });
  assert.equal(out.ok, false);
  assert.equal(out.fix, "claude_logged_out");
  assert.match(out.detail, /run \/login/);

  const ok = loginCheck(
    { code: 0, stdout: JSON.stringify({ is_error: false, result: "OK" }), stderr: "" },
    {},
  );
  assert.deepEqual(ok, { id: "claude_login", ok: true, detail: "Logged in." });

  const key = loginCheck({ code: 0, stdout: "{}", stderr: "" }, { ANTHROPIC_API_KEY: "x" });
  assert.equal(key.ok, true);
  assert.equal(key.fix, "claude_api_key");
});

test("every fix has a plain message in both languages", () => {
  const en = translator("en");
  const sv = translator("sv");
  for (const fix of [
    "media_missing",
    "media_unwritable",
    "claude_missing",
    "claude_logged_out",
    "claude_api_key",
    "mcp_missing",
    "mcp_failed",
    "mcp_auth",
  ] as const) {
    const key = `higgsfield.fix.${fix}` as const;
    assert.notEqual(en(key), key);
    assert.notEqual(sv(key), en(key));
  }
  assert.match(en("higgsfield.fix.mcp_missing"), /claude mcp add/);
  assert.match(en("higgsfield.fix.mcp_missing"), /Connectors/);
});

test("runPreflight against the fake CLI", async () => {
  process.env.MEDIA_ROOT = base;
  process.env.CLAUDE_CLI_PATH = FAKE;
  delete process.env.HIGGSFIELD_MCP_SERVER;
  process.env.FAKE_CLAUDE_MCP = "connector";
  delete process.env.FAKE_CLAUDE_LOGIN;
  const good = await runPreflight();
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  assert.deepEqual(good.mcpServers, ["claude.ai Higgsfield"]);
  assert.match(good.checks[1].detail, /2\.0\.99/);

  process.env.FAKE_CLAUDE_LOGIN = "out";
  process.env.FAKE_CLAUDE_MCP = "none";
  process.env.MEDIA_ROOT = path.join(base, "unplugged");
  const bad = await runPreflight();
  assert.equal(bad.ok, false);
  assert.deepEqual(
    bad.checks.map((c) => [c.id, c.ok, c.fix]),
    [
      ["media_root", false, "media_missing"],
      ["claude_binary", true, undefined],
      ["claude_login", false, "claude_logged_out"],
      ["higgsfield_mcp", false, "mcp_missing"],
    ],
  );

  process.env.CLAUDE_CLI_PATH = path.join(base, "no-such-claude");
  const missing = await runPreflight();
  assert.deepEqual(
    missing.checks.slice(1).map((c) => [c.id, c.fix]),
    [
      ["claude_binary", "claude_missing"],
      ["claude_login", "claude_missing"],
      ["higgsfield_mcp", "claude_missing"],
    ],
  );
});
