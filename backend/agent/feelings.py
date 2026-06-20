"""
InterHuman live-stream client
=============================
Streams short video segments from the rover/webcam to the InterHuman API over a
WebSocket and keeps the latest "how does the person feel" reading in memory.

Protocol (per InterHuman docs):
- Connect to wss://api.interhuman.ai/v1/stream/analyze
- Auth: `Authorization: Bearer <api_key>` header (or the API key as a WS subprotocol)
- Send an optional session-config JSON text frame: {"include": [...]}
- Send each video segment as a BINARY frame (>= 3 s, <= 32 MB; mp4/webm/...)
- Receive JSON text frames: signal.detected | engagement.updated |
  conversation_quality.updated | error

This v1 streams VIDEO ONLY (encoded with OpenCV). Adding microphone audio would
improve voice-based signals (stress, frustration) and is a clear next step.

Frames are pushed in by the camera loop via `push_frame()` so we never open the
webcam twice. Everything degrades gracefully when no API key is configured.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time

import cv2
import numpy as np

WS_URL = os.getenv("INTERHUMAN_WS_URL", "wss://api.interhuman.ai/v1/stream/analyze")
DEFAULT_SEGMENT_SECONDS = float(os.getenv("INTERHUMAN_SEGMENT_SECONDS", "4.0"))


class InterHumanClient:
    """Background WebSocket client; holds the latest engagement + social signals."""

    def __init__(self, api_key: str, segment_seconds: float = DEFAULT_SEGMENT_SECONDS,
                 fps: float = 7.0):
        self.api_key = api_key
        self.segment_seconds = max(3.5, segment_seconds)  # stay safely above the 3 s minimum
        self.fps = max(1.0, fps)
        self.running = True
        # Concise per-event logging so you can watch the stream while testing.
        self.debug = os.getenv("INTERHUMAN_DEBUG", "true").lower() in ("1", "true", "yes")

        self._frames: list[np.ndarray] = []
        self._lock = threading.Lock()

        self.latest: dict = {
            "connected": False,
            "engagement": "unknown",
            "signals": [],
            "quality": None,
            "error": None,
            "updated": 0.0,
        }

    # ── frame intake (called from the camera thread) ──────────────────
    def push_frame(self, frame: np.ndarray) -> None:
        cap = int(self.segment_seconds * self.fps * 2) + 4
        with self._lock:
            self._frames.append(frame)
            if len(self._frames) > cap:
                del self._frames[: len(self._frames) - cap]

    def _snapshot(self) -> list[np.ndarray]:
        with self._lock:
            frames = self._frames
            self._frames = []
        return frames

    # ── segment encoding (blocking; run in a worker thread) ───────────
    def _encode_segment(self, frames: list[np.ndarray]) -> bytes | None:
        """Encode frames into an H.264 MP4 (InterHuman rejects MPEG-4 Part 2 / mp4v
        with ih5004). Prefers ffmpeg/libx264 + faststart; falls back to OpenCV."""
        if len(frames) < 2:
            return None
        h, w = frames[0].shape[:2]
        good = [f for f in frames if f is not None and f.shape[:2] == (h, w)]
        # Need >= 3 s of footage so InterHuman doesn't reject it as truncated.
        if len(good) < max(2, int(self.fps * 3.0)):
            return None

        if shutil.which("ffmpeg"):
            data = self._encode_ffmpeg(good, w, h)
            if data:
                return data
            # fall through to cv2 if ffmpeg failed for some reason

        return self._encode_cv2(good, w, h)

    def _encode_ffmpeg(self, frames: list[np.ndarray], w: int, h: int) -> bytes | None:
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        path = tmp.name
        tmp.close()
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}", "-r", str(self.fps), "-i", "-",
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", path,
        ]
        try:
            raw = b"".join(np.ascontiguousarray(f).tobytes() for f in frames)
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            _, err = proc.communicate(input=raw, timeout=60)
            if proc.returncode != 0:
                msg = (err or b"").decode(errors="ignore")[:200]
                print(f"[interhuman] ffmpeg encode failed ({proc.returncode}): {msg}")
                return None
            with open(path, "rb") as fh:
                data = fh.read()
            return data if len(data) > 1000 else None
        except Exception as e:  # noqa: BLE001
            print(f"[interhuman] ffmpeg error: {e}")
            return None
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    def _encode_cv2(self, frames: list[np.ndarray], w: int, h: int) -> bytes | None:
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        path = tmp.name
        tmp.close()
        try:
            # "avc1" requests H.264 from OpenCV's FFmpeg backend when available.
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"avc1"), self.fps, (w, h))
            if not writer.isOpened():
                writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), self.fps, (w, h))
            for f in frames:
                writer.write(f)
            writer.release()
            with open(path, "rb") as fh:
                data = fh.read()
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        return data if len(data) > 1000 else None

    # ── server message handling ───────────────────────────────────────
    def _handle_message(self, payload: dict) -> None:
        msg_type = payload.get("type")
        data = payload.get("data", {}) or {}
        if msg_type == "engagement.updated":
            self.latest["engagement"] = data.get("state", "unknown")
            if self.debug:
                print(f"[interhuman] <- engagement: {self.latest['engagement']}")
        elif msg_type == "signal.detected":
            signals = data.get("signals", []) or []
            self.latest["signals"] = [
                {
                    "type": s.get("type"),
                    "probability": s.get("probability"),
                    "rationale": s.get("rationale"),
                }
                for s in signals
            ]
            if self.debug and signals:
                rendered = ", ".join(f"{s.get('type')}({s.get('probability')})" for s in signals)
                print(f"[interhuman] <- signals: {rendered}")
        elif msg_type == "conversation_quality.updated":
            self.latest["quality"] = data.get("overall")
        elif msg_type == "error":
            self.latest["error"] = data
            print(f"[interhuman] server error: {data}")
        self.latest["updated"] = time.time()

    # ── connection helper (handles websockets API differences) ────────
    async def _connect(self, websockets):
        headers = {"Authorization": f"Bearer {self.api_key}"}
        connect = websockets.connect
        for kwargs in (
            {"additional_headers": headers, "max_size": None},  # websockets >= 13 asyncio client
            {"extra_headers": headers, "max_size": None},        # legacy client
            {"subprotocols": [self.api_key], "max_size": None},  # API key as subprotocol
        ):
            try:
                return await connect(WS_URL, **kwargs)
            except TypeError:
                continue
        # Last resort: no auth kwargs (will likely fail auth, but surfaces a clear error)
        return await connect(WS_URL, max_size=None)

    # ── send / receive loops ──────────────────────────────────────────
    async def _sender(self, ws) -> None:
        # InterHuman requires >= 3 s per segment. Wait until enough frames have
        # accumulated so the first (camera warm-up) clip isn't rejected as
        # truncated (ih5004).
        min_frames = max(2, int(self.fps * 3.2))
        while self.running:
            await asyncio.sleep(self.segment_seconds)
            with self._lock:
                n = len(self._frames)
            if n < min_frames:
                continue  # let more frames accumulate; never send a short clip
            frames = self._snapshot()
            data = await asyncio.to_thread(self._encode_segment, frames)
            if not data:
                continue
            try:
                await ws.send(data)
                if self.debug:
                    dur = len(frames) / self.fps
                    print(f"[interhuman] -> segment sent ({len(frames)} frames, "
                          f"~{dur:.1f}s, {len(data) // 1024} KB)")
            except Exception as e:  # noqa: BLE001
                print(f"[interhuman] send failed: {e}")
                return

    async def _receiver(self, ws) -> None:
        async for message in ws:
            if not isinstance(message, str):
                continue
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            self._handle_message(payload)

    # ── main loop with reconnect ───────────────────────────────────────
    async def run(self) -> None:
        if not self.api_key:
            print("[interhuman] No INTERHUMAN_API_KEY — feelings sensor disabled.")
            return
        try:
            import websockets  # noqa: F401
        except Exception as e:  # noqa: BLE001
            print(f"[interhuman] websockets library not installed: {e}")
            return

        import websockets

        while self.running:
            try:
                ws = await self._connect(websockets)
            except Exception as e:  # noqa: BLE001
                print(f"[interhuman] connect failed: {e} — retrying in 5s")
                await asyncio.sleep(5)
                continue

            print("[interhuman] connected")
            self.latest["connected"] = True
            self.latest["error"] = None
            try:
                await ws.send(json.dumps({"include": ["conversation_quality_overall"]}))
                sender = asyncio.create_task(self._sender(ws))
                receiver = asyncio.create_task(self._receiver(ws))
                done, pending = await asyncio.wait(
                    {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
            except Exception as e:  # noqa: BLE001
                print(f"[interhuman] session error: {e}")
            finally:
                self.latest["connected"] = False
                try:
                    await ws.close()
                except Exception:  # noqa: BLE001
                    pass

            if self.running:
                await asyncio.sleep(3)

    def stop(self) -> None:
        self.running = False
