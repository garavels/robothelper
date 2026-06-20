"""
OpenAI vision planner
=====================
The "brain" of the wake-up robot. Takes ONE camera frame plus a short summary of
how the visible person seems to feel (from the InterHuman social-signal sensor)
and returns a strict JSON object: whether the person looks asleep, a one-line
assessment, how groggy they look, a short reaction report, a friendly wake-up
line to speak, and a short, safe list of rover actions to approach them.

Mirrors the proven Cyberwave "natural-language agent" pattern (camera + text ->
VLM planner -> validated JSON plan), with OpenAI as the planner instead of Claude.

Docs:
- OpenAI vision (image_url + base64 data URL) and JSON response_format.
- Cyberwave UGV action vocabulary (move_forward/move_backward/turn_left/turn_right/stop/wait).

The model is treated as untrusted input: this module only PARSES the response.
All safety validation/clamping happens in agent.drive before anything moves.
"""

from __future__ import annotations

import json
import os
import re

DEFAULT_MODEL = "gpt-4o"

# The action vocabulary here is a 1:1 subset of the verbs the Cyberwave UGV
# Beast already understands. We keep it to locomotion for a safe first version.
SYSTEM_PROMPT = """You are the perception-and-planning brain of a small "wake-up" robot (a Waveshare UGV Beast).

You receive ONE still frame from the robot's forward camera, plus a short note about how the visible person seems to feel (from a social-signal sensor). Your job has three parts:

1. DETECT: decide whether a person in the frame appears to be ASLEEP. Signs of sleep: eyes closed, lying down on a bed/couch/desk, head resting down or slumped, motionless, very relaxed posture. A person sitting up with eyes open, moving, looking around, or clearly active is AWAKE.

2. PLAN: if the person looks asleep, produce a SHORT, SAFE sequence of robot actions to approach them gently so the robot is close enough to wake them. The spoken wake-up announcement is played separately by the system, so you only plan MOVEMENT here. If the person is awake or no person is visible, return an empty action list.

3. REPORT: estimate how groggy/sleepy the person looks right now ("grogginess" 0..100, where 0 = wide awake and alert, 100 = deeply asleep) and write a short, friendly "reaction_summary" describing what you see — and, if the person appears to have just woken up, how they are reacting (e.g. groggy, startled, annoyed, cheerful). Take the social-signal note into account.

You MUST reply with a single strict JSON object and NOTHING else (no markdown, no code fences, no text outside the JSON). The object MUST have exactly these keys:

{
  "person_present": boolean,
  "asleep": boolean,
  "grogginess": integer,
  "assessment": string,
  "reaction_summary": string,
  "say": string,
  "actions": [ ... ]
}

Each entry in "actions" must be one of:
  {"type": "move_forward",  "distance": <metres 0..1.0>}
  {"type": "move_backward", "distance": <metres 0..1.0>}
  {"type": "turn_left",     "angle": <radians 0..3.14>}
  {"type": "turn_right",    "angle": <radians 0..3.14>}
  {"type": "wait",          "duration": <seconds 0..5>}
  {"type": "stop"}

Rules:
- If no person is visible: "person_present" = false, "asleep" = false, "grogginess" = 0, "actions" = [], "say" = "", and say so in "assessment".
- If the person is AWAKE: "asleep" = false, "actions" = [], "say" = "". Still set a (low) "grogginess" and describe how alert/expressive they look in "reaction_summary".
- If the person is ASLEEP: "asleep" = true. Approach conservatively: small forward steps (<= 0.5 m each), gentle turns. ALWAYS end an approach with a "stop". "say" = ONE short, friendly wake-up line (e.g. "Good morning! Time to wake up!").
- Never output more than 8 actions.
- "assessment" is ONE short sentence describing what you see.
- Output ONLY the JSON object."""


def build_feelings_summary(feelings: dict | None) -> str:
    """Turn the InterHuman 'latest' dict into a short human-readable note."""
    if not feelings:
        return "No social-signal data available yet."

    parts: list[str] = []
    engagement = feelings.get("engagement")
    if engagement and engagement != "unknown":
        parts.append(f"engagement: {engagement}")

    signals = feelings.get("signals") or []
    if signals:
        rendered = ", ".join(
            f"{s.get('type', '?')} ({s.get('probability', '?')})" for s in signals[:6]
        )
        parts.append(f"detected social signals: {rendered}")

    if not parts:
        return "No notable social signals detected yet."
    return "; ".join(parts) + "."


def _strip_to_json(text: str) -> str:
    """Best-effort: pull the JSON object out of a model reply."""
    text = text.strip()
    # Remove ```json ... ``` fences if present.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    # Fall back to the first {...} block.
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
    return text


def parse_plan(text: str) -> tuple[dict | None, str | None]:
    """Defensive parser. Returns (plan_dict, error). Never raises."""
    if not text:
        return None, "empty model response"
    try:
        data = json.loads(_strip_to_json(text))
    except Exception as e:  # noqa: BLE001 - we never want the loop to crash here
        return None, f"json parse failed: {e}"
    if not isinstance(data, dict):
        return None, "model did not return a JSON object"
    return data, None


def _client():
    """Build an OpenAI client, or None if the key/library is unavailable."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return None
    try:
        from openai import OpenAI
    except Exception as e:  # noqa: BLE001
        print(f"[planner] openai library not installed: {e}")
        return None
    return OpenAI(api_key=api_key)


def plan(frame_b64_jpeg: str, feelings: dict | None, model: str | None = None) -> dict:
    """
    Run the planner on one base64 JPEG frame + the latest feelings.

    Returns a dict:
      {"ok": True,  "plan": <parsed dict>, "feelings_summary": str}
      {"ok": False, "error": <reason>,    "feelings_summary": str}
    """
    feelings_summary = build_feelings_summary(feelings)
    client = _client()
    if client is None:
        return {"ok": False, "error": "OPENAI_API_KEY not set or openai not installed",
                "feelings_summary": feelings_summary}

    model = model or os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
    user_text = (
        "Analyse this robot camera frame. Decide whether the person is asleep and, "
        "if so, plan a gentle approach so the robot can wake them.\n"
        f"Social-signal sensor note: {feelings_summary}\n"
        "Reply with the JSON object exactly as specified."
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.2,
            max_tokens=600,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{frame_b64_jpeg}"
                            },
                        },
                    ],
                },
            ],
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"openai call failed: {e}",
                "feelings_summary": feelings_summary}

    text = resp.choices[0].message.content or ""
    data, err = parse_plan(text)
    if err:
        return {"ok": False, "error": err, "raw": text, "feelings_summary": feelings_summary}
    return {"ok": True, "plan": data, "feelings_summary": feelings_summary}
