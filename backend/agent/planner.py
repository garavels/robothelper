"""
OpenAI vision planner
=====================
The "brain" of the rescue rover. Takes ONE camera frame plus a short summary of
how any visible person seems to feel (from the InterHuman social-signal sensor)
and returns a strict JSON object: whether someone looks injured, a one-line
assessment, a sentence to speak, and a short, safe list of rover actions.

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
SYSTEM_PROMPT = """You are the perception-and-planning brain of a small ground rescue rover (a Waveshare UGV Beast).

You receive ONE still frame from the rover's forward camera, plus a short note about how any visible person seems to feel (from a social-signal sensor). Your job has two parts:

1. DETECT: decide whether a person in the frame appears INJURED or in need of help. Signs include: lying on the ground, slumped or collapsed, not moving normally, visibly distressed or in pain, bleeding, or trapped. A person standing/walking/sitting normally is NOT injured.

2. PLAN: if someone looks injured, produce a SHORT, SAFE sequence of rover actions to approach calmly and reassure them. If no one looks injured, return an empty action list.

You MUST reply with a single strict JSON object and NOTHING else (no markdown, no code fences, no text outside the JSON). The object MUST have exactly these keys:

{
  "injured": boolean,
  "injured_count": integer,
  "assessment": string,
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
- If no injured person is visible: "injured" = false, "injured_count" = 0, "actions" = [], "say" = "".
- Approach conservatively: small forward steps (<= 0.5 m each), gentle turns. ALWAYS end an approach with a "stop".
- Never output more than 8 actions.
- "assessment" is ONE short sentence describing what you see.
- "say" is ONE short, calm sentence the rover speaks to the person (empty string if no one needs help).
- If the person seems highly stressed or in pain, prioritise speaking a calm reassurance and approach slowly.
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
        "Analyse this rover camera frame for an injured person who may need help.\n"
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
