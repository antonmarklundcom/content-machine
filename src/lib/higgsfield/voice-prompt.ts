import { downloadCommand, ceilingText, forwardSlashes } from "./prompt";
import { parseVoiceManifest, voiceArgument, type VoiceManifest } from "./voice";

// Server-side worker prompts; browser consumers import the pure helpers in voice.ts.

/** The whole prompt for a voice job: slash command, the manifest (with job ref and ceiling), run rules. */
export function buildVoiceRunPrompt(input: {
  jobId: number;
  argument: string;
  maxCredits: number;
  mediaRoot: string;
}): string {
  const parsed = parseVoiceManifest(input.argument);
  if (!parsed) throw new Error("A voice job needs a line manifest.");
  const manifest: VoiceManifest = {
    ...parsed,
    jobRef: `content-engine job #${input.jobId}`,
    ceilingCredits: input.maxCredits,
  };
  const root = forwardSlashes(input.mediaRoot);
  return `/higgsfield-voice ${voiceArgument(manifest)}

---

## Run rules (content-engine job #${input.jobId}, headless)

- **${ceilingText(input.maxCredits)}** This is a hard ceiling set by Anton: if the next submission would take the total past it, stop, do not submit it, and say so in the report.
- Nobody is watching this run and nobody can answer a question. Wherever the command says "stop and ask", stop instead and explain why in the report.
- MEDIA_ROOT is \`${root}\` (the drive is connected). Every \`outFile\` is relative to it. Write nothing outside MEDIA_ROOT.
- Download each result with exactly: \`${downloadCommand(root)} "<outFile>" "<result url>"\` — no other shell command is allowed.
- Never resubmit a line whose job id you printed: check it with \`jobs_wait\` first.
- Print each of these on a line of its own, with nothing else on the line, as it happens:
  - \`HF_BALANCE before <credits>\` after checking the balance, before any generation
  - \`HF_JOB <lineId> <higgsfield job id>\` right after submitting each line
  - \`HF_FILE <outFile>\` for every file you save
  - \`HF_FAIL <lineId> <short reason>\` for every line that ends without a file
  - \`HF_BALANCE after <credits>\` at the end
  - \`HF_CREDITS <credits spent in this run>\` at the end
- Do not run \`npm run media:scan\`; content-engine turns the files into takes when this run ends.
- If the \`/higgsfield-voice\` command above was not expanded, read \`.claude/commands/higgsfield-voice.md\` and follow it with the manifest above.
`;
}
