import { notFound, ownerOnly, serveMediaFile } from "@/lib/media/serve";
import { isSafeSlug } from "@/lib/stories/book";
import { getScene, getStory } from "@/lib/stories/data";
import { readSceneMeta } from "@/lib/stories/meta";

/**
 * GET /api/stories/audio/<slug>/<scene>/<lang>[?master=1] — a scene's built
 * audio (the joined takes) under MEDIA_ROOT: the MP3 playback copy, or the WAV
 * master with `?master=1`. Owner-only; the path comes from the scene's record,
 * never from the URL, and is served under `serveMediaFile`'s root rules.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; scene: string; lang: string }> },
) {
  const denied = await ownerOnly();
  if (denied) return denied;
  const { slug, scene: sceneRef, lang } = await context.params;
  if (!isSafeSlug(slug) || !/^[a-z-]{2,8}$/i.test(lang)) return notFound();
  const story = await getStory(slug);
  const scene = story ? await getScene(story.id, sceneRef) : null;
  const audio = scene ? readSceneMeta(scene.notes).audio?.[lang] : undefined;
  if (!audio) return notFound();
  const master = new URL(request.url).searchParams.get("master") === "1";
  if (master || !audio.mp3Path) return serveMediaFile(request, audio.wavPath, "audio/wav");
  return serveMediaFile(request, audio.mp3Path, "audio/mpeg");
}
