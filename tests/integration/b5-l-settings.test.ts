import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanSettings } from "@/lib/voice/store";

test("cleanSettings keeps valid Higgsfield and Chatterbox settings (build 5)", () => {
  const out = cleanSettings({
    speed: 0.9,
    higgsfield: {
      model: "text2speech_v2",
      variant: "elevenlabs",
      voiceType: "element",
      voiceId: " abc ",
    },
    chatterbox: {
      mode: "replicate",
      referencePath: "voice/_references/narrador-1.wav",
      exaggeration: 0.6,
      cfgWeight: 0.4,
      languageId: "es",
    },
  });
  assert.deepEqual(out.higgsfield, {
    model: "text2speech_v2",
    voiceType: "element",
    voiceId: "abc",
    variant: "elevenlabs",
  });
  assert.deepEqual(out.chatterbox, {
    mode: "replicate",
    referencePath: "voice/_references/narrador-1.wav",
    exaggeration: 0.6,
    cfgWeight: 0.4,
    languageId: "es",
  });
  assert.equal(out.speed, 0.9);
});

test("cleanSettings drops unsafe or unknown values", () => {
  const out = cleanSettings({
    // @ts-expect-error an unknown model must not survive
    higgsfield: { model: "made_up", voiceType: "preset", voiceId: "x" },
    chatterbox: { mode: "local", referencePath: "../../etc/passwd", exaggeration: 9 },
  });
  assert.equal(out.higgsfield, undefined);
  // An unsafe path is dropped; an out-of-range number is clamped to its limit.
  assert.deepEqual(out.chatterbox, { mode: "local", exaggeration: 2 });
});
