/**
 * A stand-in for the Claude Code CLI in the Higgsfield bridge tests (build 4
 * §3.H): no login, no Higgsfield, same argv/stdin/stream-json contract.
 *
 *   claude --version                         prints a version
 *   claude mcp list                          FAKE_CLAUDE_MCP: connected (default) | failed | auth | none | connector
 *   claude -p … --output-format json         the preflight ping; FAKE_CLAUDE_LOGIN=out → not logged in
 *   claude -p … --output-format stream-json  a run; the prompt is read from stdin
 *
 *   FAKE_CLAUDE_MODE  done (default) | fail | crash | hang
 *   FAKE_CLAUDE_FILE  file written under MEDIA_ROOT in "done" (default _inbox/higgsfield/2026-10-07/fake-abc12345.png)
 *   FAKE_CLAUDE_LOG   append {args, stdin} (JSON, one line) here
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (args.includes("--version")) {
  console.log("2.0.99 (Claude Code)");
  process.exit(0);
}

if (args[0] === "mcp" && args[1] === "list") {
  const mode = process.env.FAKE_CLAUDE_MCP ?? "connected";
  console.log("Checking MCP server health...\n");
  console.log("github: npx -y @modelcontextprotocol/server-github - ✓ Connected");
  if (mode === "connected")
    console.log("higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ✓ Connected");
  if (mode === "connector")
    console.log("claude.ai Higgsfield: https://mcp.higgsfield.ai/mcp - ✓ Connected");
  if (mode === "failed")
    console.log("higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ✗ Failed to connect");
  if (mode === "auth")
    console.log("higgsfield: https://mcp.higgsfield.ai/mcp (HTTP) - ⚠ Needs authentication");
  process.exit(0);
}

const format = args[args.indexOf("--output-format") + 1];

if (format === "json") {
  if (process.env.FAKE_CLAUDE_LOGIN === "out") {
    console.log(
      JSON.stringify({
        type: "result",
        is_error: true,
        result: "Invalid API key · Please run /login",
      }),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "OK" }),
  );
  process.exit(0);
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", run);

// A 1×1 PNG, so the media scan registers the file as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function run() {
  if (process.env.FAKE_CLAUDE_LOG)
    appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdin }) + "\n");
  const mode = process.env.FAKE_CLAUDE_MODE ?? "done";
  emit({
    type: "system",
    subtype: "init",
    mcp_servers: [{ name: "higgsfield", status: "connected" }],
    tools: ["mcp__higgsfield__balance"],
  });

  if (mode === "hang") {
    emit({ type: "assistant", message: { content: [{ type: "text", text: "Waiting on jobs…" }] } });
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "crash") {
    process.stderr.write("Error: something broke inside the CLI\n");
    process.exit(3);
  }
  if (mode === "fail") {
    emit({
      type: "assistant",
      message: { content: [{ type: "text", text: "HF_BALANCE before 100" }] },
    });
    emit({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Higgsfield refused the batch: insufficient credits",
    });
    process.exit(1);
  }

  const rel = process.env.FAKE_CLAUDE_FILE ?? "_inbox/higgsfield/2026-10-07/fake-abc12345.png";
  const root = process.env.MEDIA_ROOT;
  emit({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Checking the balance.\nHF_BALANCE before 100" },
        { type: "tool_use", id: "t1", name: "mcp__higgsfield__generate_image_batch", input: {} },
      ],
    },
  });
  emit({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "job abc12345" }] },
  });
  if (root) {
    const abs = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, PNG);
  }
  emit({
    type: "assistant",
    message: { content: [{ type: "text", text: `HF_JOB abc12345\nSaved.\nHF_FILE ${rel}` }] },
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done: 1 file.\nHF_BALANCE after 94\nHF_CREDITS 6",
    permission_denials: [],
  });
  process.exit(0);
}
