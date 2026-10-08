// Synthetic interruption fixture: completed files, no provider/network calls.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(prompt);
  const plan = JSON.parse(match[1]);
  const folder = plan.folder ?? "_inbox/higgsfield/recovery";
  mkdirSync(path.join(process.env.MEDIA_ROOT, folder), { recursive: true });
  for (const [i, text] of ["one", "two"].entries()) {
    const rel = `${folder}/${i + 1}.pdf`;
    writeFileSync(path.join(process.env.MEDIA_ROOT, rel), `%PDF-1.7 ${text}`);
    if (process.env.FAKE_RECOVERY_MARKERS === "yes")
      process.stdout.write(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: `HF_FILE ${rel}` }] },
        }) + "\n",
      );
  }
  if (process.env.FAKE_RECOVERY_READY) writeFileSync(process.env.FAKE_RECOVERY_READY, "ready");
  if (process.env.FAKE_RECOVERY_MODE === "hang") {
    setTimeout(() => process.exit(4), 10_000);
    setInterval(() => {}, 1000);
    return;
  }
  process.stderr.write("Synthetic crash after saving files before output markers\n");
  process.exit(3);
});
