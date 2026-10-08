import { insertReturning } from "@/db/mutations";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull, ne } from "drizzle-orm";
import sharp from "sharp";

import { db, schema } from "@/db";
import { registerFile } from "@/lib/media/register";
import { narrationFolder } from "@/lib/storage/paths";
import type { StoryDeps } from "@/lib/stories/deps";
import type { RenderRequest } from "@/lib/video/contract";
import type { ImportRecordingRequest, NarrateRequest, NarrateResult } from "@/lib/voice/contract";

/**
 * Phase C's test doubles (build 4 §3.C.10): a temp CUENTOS_ROOT built from the
 * JSON fixture plus generated art, a WAV writer, and fake voice/video engines
 * that write real files and real `narrations` / `video_renders` rows, the way
 * phases A and B will.
 */

export const FIXTURE_ROOT = path.join(process.cwd(), "tests/fixtures/cuentos");
export const SLUG = "tito-salto-chiquito";

/** A temp copy of the fixture repo with art images (S04's is left missing on purpose). */
export async function makeCuentosRoot(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "cuentos-"));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  const art = path.join(root, "books", SLUG, "art");
  const colours: Record<string, string> = {
    "S01-a.png": "#e8a33d",
    "S01-b.png": "#777777",
    "S02.png": "#3d8fe8",
    "S03-old.png": "#555555",
    "S03-new.png": "#3de88f",
  };
  for (const [name, background] of Object.entries(colours)) {
    // Portrait 4:5 art, as the books are.
    const png = await sharp({ create: { width: 80, height: 100, channels: 3, background } })
      .png()
      .toBuffer();
    writeFileSync(path.join(art, name), png);
  }
  return root;
}

/** sha256 of every file under `dir`, keyed by relative path: "nothing was written" is an equality. */
export function treeHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else out[r] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  };
  walk(dir, "");
  return out;
}

/** A mono 16-bit 48 kHz WAV of a quiet tone, `ms` long. */
export function toneWav(ms: number, freq = 440): Buffer {
  const rate = 48_000;
  const samples = Math.round((rate * ms) / 1000);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  }
  return buf;
}

/** Duration the fake gives a line: 60 ms per character, at least 600 ms. */
export function fakeDurationMs(text: string): number {
  return Math.max(600, text.length * 60);
}

export type FakeEngines = {
  deps: Partial<StoryDeps>;
  narrated: NarrateRequest[];
  uploaded: ImportRecordingRequest[];
  rendered: RenderRequest[];
};

let takeCounter = 0;

async function storeTake(
  req: NarrateRequest | ImportRecordingRequest,
  provider: "elevenlabs" | "manual",
): Promise<NarrateResult> {
  const root = process.env.MEDIA_ROOT as string;
  const durationMs = fakeDurationMs(req.text);
  const folder = narrationFolder(req);
  const name = `take-${++takeCounter}-${Date.now()}`;
  mkdirSync(path.join(root, ...folder.split("/")), { recursive: true });
  const rel = `${folder}/${name}.wav`;
  writeFileSync(path.join(root, ...rel.split("/")), toneWav(durationMs, 300 + takeCounter * 20));
  const reg = await registerFile(rel, { source: "upload", tags: ["voice"] });
  if (reg.status !== "created" && reg.status !== "existing")
    throw new Error(`register failed: ${reg.status}`);
  const words = req.text.split(/\s+/).filter(Boolean);
  const step = durationMs / Math.max(1, words.length);
  const alignment = words.map((word, i) => ({
    word,
    startMs: Math.round(i * step),
    endMs: Math.round((i + 1) * step),
  }));
  const [row] = await insertReturning(
    db,
    schema.narrations,
    {
      ownerKind: req.ownerKind,
      ownerRef: req.ownerRef,
      sceneRef: req.sceneRef ?? null,
      language: req.language,
      voiceProfileId: req.voiceProfileId,
      speaker: req.speaker ?? null,
      inputText: req.text,
      spokenText: req.text,
      textHash: createHash("sha256").update(req.text).digest("hex"),
      provider,
      status: "done",
      masterAssetId: reg.asset.id,
      playbackAssetId: reg.asset.id,
      durationMs,
      alignment,
    },
    { id: schema.narrations.id },
  );
  return {
    narrationId: row.id,
    durationMs,
    masterPath: rel,
    playbackPath: rel,
    alignment,
    costUsd: 0,
  };
}

export function fakeEngines(): FakeEngines {
  const narrated: NarrateRequest[] = [];
  const uploaded: ImportRecordingRequest[] = [];
  const rendered: RenderRequest[] = [];
  const deps: Partial<StoryDeps> = {
    narrate: async (req) => {
      narrated.push(req);
      return storeTake(req, "elevenlabs");
    },
    importRecording: async (req) => {
      uploaded.push(req);
      return storeTake(req, "manual");
    },
    selectTake: async (id) => {
      const [t] = await db.select().from(schema.narrations).where(eq(schema.narrations.id, id));
      await db
        .update(schema.narrations)
        .set({ selected: false })
        .where(
          and(
            eq(schema.narrations.ownerKind, t.ownerKind),
            eq(schema.narrations.ownerRef, t.ownerRef),
            t.sceneRef
              ? eq(schema.narrations.sceneRef, t.sceneRef)
              : isNull(schema.narrations.sceneRef),
            eq(schema.narrations.language, t.language),
            t.speaker
              ? eq(schema.narrations.speaker, t.speaker)
              : isNull(schema.narrations.speaker),
            ne(schema.narrations.id, id),
          ),
        );
      await db
        .update(schema.narrations)
        .set({ selected: true })
        .where(eq(schema.narrations.id, id));
    },
    reviewTake: async (id, status, note, reviewer) => {
      await db
        .update(schema.narrations)
        .set({ reviewStatus: status, reviewNote: note ?? null, reviewedBy: reviewer ?? null })
        .where(eq(schema.narrations.id, id));
    },
    renderVideo: async (req) => {
      rendered.push(req);
      const root = process.env.MEDIA_ROOT as string;
      const dir = path.join(root, ...req.outFolder.split("/"));
      mkdirSync(dir, { recursive: true });
      const caption = async (ext: "srt" | "vtt", mime: string, body: string) => {
        const rel = `${req.outFolder}/${req.outName}.${ext}`;
        writeFileSync(path.join(root, ...rel.split("/")), body);
        const [a] = await insertReturning(
          db,
          schema.assets,
          {
            kind: "document",
            mime,
            bytes: Buffer.byteLength(body),
            sha256: createHash("sha256")
              .update(body + rel)
              .digest("hex"),
            localPath: rel,
            source: "import",
          },
          { id: schema.assets.id },
        );
        return a.id;
      };
      const srtAssetId = await caption(
        "srt",
        "application/x-subrip",
        "1\n00:00:00,000 --> 00:00:01,000\nHola\n",
      );
      const vttAssetId = await caption(
        "vtt",
        "text/vtt",
        "WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n",
      );
      const durationMs = req.scenes.reduce(
        (n, s) => n + s.audioDurationMs + (s.padAfterMs ?? 600),
        0,
      );
      const [row] = await insertReturning(
        db,
        schema.videoRenders,
        {
          ownerKind: req.ownerKind,
          ownerRef: req.ownerRef,
          language: req.language,
          format: req.format,
          status: "done",
          plan: req,
          srtAssetId,
          vttAssetId,
          durationMs,
        },
        { id: schema.videoRenders.id },
      );
      return {
        renderId: row.id,
        videoPath: `${req.outFolder}/${req.outName}.mp4`,
        srtPath: `${req.outFolder}/${req.outName}.srt`,
        vttPath: `${req.outFolder}/${req.outName}.vtt`,
        durationMs,
      };
    },
  };
  return { deps, narrated, uploaded, rendered };
}
