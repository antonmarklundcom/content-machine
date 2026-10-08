/**
 * The seam between the story studio and the voice/video engines (phases A and
 * B). Every studio operation takes `Partial<StoryDeps>`; the server actions
 * pass nothing and get the real engines, integration tests pass fakes.
 */
import "server-only";
import { importRecording, narrate, reviewTake, selectTake } from "@/lib/voice";
import { renderVideo } from "@/lib/video";

export type StoryDeps = {
  narrate: typeof narrate;
  importRecording: typeof importRecording;
  selectTake: typeof selectTake;
  reviewTake: typeof reviewTake;
  renderVideo: typeof renderVideo;
};

export function storyDeps(overrides: Partial<StoryDeps> = {}): StoryDeps {
  return { narrate, importRecording, selectTake, reviewTake, renderVideo, ...overrides };
}
