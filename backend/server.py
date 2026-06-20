"""
RobotHelper — Backend Server
============================
FastAPI WebSocket server that drives the wake-up pipeline:

    MacBook webcam (now) / rover camera (later)
      -> OpenAI vision planner  (is the person asleep? + plan a gentle approach)
      -> InterHuman live stream  (how do they feel / react to being woken?)
      -> safety-checked action plan -> Cyberwave SDK -> UGV Beast
      -> streamed to the Next.js dashboard over WebSocket
      (the spoken wake-up line is played by the browser/PC via /api/tts)

Detection is OpenAI-only by default; set USE_YOLO=true to re-enable the local
YOLOv8-pose + classifier pre-filter (Phase 2). See PIPELINE.md for the design.

Usage:
    python server.py
    python server.py --mock   # use mock robot frames
"""

import asyncio
import base64
import json
import os
import re
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv
import requests as http_requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
CV_MODEL_DIR = ROOT / "cv_model"
sys.path.insert(0, str(CV_MODEL_DIR))
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from agent import drive, feelings, planner  # noqa: E402
from pdf_report import PDFReportGenerator  # noqa: E402

# ── Configuration (env-overridable) ──────────────────────────────────
TARGET_FPS = float(os.getenv("CAMERA_FPS", "7"))
# "webcam" = MacBook camera (now); "robot" = UGV pan-tilt camera (later).
CAMERA_SOURCE = os.getenv("CAMERA_SOURCE", "webcam").lower()
USE_YOLO = os.getenv("USE_YOLO", "false").lower() in ("1", "true", "yes")
PLAN_INTERVAL = float(os.getenv("AGENT_PLAN_INTERVAL", "4.0"))  # seconds between planner calls
CYBERWAVE_AFFECT = os.getenv("CYBERWAVE_AFFECT", "simulation")  # "simulation" or "live"
CYBERWAVE_ASSET = os.getenv("CYBERWAVE_ASSET", "waveshare/ugv-beast")  # catalog asset key
AGENT_DRY_RUN = os.getenv("AGENT_DRY_RUN", "false").lower() in ("1", "true", "yes")


class State:
    def __init__(self):
        self.pose_model = None
        self.classifier = None
        self.robot = None
        self.cw = None
        self.robot_connected = False
        self.camera_source = "none"
        self.frame_b64: str | None = None
        self.raw_frame_b64: str | None = None      # un-annotated JPEG for the planner
        self.detections: list[dict] = []
        self.lock = threading.Lock()
        self.clients: list[WebSocket] = []
        self.running = True
        self.use_mock = False

        # Wake-up agent
        self.ih_client: "feelings.InterHumanClient | None" = None
        self.drive_exec: "drive.DriveExecutor | None" = None
        self.agent: dict = {
            "enabled": False,
            "phase": "scanning",    # scanning | waking | awake | monitoring | error
            "status": "idle",       # idle | scanning | planning | acting | error
            "person_present": False,
            "asleep": False,
            "grogginess": 0,        # 0 (wide awake) .. 100 (deeply asleep)
            "assessment": "",
            "reaction_summary": "",
            "say": "",
            "feelings_summary": "",
            "actions": [],          # planned (validated/clamped) actions
            "executed": [],         # per-action execution results
            "error": None,
            "updated": 0.0,
        }
        self.feelings: dict = {
            "connected": False,
            "engagement": "unknown",
            "signals": [],
            "quality": None,
            "error": None,
            "updated": 0.0,
            # Enhanced emotional state fields
            "emotional_state": "unknown",
            "facial_expressions": [],
            "social_signals": [],
            "sentiment": "neutral",
            "attention": "unknown",
        }
        # Emotion logging for wake-up reports
        self.emotion_log: list[dict] = []
        self.emotion_logging_start: float | None = None
        # Emotion logging for wake-up reports
        emotion_log: list[dict] = []
        emotion_logging_start: float | None = None


state = State()


def load_models():
    """Load the local YOLO pre-filter only when USE_YOLO is enabled (Phase 2)."""
    if not USE_YOLO:
        print("[server] Detection mode: OpenAI vision only (USE_YOLO=false).")
        return
    try:
        from ultralytics import YOLO
        import joblib
        from inference import CLASSIFIER_PATH

        print("[server] Loading local YOLO pre-filter...")
        state.pose_model = YOLO("yolov8s-pose.pt")
        state.classifier = joblib.load(CLASSIFIER_PATH)
        print("[server] YOLO pre-filter ready.")
    except Exception as e:  # noqa: BLE001
        print(f"[server] Could not load YOLO models ({e}); continuing OpenAI-only.")
        state.pose_model = None
        state.classifier = None


def connect_robot():
    try:
        from cyberwave import Cyberwave

        api_key = os.getenv("CYBERWAVE_API_KEY", "")
        twin_uuid = os.getenv("CYBERWAVE_TWIN_UUID", "")
        env_id = os.getenv("CYBERWAVE_ENVIRONMENT_ID", "") or None
        if not api_key or not twin_uuid:
            print("[robot] No credentials — robot offline (agent runs in no-robot mode)")
            return
        cw = Cyberwave(api_key=api_key)
        cw.affect(CYBERWAVE_AFFECT)  # set mode BEFORE resolving the twin (matches reference)
        state.cw = cw
        if env_id:
            state.robot = cw.twin(CYBERWAVE_ASSET, twin_id=twin_uuid, environment_id=env_id)
        else:
            state.robot = cw.twin(CYBERWAVE_ASSET, twin_id=twin_uuid)
        state.robot_connected = True
        print(f"[robot] Connected: {state.robot.uuid}  asset={CYBERWAVE_ASSET}  (affect={CYBERWAVE_AFFECT})")
        print(f"[robot] View your simulation at: https://cyberwave.com/playground?environment={os.getenv('CYBERWAVE_ENVIRONMENT_ID', '')}")
    except Exception as e:
        print(f"[robot] Connection failed: {e}")
        state.robot_connected = False


def _encode_jpeg_b64(frame: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return base64.b64encode(buf.tobytes()).decode()


def camera_loop():
    process_frame = None
    if USE_YOLO:
        try:
            from inference import process_frame  # noqa: F811
        except Exception as e:  # noqa: BLE001
            print(f"[camera] YOLO inference unavailable ({e})")

    webcam = None

    while state.running:
        frame = None

        if CAMERA_SOURCE == "robot" and state.robot and state.robot_connected:
            try:
                raw = state.robot.get_latest_frame(mock=state.use_mock)
                if raw and len(raw) > 200:
                    arr = np.frombuffer(raw, dtype=np.uint8)
                    decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if decoded is not None:
                        frame = decoded
                        state.camera_source = "robot"
            except Exception:
                pass

        if frame is None:
            if webcam is None or not webcam.isOpened():
                webcam = cv2.VideoCapture(0)
                if not webcam.isOpened():
                    state.camera_source = "none"
                    time.sleep(1)
                    continue
            ret, frame = webcam.read()
            if not ret or frame is None:
                state.camera_source = "none"
                time.sleep(0.1)
                continue
            state.camera_source = "webcam"

        if frame is not None:
            # Feed the InterHuman segment buffer with the raw frame.
            if state.ih_client is not None:
                try:
                    state.ih_client.push_frame(frame)
                except Exception as e:
                    print(f"[interhuman] Error pushing frame to InterHuman: {e}")
                    # Don't disable InterHuman on transient errors, just log and continue

            raw_b64 = _encode_jpeg_b64(frame)

            if USE_YOLO and process_frame and state.pose_model and state.classifier:
                try:
                    annotated, dets = process_frame(
                        frame, state.pose_model, state.classifier
                    )
                    with state.lock:
                        state.raw_frame_b64 = raw_b64
                        state.frame_b64 = _encode_jpeg_b64(annotated)
                        state.detections = dets
                except Exception as e:  # noqa: BLE001
                    print(f"[cv] {e}")
            else:
                # OpenAI-only mode: stream the raw frame; detections come from the agent.
                with state.lock:
                    state.raw_frame_b64 = raw_b64
                    state.frame_b64 = raw_b64

        time.sleep(1.0 / TARGET_FPS)

    if webcam:
        webcam.release()


def _current_feelings() -> dict:
    if state.ih_client is not None:
        return dict(state.ih_client.latest)
    return dict(state.feelings)


def _synth_detection(person_present: bool, asleep: bool) -> list[dict]:
    """OpenAI-only mode has no bounding boxes; emit a single placeholder detection
    (ASLEEP / AWAKE) so the video-overlay logic keeps working."""
    if not person_present:
        return []
    label = "ASLEEP" if asleep else "AWAKE"
    return [{"bbox": [0, 0, 0, 0], "label": label, "confidence": 0.9}]


def _retry_after_seconds(err: str, default: float = 20.0) -> float:
    """Parse OpenAI's 'try again in 28m48s' / 'try again in 20s' hint to seconds."""
    m = re.search(r"try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*s", err)
    if not m:
        return default
    minutes = float(m.group(1) or 0)
    seconds = float(m.group(2) or 0)
    return minutes * 60.0 + seconds + 2.0


async def planner_loop():
    """Periodically: latest frame + feelings -> OpenAI plan -> safety -> rover."""
    if not os.getenv("OPENAI_API_KEY", ""):
        print("[agent] OPENAI_API_KEY not set — planner disabled.")
        with state.lock:
            state.agent["enabled"] = False
            state.agent["status"] = "disabled"
        return

    print(f"[agent] Wake-up planner active (model={os.getenv('OPENAI_MODEL', planner.DEFAULT_MODEL)}, "
          f"interval={PLAN_INTERVAL}s, affect={CYBERWAVE_AFFECT}, dry_run={AGENT_DRY_RUN}).")
    with state.lock:
        state.agent["enabled"] = True
        state.agent["status"] = "scanning"
        state.agent["phase"] = "scanning"

    wake_issued = False    # have we already driven an approach for the current sleeper?
    absent_cycles = 0      # consecutive cycles with no person (re-arms wake_issued)
    wake_message_index = 0  # for cycling through different wake-up messages
    wake_messages = [
        "Wake up! Time to wake up!",
        "Good morning! Rise and shine!",
        "Hey, time to get up!",
        "Wake up, sleepyhead!",
        "Time to start your day!",
        "Hey, wake up!",
        "Morning! Time to get up!",
    ]

    while state.running:
        await asyncio.sleep(PLAN_INTERVAL)

        with state.lock:
            frame_b64 = state.raw_frame_b64
        if not frame_b64:
            continue

        feelings_now = _current_feelings()
        with state.lock:
            state.feelings = feelings_now
            # Sync error state from InterHuman client if connected
            if state.ih_client and state.ih_client.latest.get("error") is None:
                state.feelings["error"] = None
            state.agent["status"] = "planning"

        result = await asyncio.to_thread(planner.plan, frame_b64, feelings_now)

        if not result.get("ok"):
            err = result.get("error") or "planner error"
            is_rate = ("rate_limit" in err) or ("429" in err)
            with state.lock:
                state.agent["status"] = "error"
                state.agent["phase"] = "rate_limited" if is_rate else "error"
                state.agent["error"] = (
                    "OpenAI rate limit — add billing (or raise AGENT_PLAN_INTERVAL) to speed up"
                    if is_rate else err
                )
                state.agent["feelings_summary"] = result.get("feelings_summary", "")
            print(f"[agent] plan error: {err}")
            if is_rate:
                # Free OpenAI tier is tiny (e.g. 3 req/min AND 50 req/day on
                # gpt-4o). Honor the suggested retry delay ("28m48s" / "20s") so
                # we stop hammering; otherwise back off ~20s.
                await asyncio.sleep(_retry_after_seconds(err))
            continue

        plan_obj = result.get("plan", {}) or {}
        person_present = bool(plan_obj.get("person_present", False))
        asleep = bool(plan_obj.get("asleep", False))
        grogginess = max(0, min(100, int(plan_obj.get("grogginess", 0) or 0)))
        assessment = str(plan_obj.get("assessment", ""))
        reaction_summary = str(plan_obj.get("reaction_summary", ""))
        say = str(plan_obj.get("say", ""))
        print(f"[agent] Planner generated 'say': '{say}' (asleep={asleep}, person_present={person_present})")

        actions, errors = drive.validate_and_clamp(plan_obj.get("actions"))
        executed: list[dict] = []
        status = "scanning"

        if errors:
            phase = "error"
            status = "error"
            print(f"[agent] plan rejected by safety validator: {errors}")
        elif not person_present:
            absent_cycles += 1
            if absent_cycles >= 2:
                wake_issued = False    # re-arm so the next sleeper can be woken
            phase = "scanning"
            say = ""
            print(f"[agent] No person present, cleared 'say'")
        else:
            absent_cycles = 0
            if asleep:
                phase = "waking"
                if not say:
                    say = wake_messages[wake_message_index % len(wake_messages)]
                    wake_message_index += 1
                    print(f"[agent] Set default wake-up message: '{say}'")
                # Approach ONCE per sleeper (per demo choice); the frontend repeats
                # the spoken wake-up line on a cooldown while they stay asleep.
                if not wake_issued and actions and state.drive_exec is not None:
                    status = "acting"
                    with state.lock:
                        state.agent["status"] = status
                        state.agent["phase"] = phase
                        state.agent["actions"] = [a.to_dict() for a in actions]
                    executed = await asyncio.to_thread(state.drive_exec.execute, actions)
                    wake_issued = True
                    status = "scanning"
            elif wake_issued:
                phase = "awake"        # they woke after we nudged -> reaction report
                say = ""
                print(f"[agent] Person woke up, cleared 'say'")
                # Start emotion logging when person wakes up
                if state.emotion_logging_start is None:
                    state.emotion_logging_start = time.time()
                    print(f"[emotion] Started logging emotions at {state.emotion_logging_start}")
            else:
                phase = "monitoring"   # already awake on arrival; nothing to do
                say = ""
                print(f"[agent] Person already awake, cleared 'say'")

        with state.lock:
            # Handle emotion logging start/stop based on phase changes
            old_phase = state.agent["phase"]
            if old_phase != phase:
                if phase == "awake" and state.emotion_logging_start is None:
                    state.emotion_logging_start = time.time()
                    print(f"[emotion] Started logging emotions (phase: {old_phase} -> {phase})")
                elif old_phase == "awake" and phase != "awake":
                    state.emotion_logging_start = None
                    print(f"[emotion] Stopped emotion logging (phase: {old_phase} -> {phase})")
            
            # Log emotions periodically while awake
            if phase == "awake" and state.emotion_logging_start is not None:
                current_feelings = _current_feelings()
                # Log even if InterHuman is unavailable - use basic data
                log_entry = {
                    "timestamp": time.time(),
                    "time_since_wake": time.time() - state.emotion_logging_start,
                    "engagement": current_feelings.get("engagement", "unknown"),
                    "signals": current_feelings.get("signals", []),
                    "quality": current_feelings.get("quality"),
                    "grogginess": grogginess,
                    "reaction_summary": reaction_summary,
                    "interhuman_available": current_feelings.get("updated", 0) > 0,
                }
                # Avoid duplicate logging (only log if feelings changed or 5+ seconds passed)
                if not state.emotion_log or \
                   (time.time() - state.emotion_log[-1]["timestamp"] >= 5.0) or \
                   (current_feelings.get("engagement") != state.emotion_log[-1].get("engagement")):
                    state.emotion_log.append(log_entry)
                    print(f"[emotion] Logged emotion entry: {log_entry['engagement']}, signals: {len(log_entry['signals'])}, interhuman: {log_entry['interhuman_available']}")

            state.agent.update({
                "phase": phase,
                "status": status,
                "person_present": person_present,
                "asleep": asleep,
                "grogginess": grogginess,
                "assessment": assessment,
                "reaction_summary": reaction_summary,
                "say": say,
                "feelings_summary": result.get("feelings_summary", ""),
                "actions": [a.to_dict() for a in (actions or [])],
                "executed": executed,
                "error": "; ".join(errors) if errors else None,
                "updated": time.time(),
            })
            # Drive the video overlay (only meaningful in OpenAI-only mode).
            if not USE_YOLO:
                state.detections = _synth_detection(person_present, asleep)


async def broadcaster():
    while state.running:
        if state.clients:
            with state.lock:
                fb = state.frame_b64
                dets = list(state.detections)
                agent_snapshot = dict(state.agent)
                feelings_snapshot = _current_feelings()
                
                # Ensure error state is synced from InterHuman client
                if state.ih_client and state.ih_client.latest.get("error") is None:
                    feelings_snapshot["error"] = None

            if fb:
                payload = json.dumps({
                    "type": "frame",
                    "frame": fb,
                    "detections": dets,
                    "camera_source": state.camera_source,
                    "feelings": feelings_snapshot,
                    "agent": agent_snapshot,
                })
                gone: list[WebSocket] = []
                for ws in list(state.clients):
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        gone.append(ws)
                for ws in gone:
                    if ws in state.clients:
                        state.clients.remove(ws)

        await asyncio.sleep(1.0 / 7)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_models()
    connect_robot()

    # Rescue agent wiring
    state.drive_exec = drive.DriveExecutor(
        robot=state.robot, cw=state.cw, affect=CYBERWAVE_AFFECT, dry_run=AGENT_DRY_RUN
    )
    ih_key = os.getenv("INTERHUMAN_API_KEY", "")
    if ih_key:
        try:
            state.ih_client = feelings.InterHumanClient(api_key=ih_key, fps=TARGET_FPS)
            print("[interhuman] InterHuman client initialized")
            # Clear any stale error in state.feelings
            state.feelings["error"] = None
        except Exception as e:
            print(f"[interhuman] Failed to initialize InterHuman client: {e}")
            state.feelings["error"] = f"Initialization failed: {e}"
            state.ih_client = None
    else:
        print("[interhuman] No INTERHUMAN_API_KEY set, feelings sensor disabled")
        state.feelings["error"] = "No API key configured"
        state.ih_client = None

    threading.Thread(target=camera_loop, daemon=True).start()

    tasks = [
        asyncio.create_task(broadcaster()),
        asyncio.create_task(planner_loop()),
    ]
    
    # Only add InterHuman task if client was successfully initialized
    if state.ih_client:
        try:
            tasks.append(asyncio.create_task(state.ih_client.run()))
        except Exception as e:
            print(f"[interhuman] Failed to start InterHuman task: {e}")
            state.ih_client = None
    
    yield
    state.running = False
    if state.ih_client:
        try:
            state.ih_client.stop()
        except Exception as e:
            print(f"[interhuman] Error stopping InterHuman client: {e}")
    for task in tasks:
        task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


SMALLEST_TTS_URL = "https://api.smallest.ai/api/v1/lightning-v3.1/get_speech"

# ── Daily news feed (ScrapeGraph) ─────────────────────────────────────
# Once the person is awake, the dashboard pulls a short news feed via the
# official ScrapeGraphAI v2 Extract API (https://scrapegraphai.com).
#
# Notes learned the hard way:
#  - v2 keys (sgai-...) only work on the v2 host (v2-api.scrapegraphai.com);
#    the legacy v1 host (api.scrapegraphai.com/v1) returns 403 for them.
#  - `stealth` is a paid-plan fetch provider. On the Free Plan it returns
#    HTTP 400 ("no fetch provider matches"), so we retry without it.
#  - X (twitter) needs JS to show fresh posts, but JS-render of x.com is
#    rejected on the Free Plan, and the no-JS fallback returns a STALE cached
#    page. So the default points at a JS-friendly lite news site that returns
#    today's headlines. Set NEWS_URL=https://x.com/<account> if you upgrade.
SCRAPEGRAPH_EXTRACT_URL = os.getenv(
    "SCRAPEGRAPH_API_URL", "https://v2-api.scrapegraphai.com/api/extract"
)
NEWS_URL = os.getenv("NEWS_URL", "https://lite.cnn.com")
NEWS_PROMPT = os.getenv(
    "NEWS_PROMPT",
    "Extract the latest news from this page as up to 8 of the most recent "
    "items. For each item give a 'title' (the headline or post text), a "
    "'source' (the outlet, site, or account handle), and a 'summary' (one "
    "short sentence, or empty).",
)
NEWS_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "source": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["title"],
            },
        }
    },
    "required": ["items"],
}
# Anti-bot mode helps on JS-heavy sites like X but costs +5 credits/call.
# Defaults ON because the default NEWS_URL is X (which gates hard without it).
NEWS_STEALTH = os.getenv("NEWS_STEALTH", "true").lower() in ("1", "true", "yes")

# Shown when no key is set or scraping fails, so the box never looks broken.
DUMMY_NEWS = {
    "items": [
        {"title": "Markets open higher as tech shares lead early gains",
         "source": "Sample Wire", "summary": "Indices rose at the open, led by semiconductors."},
        {"title": "City rolls out new weekend transit routes",
         "source": "Sample Wire", "summary": "Service expands to three more neighborhoods."},
        {"title": "Researchers report progress on battery recycling",
         "source": "Sample Wire", "summary": "A new process recovers most lithium from spent cells."},
        {"title": "Forecast: clear skies through the weekend",
         "source": "Sample Wire", "summary": "Mild temperatures and low humidity expected."},
    ],
    "fetched_via": "fallback",
    "source_url": "",
}


def _extract_news_items(result) -> list[dict]:
    """Pull a clean list of {title, source, summary} out of whatever shape the
    model returned (a bare list, or a dict keyed by items/news/headlines/...)."""
    if isinstance(result, list):
        raw = result
    elif isinstance(result, dict):
        raw = (
            result.get("items") or result.get("news") or result.get("headlines")
            or result.get("articles") or result.get("posts")
            or result.get("tweets") or []
        )
        if not raw and (result.get("title") or result.get("headline")):
            raw = [result]
    else:
        raw = []

    items: list[dict] = []
    for it in raw:
        if isinstance(it, str):
            if it.strip():
                items.append({"title": it.strip(), "source": "", "summary": ""})
        elif isinstance(it, dict):
            title = it.get("title") or it.get("headline") or it.get("text") or ""
            if not title:
                continue
            items.append({
                "title": str(title).strip(),
                "source": str(it.get("source") or it.get("outlet")
                              or it.get("author") or it.get("handle") or "").strip(),
                "summary": str(it.get("summary") or it.get("description") or "").strip(),
            })
    return items


@app.get("/api/news")
async def news_endpoint():
    """Today's news feed via the ScrapeGraph v2 Extract API (scrapes NEWS_URL).

    Tries fetch configs in order and uses the first that returns items:
      stealth+JS (if NEWS_STEALTH) -> JS render -> provider default.
    A failed attempt (e.g. stealth on the Free Plan -> 400) isn't charged, so
    the fallback is cheap and keeps the box working across plans/sites.
    """
    api_key = os.getenv("SCRAPEGRAPH_API_KEY", "")
    if not api_key:
        print("[news] No SCRAPEGRAPH_API_KEY — returning fallback news")
        return DUMMY_NEWS

    headers = {
        "SGAI-APIKEY": api_key.strip(),
        "Content-Type": "application/json",
        "accept": "application/json",
    }
    fetch_configs: list[dict | None] = []
    if NEWS_STEALTH:
        fetch_configs.append({"mode": "js", "stealth": True, "wait": 3000})
    fetch_configs.append({"mode": "js", "wait": 3000})
    fetch_configs.append(None)  # let ScrapeGraph pick the provider

    try:
        import httpx

        last_err = "no successful attempt"
        async with httpx.AsyncClient(timeout=90) as client:
            for fc in fetch_configs:
                payload: dict = {"url": NEWS_URL, "prompt": NEWS_PROMPT, "schema": NEWS_SCHEMA}
                if fc is not None:
                    payload["fetchConfig"] = fc

                resp = await client.post(SCRAPEGRAPH_EXTRACT_URL, headers=headers, json=payload)
                if resp.status_code != 200:
                    last_err = f"HTTP {resp.status_code}: {resp.text[:140]}"
                    print(f"[news] attempt fetchConfig={fc} -> {last_err}")
                    continue

                data = resp.json()
                # v2 Extract returns the structured data under "json".
                result = data.get("json") or data.get("result") or data.get("data") or {}
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except Exception:  # noqa: BLE001
                        result = {"items": [{"title": result}]}

                items = _extract_news_items(result)
                if items:
                    return {"items": items[:8], "fetched_via": "scrapegraph", "source_url": NEWS_URL}
                last_err = "200 but no items"
                print(f"[news] attempt fetchConfig={fc} -> {last_err}")

        print(f"[news] all attempts failed ({last_err}) — using fallback")
        return DUMMY_NEWS

    except Exception as e:  # noqa: BLE001
        print(f"[news] ScrapeGraph error: {e} — returning fallback")
        return DUMMY_NEWS


class TTSRequest(BaseModel):
    text: str = "Good morning! Time to wake up!"
    voice: str = "alloy"  # OpenAI voice: alloy, echo, fable, onyx, nova, shimmer
    model: str = "tts-1"  # tts-1 or tts-1-hd for higher quality


@app.post("/api/tts")
async def tts_endpoint(req: TTSRequest):
    # Try OpenAI TTS first (high quality, uses existing API key)
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        try:
            print(f"[tts] Using OpenAI TTS: voice={req.voice}, model={req.model}")
            resp = http_requests.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": req.model,
                    "input": req.text,
                    "voice": req.voice,
                    "response_format": "mp3",
                },
                timeout=15,
            )
            if resp.status_code == 200:
                print(f"[tts] OpenAI TTS success: {len(resp.content)} bytes")
                return Response(content=resp.content, media_type="audio/mpeg")
            else:
                print(f"[tts] OpenAI TTS failed {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[tts] OpenAI TTS error: {e}")

    # Fallback to smallest.ai if configured
    smallest_key = os.getenv("SMALLEST_API_KEY", "")
    if smallest_key:
        try:
            print(f"[tts] Using smallest.ai fallback")
            resp = http_requests.post(
                SMALLEST_TTS_URL,
                headers={
                    "Authorization": f"Bearer {smallest_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "text": req.text,
                    "voice_id": "luna",  # smallest.ai v3.1 voice
                    "sample_rate": 24000,
                    "speed": 1.0,
                },
                timeout=10,
            )
            if resp.status_code == 200:
                print(f"[tts] smallest.ai success: {len(resp.content)} bytes")
                return Response(content=resp.content, media_type="audio/mpeg")
            else:
                print(f"[tts] smallest.ai failed {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[tts] smallest.ai error: {e}")

    # Both APIs failed
    print("[tts] All TTS APIs failed, returning error")
    return Response(content=b"", media_type="audio/wav", status_code=503)


@app.get("/api/emotion-report")
async def emotion_report():
    """Download the emotion log as a formatted PDF report."""
    with state.lock:
        emotion_data = list(state.emotion_log)
        logging_active = state.emotion_logging_start is not None
    
    if not emotion_data and not logging_active:
        return JSONResponse(
            content={"error": "No emotion data available. Complete a wake-up cycle first."},
            status_code=404,
        )

    try:
        generator = PDFReportGenerator()
        pdf_bytes = generator.generate_report(
            emotion_log=emotion_data,
            agent_data=dict(state.agent),
            feelings_data=dict(state.feelings),
        )

        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"wake_up_report_{timestamp}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        print(f"[report] Error generating PDF: {e}")
        return JSONResponse(
            content={"error": f"Failed to generate report: {str(e)}"},
            status_code=500,
        )


@app.post("/api/emotion-report/clear")
async def clear_emotion_report():
    """Clear the emotion log to start fresh."""
    with state.lock:
        state.emotion_log = []
        state.emotion_logging_start = None
    return {"status": "cleared", "message": "Emotion log cleared"}


@app.post("/api/feelings/clear-error")
async def clear_feelings_error():
    """Clear the InterHuman error state."""
    with state.lock:
        state.feelings["error"] = None
        if state.ih_client:
            state.ih_client.latest["error"] = None
    return {"status": "cleared", "message": "Feelings error cleared"}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    state.clients.append(ws)

    await ws.send_text(json.dumps({
        "type": "status",
        "robot_connected": state.robot_connected,
        "camera_source": state.camera_source,
    }))

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            if msg.get("type") == "command" and state.drive_exec is not None:
                cmd = msg.get("command")
                # Manual WASD -> UGV Beast verbs, routed through the safety-clamped
                # executor (so manual control respects the same limits + affect mode).
                verb_map = {
                    "forward": {"type": "move_forward", "distance": 0.5},
                    "backward": {"type": "move_backward", "distance": 0.5},
                    "left": {"type": "turn_left", "angle": 0.26},   # ~15 degrees
                    "right": {"type": "turn_right", "angle": 0.26},
                }
                try:
                    if cmd in verb_map:
                        acts, _ = drive.validate_and_clamp([verb_map[cmd]])
                        await asyncio.to_thread(state.drive_exec.execute, acts)
                    elif cmd == "approach":
                        dist = float(msg.get("distance", 1.0))
                        acts, _ = drive.validate_and_clamp(
                            [{"type": "move_forward", "distance": dist}]
                        )
                        await asyncio.to_thread(state.drive_exec.execute, acts)
                        print(f"[cmd] approach: move_forward {dist} m (clamped)")
                except Exception as e:
                    print(f"[cmd] {e}")
    except WebSocketDisconnect:
        if ws in state.clients:
            state.clients.remove(ws)


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="RobotHelper Backend Server")
    parser.add_argument("--mock", action="store_true",
                        help="Use mock robot frames")
    args = parser.parse_args()
    state.use_mock = args.mock

    uvicorn.run(app, host="0.0.0.0", port=8000)
