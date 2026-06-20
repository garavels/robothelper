"""
Drive executor + safety layer (Waveshare UGV Beast)
===================================================
Turns a planner action list into safe Cyberwave SDK calls.

Safety philosophy (from the Cyberwave UGV tutorial): treat the LLM as untrusted.
1. Schema validation  - reject unknown verbs / malformed actions / oversized plans.
2. Per-action clamping - squeeze every distance/angle/duration into a safe envelope.
3. Try/except containment - any executor error issues a stop and aborts the plan.

SDK calls used (per Cyberwave docs):
  robot.move_forward(distance=...)   # metres
  robot.move_backward(distance=...)  # metres
  robot.turn_left(angle=...)         # radians
  robot.turn_right(angle=...)        # radians
  stop -> move_forward(distance=0.0)
cw.affect("simulation"|"live") selects digital-twin vs physical robot.
"""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass

# Conservative ceilings (overridable via env). Matches the tutorial defaults.
MAX_DISTANCE_M = float(os.getenv("DRIVE_MAX_DISTANCE_M", "1.0"))
MAX_ANGLE_RAD = float(os.getenv("DRIVE_MAX_ANGLE_RAD", str(round(math.pi, 4))))
MAX_DURATION_S = float(os.getenv("DRIVE_MAX_DURATION_S", "5.0"))
MAX_ACTIONS = int(os.getenv("DRIVE_MAX_ACTIONS", "8"))

DISTANCE_VERBS = {"move_forward", "move_backward"}
ANGLE_VERBS = {"turn_left", "turn_right"}
ALLOWED_VERBS = DISTANCE_VERBS | ANGLE_VERBS | {"stop", "wait"}


@dataclass
class Action:
    type: str
    distance: float = 0.0
    angle: float = 0.0
    duration: float = 0.0

    def describe(self) -> str:
        if self.type in DISTANCE_VERBS:
            return f"{self.type}({self.distance:.2f} m)"
        if self.type in ANGLE_VERBS:
            return f"{self.type}({math.degrees(self.angle):.0f} deg)"
        if self.type == "wait":
            return f"wait({self.duration:.1f} s)"
        return self.type

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "distance": round(self.distance, 3),
            "angle": round(self.angle, 3),
            "duration": round(self.duration, 2),
            "label": self.describe(),
        }


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def validate_and_clamp(raw_actions) -> tuple[list[Action] | None, list[str]]:
    """
    Validate + clamp a raw action list from the planner.

    Returns (actions, errors). If errors is non-empty the WHOLE plan is rejected
    (actions is None) and the rover must not move — all-or-nothing, per the tutorial.
    An empty/None input is a valid "do nothing" plan -> ([], []).
    """
    if raw_actions is None:
        return [], []
    if not isinstance(raw_actions, list):
        return None, ["'actions' is not a list"]
    if len(raw_actions) > MAX_ACTIONS:
        return None, [f"too many actions ({len(raw_actions)} > {MAX_ACTIONS})"]

    out: list[Action] = []
    errors: list[str] = []

    for i, a in enumerate(raw_actions):
        if not isinstance(a, dict) or "type" not in a:
            errors.append(f"action[{i}] missing 'type'")
            continue
        verb = a.get("type")
        if verb not in ALLOWED_VERBS:
            errors.append(f"action[{i}] unknown verb '{verb}'")
            continue
        try:
            if verb in DISTANCE_VERBS:
                d = _clamp(abs(float(a.get("distance", 0.0))), 0.0, MAX_DISTANCE_M)
                out.append(Action(verb, distance=d))
            elif verb in ANGLE_VERBS:
                ang = _clamp(abs(float(a.get("angle", 0.0))), 0.0, MAX_ANGLE_RAD)
                out.append(Action(verb, angle=ang))
            elif verb == "wait":
                du = _clamp(abs(float(a.get("duration", 0.0))), 0.0, MAX_DURATION_S)
                out.append(Action(verb, duration=du))
            elif verb == "stop":
                out.append(Action("stop"))
        except (TypeError, ValueError) as e:
            errors.append(f"action[{i}] bad argument: {e}")

    if errors:
        return None, errors
    return out, []


class DriveExecutor:
    """Executes validated actions against a Cyberwave twin (or no-ops if offline)."""

    def __init__(self, robot=None, cw=None, affect: str = "simulation", dry_run: bool = False):
        self.robot = robot
        self.cw = cw
        self.affect = affect
        self.dry_run = dry_run
        # Playground can't drive a wheeled base by velocity, so in simulation we
        # move it by pushing its pose over MQTT (update_twin_position/rotation).
        # Live mode uses the real locomotion commands. Same plan drives both.
        self.sim_pose = affect.lower() in ("simulation", "sim")
        self._x = 0.0
        self._y = 0.0
        self._yaw = 0.0  # radians
        self._z = 0.0

    def _affect(self) -> None:
        if self.cw is None:
            return
        try:
            self.cw.affect(self.affect)
        except Exception as e:  # noqa: BLE001
            print(f"[drive] cw.affect({self.affect!r}) failed: {e}")
            return
        # cw.affect() drops the MQTT client, and locomotion commands publish over
        # MQTT. A publish to a disconnected client is silently dropped (the call
        # still returns "ok"), so we must connect AND wait (connect is async).
        try:
            mqtt = self.cw.mqtt
            if not getattr(mqtt, "connected", False):
                mqtt.connect()
                for _ in range(50):  # wait up to ~5 s for the broker handshake
                    if getattr(mqtt, "connected", False):
                        break
                    time.sleep(0.1)
            if not getattr(mqtt, "connected", False):
                print("[drive] WARNING: MQTT not connected — commands may be dropped")
        except Exception as e:  # noqa: BLE001
            print(f"[drive] mqtt connect warning: {e}")

    def _run_one(self, a: Action) -> None:
        if a.type == "move_forward":
            self.robot.move_forward(distance=a.distance)
        elif a.type == "move_backward":
            self.robot.move_backward(distance=a.distance)
        elif a.type == "turn_left":
            self.robot.turn_left(angle=a.angle)
        elif a.type == "turn_right":
            self.robot.turn_right(angle=a.angle)
        elif a.type == "stop":
            self.robot.move_forward(distance=0.0)
        elif a.type == "wait":
            time.sleep(a.duration)

    def stop(self) -> None:
        if self.robot is None:
            return
        try:
            self.robot.move_forward(distance=0.0)
        except Exception as e:  # noqa: BLE001
            print(f"[drive] stop failed: {e}")

    def execute(self, actions: list[Action]) -> list[dict]:
        """Run actions in order. Blocking — call from a worker thread. Returns per-action results."""
        if not actions:
            return []

        if self.robot is None or self.dry_run:
            status = "dry_run" if self.dry_run else "no_robot"
            return [{"action": a.describe(), "status": status} for a in actions]

        self._affect()

        if self.sim_pose:
            return self._execute_sim_pose(actions)

        results: list[dict] = []
        for a in actions:
            try:
                self._run_one(a)
                results.append({"action": a.describe(), "status": "ok"})
            except Exception as e:  # noqa: BLE001 - contain and stop
                results.append({"action": a.describe(), "status": f"error: {e}"})
                self.stop()
                break
        return results

    def _push_pose(self) -> None:
        uuid = self.robot.uuid
        self.cw.mqtt.update_twin_position(uuid, {"x": self._x, "y": self._y, "z": self._z})
        qz = math.sin(self._yaw / 2.0)
        qw = math.cos(self._yaw / 2.0)
        self.cw.mqtt.update_twin_rotation(uuid, {"x": 0.0, "y": 0.0, "z": qz, "w": qw})

    def _execute_sim_pose(self, actions: list[Action]) -> list[dict]:
        """Move the digital twin in Playground by integrating the plan into pose
        updates pushed over MQTT (dead-reckoning: forward along heading; turn = yaw).
        update_twin_position is the call that actually moves the base in Playground."""
        print(f"[drive] Executing {len(actions)} actions in SIMULATION mode")
        results: list[dict] = []
        for a in actions:
            try:
                print(f"[drive] Action: {a.describe()}")
                if a.type in ("move_forward", "move_backward"):
                    d = a.distance if a.type == "move_forward" else -a.distance
                    steps = max(1, int(abs(d) / 0.05))  # ~5 cm substeps for smooth motion
                    for _ in range(steps):
                        self._x += (d / steps) * math.cos(self._yaw)
                        self._y += (d / steps) * math.sin(self._yaw)
                        self._push_pose()
                        time.sleep(0.04)
                    print(f"[drive] Moved to position: x={self._x:.2f}, y={self._y:.2f}, yaw={math.degrees(self._yaw):.1f}°")
                elif a.type in ("turn_left", "turn_right"):
                    ang = a.angle if a.type == "turn_left" else -a.angle
                    steps = max(1, int(abs(ang) / 0.1))  # ~0.1 rad substeps
                    for _ in range(steps):
                        self._yaw += ang / steps
                        self._push_pose()
                        time.sleep(0.04)
                    print(f"[drive] Turned to yaw: {math.degrees(self._yaw):.1f}°")
                elif a.type == "wait":
                    time.sleep(a.duration)
                elif a.type == "stop":
                    self._push_pose()
                results.append({"action": a.describe(), "status": "sim"})
            except Exception as e:  # noqa: BLE001
                results.append({"action": a.describe(), "status": f"error: {e}"})
                break
        return results
