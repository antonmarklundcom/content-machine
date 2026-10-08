import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { NarrationRefusedError, type VoiceSettings } from "../contract";
import { parseWav, toneWav } from "../wav";
import {
  chatterboxAdapter,
  chatterboxConfigured,
  chatterboxHealth,
  chatterboxLanguageId,
  joinWavs,
  replicatePredictionRequest,
  splitForChatterbox,
  CHATTERBOX_REPLICATE_DEFAULT_MODEL,
  REPLICATE_INLINE_MAX_BYTES,
} from "./chatterbox";
import type { FetchLike, SynthesisProfile } from "./types";

type Call = { url: string; init?: RequestInit };

function recorder(respond: (call: Call, n: number) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call, calls.length - 1);
    },
  };
}

const root = mkdtempSync(path.join(tmpdir(), "chatterbox-unit-"));
mkdirSync(path.join(root, "voice", "_references"), { recursive: true });
const smallRef = toneWav({ durationMs: 1000, sampleRate: 24_000 }); // 48 KB
const bigRef = toneWav({ durationMs: 10_000, sampleRate: 24_000 }); // 480 KB
writeFileSync(path.join(root, "voice/_references/ana-1.wav"), smallRef);
writeFileSync(path.join(root, "voice/_references/ana-big.wav"), bigRef);
after(() => rmSync(root, { recursive: true, force: true }));

const profile = (chatterbox: VoiceSettings["chatterbox"]): SynthesisProfile & { name: string } => ({
  name: "Ana",
  provider: "chatterbox",
  providerVoiceId: "ana",
  settings: { chatterbox },
});

const wavResponse = (ms = 500) =>
  new Response(new Uint8Array(toneWav({ durationMs: ms, sampleRate: 24_000 })), {
    headers: { "content-type": "audio/wav" },
  });

async function refusal(p: Promise<unknown>): Promise<NarrationRefusedError> {
  try {
    await p;
  } catch (error) {
    assert.ok(error instanceof NarrationRefusedError, String(error));
    return error;
  }
  assert.fail("expected a refusal");
}

test("splitForChatterbox: sentence ends, packing, long sentences, nothing dropped", () => {
  assert.deepEqual(splitForChatterbox("  "), []);
  assert.deepEqual(splitForChatterbox("Hola che. ¿Cómo andás?"), ["Hola che. ¿Cómo andás?"]);
  const s = "Había una vez un sapo. ".repeat(30);
  const chunks = splitForChatterbox(s, 100);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok([...c].length <= 100, c);
    assert.match(c, /\.$/);
  }
  assert.equal(chunks.join(" "), s.trim());
  const long = `${"palabra ".repeat(60).trim()}, y ${"otra ".repeat(40).trim()}.`;
  const parts = splitForChatterbox(long, 120);
  for (const c of parts) assert.ok([...c].length <= 120, c);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
  assert.deepEqual(splitForChatterbox("«¡Corré!» dijo. ... Y se fue", 12), [
    "«¡Corré!»",
    "dijo. ...",
    "Y se fue",
  ]);
});

test("joinWavs: one WAV, chunk audio plus silence gaps; refuses mismatched rates", () => {
  const a = toneWav({ durationMs: 1000, sampleRate: 24_000 });
  const b = toneWav({ durationMs: 500, sampleRate: 24_000 });
  const joined = parseWav(joinWavs([a, b], 250));
  assert.ok(joined);
  assert.equal(joined.sampleRate, 24_000);
  assert.equal(joined.durationMs, 1750);
  assert.throws(() => joinWavs([a, toneWav({ durationMs: 100, sampleRate: 44_100 })]), /Hz/);
  assert.throws(() => joinWavs([a, Buffer.from("nope")]), /not a WAV/);
});

test("language ids: es-PY/jopara → es, gn → null, override wins", () => {
  assert.equal(chatterboxLanguageId("es-PY"), "es");
  assert.equal(chatterboxLanguageId("jopara"), "es");
  assert.equal(chatterboxLanguageId("pt-BR"), "pt");
  assert.equal(chatterboxLanguageId("sv"), "sv");
  assert.equal(chatterboxLanguageId("gn"), null);
  assert.equal(chatterboxLanguageId("gn", "es"), null);
  assert.equal(chatterboxLanguageId("es-PY", "en"), "en");
});

test("configured: local default on the PC, token or URL online, bad URL refused", () => {
  assert.deepEqual(chatterboxConfigured({}), { ok: true });
  assert.equal(chatterboxConfigured({ APP_MODE: "online" }).ok, false);
  assert.deepEqual(chatterboxConfigured({ APP_MODE: "online", REPLICATE_API_TOKEN: "r8" }), {
    ok: true,
  });
  const bad = chatterboxConfigured({ CHATTERBOX_URL: "localhost:8004" });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.message : "", /Chatterbox server URL/);
});

test("local: POST /tts per chunk with the reference, chunks joined into one WAV", async () => {
  const { fetch, calls } = recorder(() => wavResponse(500));
  const adapter = chatterboxAdapter(
    { CHATTERBOX_URL: "http://127.0.0.1:9000/" },
    { fetch, mediaRoot: root },
  );
  const text = `${"Una oración bastante larga para el sapo Tito que salta. ".repeat(8)}`;
  const result = await adapter.synthesize(
    text,
    profile({
      mode: "local",
      referencePath: "voice/_references/ana-1.wav",
      exaggeration: 0.7,
      cfgWeight: 0.3,
    }),
    { language: "es-PY" },
  );
  const expected = splitForChatterbox(text);
  assert.equal(calls.length, expected.length);
  assert.ok(calls.length >= 2);
  assert.equal(calls[0].url, "http://127.0.0.1:9000/tts");
  assert.equal(calls[0].init?.method, "POST");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body, {
    text: expected[0],
    language_id: "es",
    exaggeration: 0.7,
    cfg_weight: 0.3,
    reference_wav_base64: smallRef.toString("base64"),
  });
  const info = parseWav(result.wav);
  assert.ok(info);
  assert.equal(info.durationMs, 500 * calls.length + 250 * (calls.length - 1));
  assert.equal(result.alignment, null);
  assert.equal(result.costUsd, 0);
  assert.equal(result.sampleRate, 24_000);
  assert.equal(await adapter.listVoices().then((v) => v.length), 0);
});

test("local: default URL, defaults for knobs; server down gives a clear message", async () => {
  const { fetch, calls } = recorder(() => wavResponse());
  await chatterboxAdapter({}, { fetch, mediaRoot: root }).synthesize(
    "Hola.",
    profile({ mode: "local", referencePath: "voice/_references/ana-1.wav" }),
    { language: "es" },
  );
  assert.equal(calls[0].url, "http://127.0.0.1:8004/tts");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.exaggeration, 0.5);
  assert.equal(body.cfg_weight, 0.5);

  const down: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    chatterboxAdapter({}, { fetch: down, mediaRoot: root }).synthesize(
      "Hola.",
      profile({ mode: "local", referencePath: "voice/_references/ana-1.wav" }),
      { language: "es" },
    ),
    /No Chatterbox server at http:\/\/127\.0\.0\.1:8004.*Chatterbox server URL/,
  );
  const health = await chatterboxHealth({}, down);
  assert.equal(health.ok, false);
  const up = await chatterboxHealth({}, async () => Response.json({ status: "ok" }));
  assert.equal(up.ok, true);
});

test("refusals: no reference, missing file, Guaraní, Replicate without a token", async () => {
  const { fetch, calls } = recorder(() => wavResponse());
  const adapter = chatterboxAdapter({}, { fetch, mediaRoot: root });
  const noRef = await refusal(
    adapter.synthesize("Hola.", profile({ mode: "local" }), { language: "es" }),
  );
  assert.equal(noRef.reason, "provider_not_configured");
  assert.match(noRef.message, /reference sample/);
  const missing = await refusal(
    adapter.synthesize(
      "Hola.",
      profile({ mode: "local", referencePath: "voice/_references/gone.wav" }),
      { language: "es" },
    ),
  );
  assert.equal(missing.reason, "provider_not_configured");
  const climb = await refusal(
    adapter.synthesize("Hola.", profile({ mode: "local", referencePath: "../etc/passwd" }), {
      language: "es",
    }),
  );
  assert.equal(climb.reason, "provider_not_configured");
  const gn = await refusal(
    adapter.synthesize(
      "Mba'éichapa.",
      profile({ mode: "local", referencePath: "voice/_references/ana-1.wav" }),
      { language: "gn" },
    ),
  );
  assert.equal(gn.reason, "language_not_supported");
  const rep = await refusal(
    adapter.synthesize(
      "Hola.",
      profile({ mode: "replicate", referencePath: "voice/_references/ana-1.wav" }),
      { language: "es" },
    ),
  );
  assert.equal(rep.reason, "provider_not_configured");
  assert.match(rep.message, /Replicate API token/);
  assert.equal(calls.length, 0);
});

test("replicate: create prediction, poll to succeeded, download, cost from predict time", async () => {
  const wav = toneWav({ durationMs: 800, sampleRate: 24_000 });
  const slept: number[] = [];
  const { fetch, calls } = recorder((call, n) => {
    if (call.url.endsWith("/predictions") && call.init?.method === "POST") {
      return Response.json(
        {
          id: "p1",
          status: "starting",
          urls: { get: "https://api.replicate.com/v1/predictions/p1" },
        },
        { status: 201 },
      );
    }
    if (call.url === "https://api.replicate.com/v1/predictions/p1") {
      return Response.json(
        n < 3
          ? { id: "p1", status: "processing" }
          : {
              id: "p1",
              status: "succeeded",
              output: "https://replicate.delivery/x/out.wav",
              metrics: { predict_time: 4 },
            },
      );
    }
    if (call.url === "https://replicate.delivery/x/out.wav")
      return new Response(new Uint8Array(wav));
    return new Response("unexpected", { status: 500 });
  });
  const adapter = chatterboxAdapter(
    { REPLICATE_API_TOKEN: "r8_test", CHATTERBOX_REPLICATE_USD_PER_SEC: "0.001" },
    { fetch, mediaRoot: root, sleep: async (ms) => void slept.push(ms) },
  );
  const result = await adapter.synthesize(
    "Hola che.",
    profile({ mode: "replicate", referencePath: "voice/_references/ana-1.wav", exaggeration: 0.9 }),
    { language: "es-PY" },
  );
  assert.equal(
    calls[0].url,
    `https://api.replicate.com/v1/models/${CHATTERBOX_REPLICATE_DEFAULT_MODEL}/predictions`,
  );
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer r8_test");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.input.text, "Hola che.");
  assert.equal(body.input.language, "es");
  assert.equal(body.input.exaggeration, 0.9);
  assert.equal(body.input.cfg_weight, 0.5);
  assert.equal(body.input.reference_audio, `data:audio/wav;base64,${smallRef.toString("base64")}`);
  assert.equal(slept.length, 3);
  // The delivery download never carries the token.
  const download = calls.find((c) => c.url.includes("replicate.delivery"));
  assert.equal(
    (download?.init?.headers as Record<string, string> | undefined)?.authorization,
    undefined,
  );
  assert.equal(parseWav(result.wav)?.durationMs, 800);
  assert.ok(Math.abs(result.costUsd - 0.004) < 1e-9);
  assert.equal(result.model, CHATTERBOX_REPLICATE_DEFAULT_MODEL);
});

test("replicate: big reference uploaded to the file API; non-WAV output converted", async () => {
  assert.ok(bigRef.length > REPLICATE_INLINE_MAX_BYTES);
  const converted = toneWav({ durationMs: 300, sampleRate: 24_000 });
  const { fetch, calls } = recorder((call) => {
    if (call.url === "https://api.replicate.com/v1/files") {
      return Response.json({ urls: { get: "https://api.replicate.com/v1/files/f1" } });
    }
    if (call.url.endsWith("/predictions")) {
      return Response.json({
        id: "p2",
        status: "succeeded",
        output: ["https://replicate.delivery/o.mp3"],
      });
    }
    return new Response(new Uint8Array(Buffer.from("ID3 not a wav")));
  });
  const result = await chatterboxAdapter(
    { REPLICATE_API_TOKEN: "r8", CHATTERBOX_REPLICATE_MODEL: "someone/cbx:abc123" },
    { fetch, mediaRoot: root, toWav: async () => converted },
  ).synthesize(
    "Hola.",
    profile({ mode: "replicate", referencePath: "voice/_references/ana-big.wav" }),
    { language: "es" },
  );
  assert.equal(calls[0].url, "https://api.replicate.com/v1/files");
  assert.ok(calls[0].init?.body instanceof FormData);
  assert.equal(calls[1].url, "https://api.replicate.com/v1/predictions");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.version, "abc123");
  assert.equal(body.input.reference_audio, "https://api.replicate.com/v1/files/f1");
  assert.equal(parseWav(result.wav)?.durationMs, 300);
  // No predict_time: the cost follows the audio length at the default rate.
  assert.ok(result.costUsd > 0);
});

test("replicate: failed and timed-out predictions throw; the timeout cancels", async () => {
  const failing = recorder((call) =>
    call.url.endsWith("/predictions")
      ? Response.json({ id: "p3", status: "starting" })
      : Response.json({ id: "p3", status: "failed", error: "CUDA out of memory" }),
  );
  await assert.rejects(
    chatterboxAdapter(
      { REPLICATE_API_TOKEN: "r8" },
      { fetch: failing.fetch, mediaRoot: root, sleep: async () => {} },
    ).synthesize(
      "Hola.",
      profile({ mode: "replicate", referencePath: "voice/_references/ana-1.wav" }),
      {
        language: "es",
      },
    ),
    /p3 failed: CUDA out of memory/,
  );

  let clock = 0;
  const slow = recorder((call) =>
    call.url.endsWith("/cancel")
      ? Response.json({})
      : Response.json({ id: "p4", status: "processing" }),
  );
  await assert.rejects(
    chatterboxAdapter(
      { REPLICATE_API_TOKEN: "r8", CHATTERBOX_TIMEOUT_SEC: "10" },
      {
        fetch: slow.fetch,
        mediaRoot: root,
        now: () => clock,
        sleep: async (ms) => void (clock += ms),
      },
    ).synthesize(
      "Hola.",
      profile({ mode: "replicate", referencePath: "voice/_references/ana-1.wav" }),
      {
        language: "es",
      },
    ),
    /did not finish within 10 s/,
  );
  assert.ok(slow.calls.some((c) => c.url === "https://api.replicate.com/v1/predictions/p4/cancel"));
});

test("replicatePredictionRequest: slug vs version", () => {
  assert.equal(
    replicatePredictionRequest("a/b", {}).url,
    "https://api.replicate.com/v1/models/a/b/predictions",
  );
  assert.deepEqual(replicatePredictionRequest("a/b:v1", { x: 1 }), {
    url: "https://api.replicate.com/v1/predictions",
    body: { version: "v1", input: { x: 1 } },
  });
  assert.throws(() => replicatePredictionRequest("nope", {}), /owner\/name/);
});
