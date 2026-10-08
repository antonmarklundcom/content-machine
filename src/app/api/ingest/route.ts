import { revalidatePath } from "next/cache";
import { ingestUrl, type IngestProgress } from "@/lib/ingest";
import { BULK_INGEST_LIMIT } from "@/lib/ingest/limits";
import { parseYouTubeUrl } from "@/lib/youtube/url";

/**
 * Streaming bulk ingest (PLAN.md §2 `/api/ingest`, wired up in §9 PR-20).
 *
 * `ingestRef` has always reported per-video progress through `onProgress`, and
 * the form threw it away: a channel of 25 videos paces its caption fetches, so
 * the user watched a frozen "Working…" for minutes with no way to tell a slow
 * run from a hung one. A server action cannot stream — it resolves once — so
 * progress needs a route handler and NDJSON.
 *
 * Bulk ingest costs nothing (metadata and captions are free), so it stays open
 * to an employee under PLAN.md §9 PR-24 — the route is behind the session
 * middleware, which is the check it needs. It never analyses.
 *
 * Single videos deliberately do NOT come here. That path also analyses, which
 * means a spend check, and duplicating that in a second place is how the two
 * drift apart.
 */

export const dynamic = "force-dynamic";

type Line =
  | { type: "progress"; event: WireProgress }
  | { type: "done"; message: string }
  | { type: "error"; error: string };

/** The video row is far more than the UI needs; send the title only. */
type WireProgress =
  | { phase: "resolved"; description: string }
  | { phase: "listed"; count: number }
  | { phase: "stored"; index: number; total: number; title: string }
  | { phase: "captions"; index: number; total: number; title: string; outcome: string };

function toWire(event: IngestProgress): WireProgress {
  switch (event.phase) {
    case "resolved":
      return { phase: "resolved", description: event.description };
    case "listed":
      return { phase: "listed", count: event.count };
    case "stored":
      return { phase: "stored", index: event.index, total: event.total, title: event.video.title };
    case "captions":
      return {
        phase: "captions",
        index: event.index,
        total: event.total,
        title: event.video.title,
        outcome: event.outcome.status,
      };
  }
}

export async function POST(request: Request): Promise<Response> {
  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = String(body.url ?? "").trim();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const ref = parseYouTubeUrl(url);
  if (!ref) return Response.json({ error: "Not a recognisable YouTube URL." }, { status: 400 });
  if (ref.kind === "video") {
    return Response.json(
      { error: "Single videos are ingested and analysed by the form action, not this route." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));

      try {
        const summary = await ingestUrl(url, {
          limit: BULK_INGEST_LIMIT,
          onProgress: (event) => send({ type: "progress", event: toWire(event) }),
        });

        revalidatePath("/youtube");
        revalidatePath("/youtube/sources");

        send({
          type: "done",
          message:
            `Ingested ${summary.videos.length} video(s). Captions: ` +
            `${summary.captionCounts.available} available, ${summary.captionCounts.none} none, ` +
            `${summary.captionCounts.failed} failed.`,
        });
      } catch (err) {
        // The stream has already returned 200 by the time anything can fail, so
        // an error is a line in the body, not a status code.
        send({ type: "error", error: err instanceof Error ? err.message : "Ingest failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Hostinger fronts the Node process with a proxy that will otherwise
      // buffer the whole body and defeat the point of streaming.
      "x-accel-buffering": "no",
    },
  });
}
