import { open, type FileHandle } from "node:fs/promises";

import { mediaRoot, resolveMediaFile, splitRelative } from "@/lib/storage/root";

/**
 * The bytes YouTube and TikTok receive (build 4 §3.F) come straight from the
 * asset's file under `MEDIA_ROOT`, read one chunk at a time so a 2 GB video
 * never sits in memory. No public copy is needed: these APIs take uploads.
 */

export type MediaFile = {
  name: string;
  size: number;
  /** `length` bytes from `start` (fewer only at the end of the file). */
  read(start: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  close(): Promise<void>;
};

export class MediaFileError extends Error {}

export async function openMediaFile(
  localPath: string | null | undefined,
  name: string,
  root: string = mediaRoot(),
): Promise<MediaFile> {
  const segments = localPath ? splitRelative(localPath) : null;
  if (!segments) throw new MediaFileError(`${name} has no file on the media drive.`);
  const file = await resolveMediaFile(segments, root);
  if (!file) {
    throw new MediaFileError(
      `${name} was not found under MEDIA_ROOT (${localPath}). Is the media drive connected?`,
    );
  }
  let handle: FileHandle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    throw new MediaFileError(`${name} could not be opened: ${(err as Error).message}`);
  }
  const { size } = await handle.stat();
  if (size === 0) {
    await handle.close();
    throw new MediaFileError(`${name} is empty.`);
  }
  return {
    name,
    size,
    async read(start, length) {
      const n = Math.max(0, Math.min(length, size - start));
      const buf = new Uint8Array(new ArrayBuffer(n));
      let off = 0;
      while (off < n) {
        const { bytesRead } = await handle.read(buf, off, n - off, start + off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      return off === n ? buf : buf.slice(0, off);
    },
    close: () => handle.close(),
  };
}
