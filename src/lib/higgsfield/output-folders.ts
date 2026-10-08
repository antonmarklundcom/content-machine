import path from "node:path";
import type { HiggsfieldJobKind } from "@/db/schema";
import { splitRelative } from "@/lib/storage/root";

/** Recover only folders belonging to the stored request; never scan all MEDIA_ROOT. */
export function outputFolders(job: {
  kind: HiggsfieldJobKind;
  prompt: string;
  targetRef: string | null;
  outputPaths: string[];
}): string[] {
  const folders = new Set<string>();
  function add(value: string, file = false) {
    const rel = value
      .replace(/\\/g, "/")
      .replace(/^media\//, "")
      .replace(/\/+$/, "");
    const folder = file ? path.posix.dirname(rel) : rel;
    const parts = splitRelative(folder);
    if (parts && folder !== ".") folders.add(parts.join("/"));
  }
  function visit(value: unknown, key = "") {
    if (typeof value === "string") {
      if (["folder", "mediaDir"].includes(key)) add(value);
      if (
        ["targetFile", "targetVideoFile", "outFile", "file", "image", "video", "variants"].includes(
          key,
        )
      )
        add(value, true);
    } else if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([k, v]) => visit(v, k));
  }
  for (const match of job.prompt.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* malformed legacy brief */
    }
  }
  for (const file of job.outputPaths) add(file, true);
  if (job.kind === "import") add("_inbox/higgsfield");
  if (!folders.size && /^script:\d+$/.test(job.targetRef ?? ""))
    add(job.targetRef!.slice("script:".length));
  return [...folders]
    .filter(
      (folder, _, all) =>
        !all.some((parent) => parent !== folder && folder.startsWith(`${parent}/`)),
    )
    .sort();
}
