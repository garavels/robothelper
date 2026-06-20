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

    def _affect(self) -> None:
        if self.cw is None:
            return
        try:
            self.cw.affect(self.affect)
        except Exception as e:  # noqa: BLE001
            print(f"[drive] cw.affect({self.affect!r}) failed: {e}")

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
        results: list[dict] = []

        if not actions:
            return results

        if self.robot is None or self.dry_run:
            status = "dry_run" if self.dry_run else "no_robot"
            return [{"action": a.describe(), "status": status} for a in actions]

        self._affect()
        for a in actions:
            try:
                self._run_one(a)
                results.append({"action": a.describe(), "status": "ok"})
            except Exception as e:  # noqa: BLE001 - contain and stop
                results.append({"action": a.describe(), "status": f"error: {e}"})
                self.stop()
                break
        return results
