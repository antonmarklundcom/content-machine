"""
Chatterbox Multilingual TTS server for content-engine (docs/CHATTERBOX.md).

Runs Resemble AI's Chatterbox Multilingual (MIT) on this PC's CPU and answers
the content-engine voice adapter (src/lib/voice/providers/chatterbox.ts):

  GET  /health  -> {"status": "ok", "model_loaded": true, "device": "cpu", ...}
  POST /tts     JSON {text, language_id="es", exaggeration=0.5, cfg_weight=0.5,
                      reference_wav_base64}
                -> audio/wav (mono, 24 kHz, 16-bit)

The app already splits long texts into chunks of <= 300 characters; this server
splits again (same rule) so it is also safe to call by hand with a long text.
Chunks are joined with 250 ms of silence into one WAV.

Binds to 127.0.0.1 only. Standard library HTTP server (no FastAPI), one
generation at a time (CPU). UNVERIFIED: written and documented in the build
session, not run there.

    python server.py [--port 8004] [--threads N]
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_CHUNK_CHARS = 300
GAP_MS = 250
MAX_BODY_BYTES = 60 * 1024 * 1024
LANGUAGES = [
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
    "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
]

MODEL = None
SAMPLE_RATE = 24_000
GENERATE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# text splitting (mirrors splitForChatterbox in chatterbox.ts)
# ---------------------------------------------------------------------------

SENTENCE_RE = re.compile(r"[^.!?…]*(?:[.!?…]+[\"'”’»)\]]*|$)\s*")


def _split_long(piece: str, limit: int) -> list[str]:
    out: list[str] = []
    rest = piece.strip()
    while len(rest) > limit:
        window = rest[:limit]
        cut = max(window.rfind(", "), window.rfind("; "), window.rfind(": "), window.rfind(" — "))
        if cut > limit * 0.3:
            cut += 1
        else:
            cut = window.rfind(" ")
            if cut < limit * 0.3:
                cut = limit
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        out.append(rest)
    return out


def split_text(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    pieces: list[str] = []
    for sentence in SENTENCE_RE.findall(clean):
        s = sentence.strip()
        if not s:
            continue
        pieces.extend(_split_long(s, limit) if len(s) > limit else [s])
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        joined = f"{current} {piece}" if current else piece
        if len(joined) <= limit:
            current = joined
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# model
# ---------------------------------------------------------------------------


def load_model(threads: int | None) -> None:
    global MODEL, SAMPLE_RATE
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    if threads:
        torch.set_num_threads(threads)
    started = time.time()
    print("Loading Chatterbox Multilingual on CPU (first run downloads ~3 GB)...", flush=True)
    MODEL = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
    SAMPLE_RATE = int(getattr(MODEL, "sr", 24_000))
    print(f"Model ready in {time.time() - started:.0f} s ({torch.get_num_threads()} threads).", flush=True)


def to_pcm16(tensor) -> bytes:
    import numpy as np

    audio = tensor.detach().cpu().numpy().reshape(-1)
    audio = np.clip(audio, -1.0, 1.0)
    return (audio * 32767.0).astype("<i2").tobytes()


def synthesize(text: str, language_id: str, exaggeration: float, cfg_weight: float, reference: bytes) -> bytes:
    chunks = split_text(text)
    if not chunks:
        raise ValueError("There is no text to speak.")
    gap = b"\x00\x00" * int(SAMPLE_RATE * GAP_MS / 1000)
    with tempfile.TemporaryDirectory(prefix="chatterbox-") as tmp:
        ref_path = os.path.join(tmp, "reference.wav")
        with open(ref_path, "wb") as fh:
            fh.write(reference)
        parts: list[bytes] = []
        with GENERATE_LOCK:
            for i, chunk in enumerate(chunks):
                started = time.time()
                wav = MODEL.generate(
                    chunk,
                    language_id=language_id,
                    audio_prompt_path=ref_path,
                    exaggeration=exaggeration,
                    cfg_weight=cfg_weight,
                )
                if parts:
                    parts.append(gap)
                parts.append(to_pcm16(wav))
                print(f"  chunk {i + 1}/{len(chunks)} ({len(chunk)} chars) in {time.time() - started:.0f} s", flush=True)
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(b"".join(parts))
    return out.getvalue()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "chatterbox-server/1"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/health":
            return self._json(404, {"error": "not found"})
        self._json(
            200,
            {
                "status": "ok" if MODEL is not None else "loading",
                "model_loaded": MODEL is not None,
                "model": "chatterbox-multilingual",
                "device": "cpu",
                "sample_rate": SAMPLE_RATE,
                "languages": LANGUAGES,
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/tts":
            return self._json(404, {"error": "not found"})
        if MODEL is None:
            return self._json(503, {"error": "The model is still loading."})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            return self._json(413, {"error": "Send a JSON body under 60 MB."})
        try:
            req = json.loads(self.rfile.read(length))
            text = str(req.get("text") or "")
            language_id = str(req.get("language_id") or "es").lower()
            exaggeration = float(req.get("exaggeration", 0.5))
            cfg_weight = float(req.get("cfg_weight", 0.5))
            reference = base64.b64decode(req.get("reference_wav_base64") or "", validate=True)
        except (ValueError, TypeError) as error:
            return self._json(400, {"error": f"Bad request: {error}"})
        if not text.strip():
            return self._json(400, {"error": "text is empty."})
        if language_id not in LANGUAGES:
            return self._json(422, {"error": f"Chatterbox does not speak '{language_id}'."})
        if not reference:
            return self._json(400, {"error": "reference_wav_base64 is required (the voice sample)."})
        started = time.time()
        print(f"/tts {len(text)} chars, {language_id}", flush=True)
        try:
            wav = synthesize(text, language_id, exaggeration, cfg_weight, reference)
        except Exception as error:  # the app shows this message
            return self._json(500, {"error": f"Generation failed: {error}"})
        print(f"/tts done in {time.time() - started:.0f} s", flush=True)
        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    parser = argparse.ArgumentParser(description="Chatterbox Multilingual TTS server (localhost only).")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CHATTERBOX_PORT", "8004")))
    parser.add_argument("--threads", type=int, default=int(os.environ.get("CHATTERBOX_THREADS", "0")) or None)
    args = parser.parse_args()
    load_model(args.threads)
    # Localhost only: this server has no authentication.
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Chatterbox server on http://127.0.0.1:{args.port} (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
