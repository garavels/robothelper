"""
RobotHelper — Cyberwave Go2 Backend
====================================
Connects to the Unitree Go2 digital twin via the Cyberwave Python SDK.
Provides movement commands and a ~7 fps camera capture loop using
``twin.get_latest_frame()`` (JPEG bytes over REST).

Usage:
    python main.py                # interactive REPL + live camera window
    python main.py --headless     # camera loop only, no OpenCV window
    python main.py --mock         # use mock frames (no live stream needed)

Env vars (loaded from .env):
    CYBERWAVE_API_KEY          – API token from dashboard
    CYBERWAVE_TWIN_UUID        – Go2 twin UUID (use twin_id for direct lookup)
    CYBERWAVE_ENVIRONMENT_ID   – (optional) lock to a specific environment
"""

import argparse
import os
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from cyberwave import Cyberwave

TARGET_FPS = 7
FRAME_INTERVAL = 1.0 / TARGET_FPS
MIN_JPEG_SIZE = 200  # valid JPEGs are always larger than this


# ── Cyberwave connection ─────────────────────────────────────────────

def connect():
    """Return (Cyberwave client, LocomoteTwin)."""
    api_key = os.getenv("CYBERWAVE_API_KEY", "")
    twin_uuid = os.getenv("CYBERWAVE_TWIN_UUID", "")
    env_id = os.getenv("CYBERWAVE_ENVIRONMENT_ID", "") or None

    if not api_key:
        print("ERROR: CYBERWAVE_API_KEY is not set. Check backend/.env")
        sys.exit(1)

    cw = Cyberwave(api_key=api_key)

    if twin_uuid:
        robot = cw.twin(twin_id=twin_uuid)
        print(f"Fetched existing twin by ID: {robot.uuid}")
    else:
        robot = cw.twin("unitree/go2", environment_id=env_id)
        print(f"Got/created Go2 twin: {robot.uuid}")

    return cw, robot


# ── Camera capture loop ──────────────────────────────────────────────

class CameraLoop:
    """Polls ``get_latest_frame()`` at ~TARGET_FPS, decodes JPEG → numpy."""

    def __init__(self, robot, headless: bool = False, mock: bool = False):
        self._robot = robot
        self._headless = headless
        self._mock = mock
        self._running = False
        self._thread: threading.Thread | None = None
        self._latest_frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._frame_count = 0
        self._empty_count = 0
        self._error_count = 0
        self._fps_actual = 0.0

    @property
    def latest_frame(self) -> np.ndarray | None:
        with self._lock:
            return self._latest_frame

    @property
    def fps(self) -> float:
        return self._fps_actual

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        mode = "mock" if self._mock else "live"
        print(f"Camera loop started  target={TARGET_FPS}fps  mode={mode}  headless={self._headless}")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
        if not self._headless:
            cv2.destroyAllWindows()
        print(f"Camera loop stopped  frames={self._frame_count}  empty={self._empty_count}  errors={self._error_count}")

    def _loop(self):
        fps_window: list[float] = []
        warned_no_stream = False

        while self._running:
            t0 = time.perf_counter()

            try:
                jpeg_bytes = self._robot.get_latest_frame(mock=self._mock)
            except Exception as e:
                self._error_count += 1
                if self._error_count <= 3:
                    print(f"[camera] get_latest_frame error ({self._error_count}): {e}")
                elif self._error_count == 4:
                    print("[camera] Suppressing further errors...")
                time.sleep(0.5)
                continue

            if not jpeg_bytes or len(jpeg_bytes) < MIN_JPEG_SIZE:
                self._empty_count += 1
                if not warned_no_stream:
                    size = len(jpeg_bytes) if jpeg_bytes else 0
                    print(f"[camera] No valid frame available ({size} bytes).")
                    print("[camera] Is the edge core streaming? Run: cyberwave-edge-core")
                    print("[camera] Retrying silently... (use --mock to test with placeholder frames)")
                    warned_no_stream = True
                time.sleep(FRAME_INTERVAL)
                continue

            arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                self._empty_count += 1
                if self._empty_count <= 3:
                    print(f"[camera] JPEG decode failed ({len(jpeg_bytes)} bytes)")
                time.sleep(FRAME_INTERVAL)
                continue

            warned_no_stream = False
            with self._lock:
                self._latest_frame = frame
            self._frame_count += 1

            dt = time.perf_counter() - t0
            fps_window.append(1.0 / max(dt, 1e-6))
            if len(fps_window) > 30:
                fps_window.pop(0)
            self._fps_actual = sum(fps_window) / len(fps_window)

            if self._frame_count == 1:
                h, w = frame.shape[:2]
                print(f"[camera] First frame received: {w}x{h}  ({len(jpeg_bytes)} bytes)")

            if not self._headless:
                display = frame.copy()
                cv2.putText(
                    display,
                    f"FPS: {self._fps_actual:.1f}  |  #{self._frame_count}",
                    (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 255, 0),
                    2,
                )
                cv2.imshow("RobotHelper - Go2 Camera", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    self._running = False
                    break

            elapsed = time.perf_counter() - t0
            sleep_time = FRAME_INTERVAL - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)


# ── Movement helpers (LocomoteTwin API) ──────────────────────────────

def cmd_move_forward(robot, dist: float = 0.5):
    robot.move_forward(dist)
    print(f"  → move_forward({dist})")


def cmd_move_to(robot, x: float, y: float, z: float):
    robot.move([x, y, z])
    print(f"  → move([{x}, {y}, {z}])")


def cmd_rotate(robot, yaw: float):
    robot.rotate(yaw=yaw)
    print(f"  → rotate(yaw={yaw}°)")


def cmd_set_position(robot, x: float, y: float, z: float):
    robot.edit_position(x=x, y=y, z=z)
    print(f"  → edit_position({x}, {y}, {z})")


def cmd_list_joints(robot):
    try:
        names = robot.get_controllable_joint_names()
        print(f"  Controllable joints ({len(names)}):")
        for n in names:
            print(f"    - {n}")
    except Exception as e:
        print(f"  Could not list joints: {e}")


def cmd_get_joints(robot):
    try:
        states = robot.joints.get_all()
        print("  Joint states:")
        for name, state in states.items():
            print(f"    {name}: {state}")
    except Exception as e:
        print(f"  Could not get joint states: {e}")


# ── Interactive REPL ─────────────────────────────────────────────────

COMMANDS = {
    "w":  ("Move forward 0.5",     lambda r: cmd_move_forward(r, 0.5)),
    "s":  ("Move forward -0.5",    lambda r: cmd_move_forward(r, -0.5)),
    "a":  ("Rotate left 15°",      lambda r: cmd_rotate(r, 15)),
    "d":  ("Rotate right -15°",    lambda r: cmd_rotate(r, -15)),
    "W":  ("Move forward 1.0",     lambda r: cmd_move_forward(r, 1.0)),
    "S":  ("Move forward -1.0",    lambda r: cmd_move_forward(r, -1.0)),
    "A":  ("Rotate left 45°",      lambda r: cmd_rotate(r, 45)),
    "D":  ("Rotate right -45°",    lambda r: cmd_rotate(r, -45)),
    "j":  ("List joints",          lambda r: cmd_list_joints(r)),
    "g":  ("Get all joint states", lambda r: cmd_get_joints(r)),
}


def print_help():
    print("\n╔═══════════════════════════════════════╗")
    print("║   RobotHelper Go2 Control Console     ║")
    print("╠═══════════════════════════════════════╣")
    for key, (desc, _) in COMMANDS.items():
        print(f"║  [{key}]  {desc:<31} ║")
    print("║  [m x y z]  Move to absolute pos      ║")
    print("║  [p x y z]  Edit position (set)        ║")
    print("║  [r yaw]    Rotate by yaw degrees      ║")
    print("║  [h]        Show this help              ║")
    print("║  [x]        Quit                        ║")
    print("╚═══════════════════════════════════════╝\n")


def repl(robot, cam: CameraLoop):
    print_help()
    while True:
        try:
            raw = input("go2> ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not raw:
            continue

        parts = raw.split()
        cmd = parts[0]

        if cmd == "x":
            break
        if cmd == "h":
            print_help()
            continue

        if cmd == "m" and len(parts) == 4:
            try:
                cmd_move_to(robot, float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError:
                print("  Usage: m <x> <y> <z>")
            continue

        if cmd == "p" and len(parts) == 4:
            try:
                cmd_set_position(robot, float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError:
                print("  Usage: p <x> <y> <z>")
            continue

        if cmd == "r" and len(parts) == 2:
            try:
                cmd_rotate(robot, float(parts[1]))
            except ValueError:
                print("  Usage: r <yaw_degrees>")
            continue

        if cmd in COMMANDS:
            COMMANDS[cmd][1](robot)
        else:
            print(f"  Unknown command '{cmd}'. Press 'h' for help.")

        if cam.fps > 0:
            print(f"  [camera {cam.fps:.1f} fps | frame #{cam._frame_count}]")


# ── Entry point ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="RobotHelper Go2 Backend")
    parser.add_argument("--headless", action="store_true",
                        help="Suppress OpenCV display window")
    parser.add_argument("--mock", action="store_true",
                        help="Use mock frames (no live stream needed)")
    args = parser.parse_args()

    cw, robot = connect()
    cam = CameraLoop(robot, headless=args.headless, mock=args.mock)
    cam.start()

    try:
        repl(robot, cam)
    finally:
        cam.stop()
        cw.disconnect()
        print("Disconnected.")


if __name__ == "__main__":
    main()
