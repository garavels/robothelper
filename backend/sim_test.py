"""
Robot simulation tester
========================
Drive the Waveshare UGV Beast **digital twin** in the Cyberwave dashboard
(affect = simulation) so you can watch it move and verify the trigger path.

Open your Cyberwave environment (the viewer where the UGV Beast twin lives)
in the browser BEFORE running, so you can watch the twin move.

Run from the backend/ folder (uses backend/.env):

    python sim_test.py move        # drive a visible square — raw movement test
    python sim_test.py asleep      # deterministic "asleep detected" -> approach plan
    python sim_test.py plan        # REAL trigger: webcam frame -> OpenAI -> execute

Notes:
- Stop server.py first (two SDK sessions on one twin will fight).
- `asleep` needs no camera and no OpenAI key — pure movement-trigger test.
- `plan` is the real activity trigger: hold a "sleeping" pose (e.g. eyes closed /
  head down / lie down, or show a photo of a sleeping person) in front of the
  webcam, then run it.
"""

import argparse
import math
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from agent import drive, planner  # noqa: E402

AFFECT = os.getenv("CYBERWAVE_AFFECT", "simulation")
ASSET_KEY = os.getenv("CYBERWAVE_ASSET", "waveshare/ugv-beast")


def connect():
    from cyberwave import Cyberwave

    api_key = os.getenv("CYBERWAVE_API_KEY", "")
    twin_uuid = os.getenv("CYBERWAVE_TWIN_UUID", "")
    env_id = os.getenv("CYBERWAVE_ENVIRONMENT_ID", "") or None
    if not api_key or not twin_uuid:
        print("ERROR: set CYBERWAVE_API_KEY and CYBERWAVE_TWIN_UUID in backend/.env")
        sys.exit(1)
    cw = Cyberwave(api_key=api_key)
    # Match Cyberwave's reference: set the mode BEFORE resolving the twin, and
    # pass the catalog asset key + twin_id + environment_id (not just twin_id).
    cw.affect(AFFECT)
    if env_id:
        twin = cw.twin(ASSET_KEY, twin_id=twin_uuid, environment_id=env_id)
    else:
        twin = cw.twin(ASSET_KEY, twin_id=twin_uuid)
    print(f"Connected twin {twin.uuid}  asset={ASSET_KEY}  (affect={AFFECT})")
    return cw, twin


def run_plan(label: str, raw_actions: list[dict]):
    cw, twin = connect()
    executor = drive.DriveExecutor(robot=twin, cw=cw, affect=AFFECT)
    actions, errors = drive.validate_and_clamp(raw_actions)
    if errors:
        print(f"[{label}] plan REJECTED by safety validator: {errors}")
        return
    print(f"[{label}] executing {len(actions)} actions: {[a.describe() for a in actions]}")
    print("   -> watch the twin in your Cyberwave dashboard now...")
    for res in executor.execute(actions):
        print(f"   {res['status']:<8} {res['action']}")
        time.sleep(0.4)  # small spacing so the motion is easy to watch
    print(f"[{label}] done.")


def cmd_move():
    """A visible square loop (4 sides + 3 right-angle turns + stop = 8 actions,
    within the planner's 8-action safety cap)."""
    quarter = round(math.pi / 2, 3)  # 90 degrees in radians
    raw = [
        {"type": "move_forward", "distance": 0.5},
        {"type": "turn_left", "angle": quarter},
        {"type": "move_forward", "distance": 0.5},
        {"type": "turn_left", "angle": quarter},
        {"type": "move_forward", "distance": 0.5},
        {"type": "turn_left", "angle": quarter},
        {"type": "move_forward", "distance": 0.5},
        {"type": "stop"},
    ]
    run_plan("move", raw)


def cmd_asleep():
    """Deterministic wake-up trigger: pretend we detected a sleeper and approach."""
    print("Simulated activity: ASLEEP person detected front-left — driving over to wake them.")
    raw = [
        {"type": "move_forward", "distance": 0.5},
        {"type": "turn_left", "angle": 0.4},
        {"type": "move_forward", "distance": 0.3},
        {"type": "stop"},
    ]
    run_plan("asleep", raw)


def cmd_plan():
    """Real trigger: grab one webcam frame, ask OpenAI, execute whatever it returns."""
    import base64
    import cv2

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set in backend/.env")
        sys.exit(1)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: cannot open webcam")
        sys.exit(1)
    print("Warming up camera...")
    frame = None
    for _ in range(10):
        ok, frame = cap.read()
        time.sleep(0.1)
    cap.release()
    if frame is None:
        print("ERROR: no frame captured")
        sys.exit(1)

    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    frame_b64 = base64.b64encode(buf.tobytes()).decode()

    print("Asking OpenAI to analyse the frame...")
    result = planner.plan(frame_b64, feelings={})
    if not result.get("ok"):
        print(f"planner error: {result.get('error')}")
        return
    p = result["plan"]
    print(f"  person       : {p.get('person_present')}")
    print(f"  asleep       : {p.get('asleep')}  (grogginess={p.get('grogginess')})")
    print(f"  assessment   : {p.get('assessment')}")
    print(f"  reaction     : {p.get('reaction_summary')}")
    print(f"  say          : {p.get('say')}")
    print(f"  raw actions  : {p.get('actions')}")

    if not p.get("asleep"):
        print("\nNo sleeping person detected -> rover stays put (this is correct).")
        print("Tip: close your eyes / put your head down, or show a photo of someone asleep, then re-run.")
        return
    run_plan("plan", p.get("actions") or [])


def cmd_teleport():
    """Move the twin by directly editing its SCENE pose (no physics/controller needed).
    This is the most likely thing to be visible in the editor/Playground viewport."""
    cw, twin = connect()
    steps = [
        ("edit_position -> (1.0, 0.0)", lambda: twin.edit_position(x=1.0, y=0.0, z=0.0)),
        ("edit_rotation -> yaw 90",     lambda: twin.edit_rotation(yaw=90)),
        ("edit_position -> (1.0, 1.0)", lambda: twin.edit_position(x=1.0, y=1.0, z=0.0)),
        ("edit_rotation -> yaw 180",    lambda: twin.edit_rotation(yaw=180)),
        ("edit_position -> (0.0, 0.0)", lambda: twin.edit_position(x=0.0, y=0.0, z=0.0)),
        ("edit_rotation -> yaw 0",      lambda: twin.edit_rotation(yaw=0)),
    ]
    print(">>> WATCH THE VIEWPORT — teleporting the twin around the scene:")
    for label, fn in steps:
        try:
            fn()
            print(f"   ok   {label}")
        except Exception as e:  # noqa: BLE001
            print(f"   ERR  {label}: {e}")
        time.sleep(1.5)
    print("teleport done.")


def cmd_nav():
    """Drive the twin to target points via the navigation capability (waypoints),
    which is how the Cyberwave rover tutorial moves a rover in simulation."""
    cw, twin = connect()
    cw.affect(AFFECT)
    targets = [[1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 0.0, 0.0]]
    print(">>> WATCH THE VIEWPORT — navigating to waypoints:")
    for t in targets:
        try:
            res = twin.navigation.goto(t, yaw=0.0)
            print(f"   goto {t} -> {res}")
        except Exception as e:  # noqa: BLE001
            print(f"   goto {t} ERR: {e}")
        time.sleep(3)
    print("nav done.")


def _ensure_mqtt(cw):
    m = cw.mqtt
    if not getattr(m, "connected", False):
        m.connect()
        for _ in range(40):
            if getattr(m, "connected", False):
                break
            time.sleep(0.1)
    print("   mqtt connected:", getattr(m, "connected", None))
    return m


def cmd_joints():
    """Wiggle the pan-tilt camera joints via MQTT joint-state updates.
    Joints are what the browser Playground actually simulates, so this is the
    decisive 'does the SDK move ANYTHING in my Playground' test."""
    cw, twin = connect()
    _ensure_mqtt(cw)
    joints = ["pt_base_link_to_pt_link1", "pt_link1_to_pt_link2"]
    print(">>> WATCH THE PLAYGROUND — wiggling the pan-tilt camera joints:")
    for val in (0.6, -0.6, 0.0):
        for j in joints:
            try:
                cw.mqtt.update_joint_state(twin.uuid, j, position=val)
                print(f"   {j} = {val} rad   ok")
            except Exception as e:  # noqa: BLE001
                print(f"   {j} ERR: {e}")
        time.sleep(1.5)
    print("joints done. Did the camera arm move?")


def cmd_mqttpos():
    """Move the twin's base by pushing live pose over MQTT (dict form)."""
    cw, twin = connect()
    _ensure_mqtt(cw)
    print(">>> WATCH THE PLAYGROUND — pushing live base poses over MQTT:")
    for p in ({"x": 1.0, "y": 0.0, "z": 0.0},
              {"x": 1.0, "y": 1.0, "z": 0.0},
              {"x": 0.0, "y": 0.0, "z": 0.0}):
        try:
            cw.mqtt.update_twin_position(twin.uuid, p)
            print(f"   update_twin_position {p}   ok")
        except Exception as e:  # noqa: BLE001
            print(f"   ERR: {e}")
        time.sleep(1.5)
    print("mqttpos done. Did the base move?")


def main():
    parser = argparse.ArgumentParser(description="UGV Beast simulation tester")
    parser.add_argument(
        "mode",
        choices=["move", "asleep", "plan", "teleport", "nav", "joints", "mqttpos"],
        nargs="?",
        default="move",
    )
    args = parser.parse_args()
    {
        "move": cmd_move,
        "asleep": cmd_asleep,
        "plan": cmd_plan,
        "teleport": cmd_teleport,
        "nav": cmd_nav,
        "joints": cmd_joints,
        "mqttpos": cmd_mqttpos,
    }[args.mode]()


if __name__ == "__main__":
    main()
