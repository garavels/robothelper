# RobotHelper

AI-driven search-and-rescue rover that detects injured people, reads their emotional state, plans a safe approach, and streams everything to a live ops dashboard.

Built around a **Waveshare UGV Beast** rover controlled via the **Cyberwave SDK**, with an **OpenAI vision model** as the planning brain and **InterHuman** as the emotional-signal sensor.

## Architecture

```
MacBook webcam / rover camera
        |
        v
  +-----------+       +------------------+
  | InterHuman| ----> | OpenAI Vision    |
  | (feelings)|       | (planner)        |
  +-----------+       +------------------+
                             |
                      JSON action plan
                             |
                      +------v-------+
                      | Safety layer |   validate + clamp
                      +------+-------+
                             |
                      +------v-------+
                      | Cyberwave SDK|   move_forward / turn / stop
                      +------+-------+
                             |
                      +------v-------+
                      | UGV Beast    |   digital twin or physical rover
                      +------+-------+
                             |
           +-----------------+-----------------+
           |                                   |
    +------v-------+                    +------v-------+
    | WebSocket    |                    | MQTT broker  |
    +------+-------+                    +--------------+
           |
    +------v--------------------+
    | Next.js dashboard         |
    | - live video feed         |
    | - search-zone map + pins  |
    | - agent status / feelings |
    | - news alerts             |
    | - voice interaction       |
    +---------------------------+
```

## Project Structure

```
robothelper/
  backend/
    server.py               # FastAPI WebSocket server — orchestrator loop
    agent/
      planner.py            # OpenAI vision planner (injury detection + JSON action plan)
      feelings.py           # InterHuman live-stream client (engagement + social signals)
      drive.py              # Action validation/clamping + Cyberwave UGV executor
      __init__.py
    Go2ManualControl.py     # Legacy Go2 dog REPL (kept for reference)
    requirements.txt
    .env                    # local config (git-ignored)
  robothelper/              # Next.js 16 dashboard (React 19, Tailwind 4)
    app/
      page.tsx              # Main dashboard page
      layout.tsx
      globals.css
      components/
        VideoFeed.tsx        # Live camera feed with detection overlay
        SearchMap.tsx        # Leaflet map with grid cells + injury pins
        AgentStatus.tsx      # AI agent status panel (feelings + plan)
        NewsAlert.tsx        # Live wildfire news alerts (ScrapeGraph)
      hooks/
        useBackend.ts        # WebSocket hook — frames, detections, agent state
        useCyberwave.ts      # MQTT hook — rover telemetry + SafeScout
    lib/
      searchZone.ts          # Search-zone geometry (Pacific Palisades grid)
      cyberwave.ts           # Cyberwave REST/MQTT/WebRTC helpers
    package.json
  cv_model/
    injury_detection.ipynb   # Colab notebook — synthetic data + model training
    inference.py             # Standalone YOLOv8-pose + classifier inference
    generate_graphs.py       # Research-quality figure generation
    model/
      injury_classifier.pkl  # Trained Gradient Boosting classifier
      feature_config.json    # Feature metadata
    graphs/                  # Pre-generated evaluation figures
    README.md
  PIPELINE.md                # Detailed architecture & design rationale
  .gitignore
```

## Prerequisites

- **Python 3.11+**
- **Node.js 20+** and npm
- API keys (all optional — the system degrades gracefully):

| Key | Purpose | Where to get it |
|-----|---------|-----------------|
| `OPENAI_API_KEY` | Vision planner (the "brain") | [platform.openai.com](https://platform.openai.com/api-keys) |
| `INTERHUMAN_API_KEY` | Emotional-signal sensor | [interhuman.ai](https://interhuman.ai) |
| `CYBERWAVE_API_KEY` | Robot control (UGV Beast) | [cyberwave.com](https://cyberwave.com) dashboard |
| `SMALLEST_API_KEY` | Text-to-speech (voice hail) | [smallest.ai](https://smallest.ai) |
| `SCRAPEGRAPH_API_KEY` | Live wildfire news alerts | [scrapegraphai.com](https://scrapegraphai.com) |

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Configure (copy and fill in your keys)
cp .env.example .env

# Run the server (macOS will ask for camera permission the first time)
python server.py
# or with mock robot frames:
python server.py --mock
```

The backend starts a FastAPI server on `http://localhost:8000` with:
- `GET  /api/news` — wildfire news (live via ScrapeGraph or dummy fallback)
- `POST /api/tts`  — text-to-speech proxy (smallest.ai)
- `WS   /ws`       — main WebSocket (frames + detections + agent state + feelings)

### 2. Frontend

```bash
cd robothelper
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard connects to the backend WebSocket automatically.

## How It Works

### Detection Pipeline

1. The camera loop grabs frames at ~7 fps from the webcam (or rover camera).
2. Each frame is sent to the **OpenAI vision model** (default: `gpt-4o`) along with a summary of the person's emotional state from InterHuman.
3. The model returns a strict JSON response: `injured` (bool), `assessment`, `say` (a spoken reassurance line), and an `actions` list.
4. The **safety layer** validates and clamps every action against conservative limits (max 1.0 m/step, max 3.14 rad/turn, max 8 actions per plan).
5. Validated actions are executed via the **Cyberwave SDK** against the UGV Beast (digital twin or physical rover).
6. Everything is streamed to the dashboard over WebSocket.

### InterHuman (Feelings Sensor)

The InterHuman client continuously streams ~4-second video segments to the InterHuman API over a WebSocket. It receives back engagement level, social signals (stress, frustration, hesitation, etc.), and conversation quality. These signals are fed into the planner prompt to adjust the rover's behavior (e.g., high stress = approach slower, speak sooner).

### YOLOv8 Pre-Filter (Phase 2)

Set `USE_YOLO=true` in `.env` to enable the local YOLOv8-pose + Gradient Boosting classifier as a fast pre-filter before calling OpenAI. This reduces API costs by only sending likely-injured frames to the vision model.

### Dashboard Features

- **Live video feed** with detection overlay (OK = green, INJURED = red)
- **Search-zone map** (Leaflet) with a grid overlay, injury pins, and rover position tracking
- **AI agent panel** showing the current emotional reading, injury assessment, planned actions, and execution status
- **Voice interaction** — the rover can speak ("Do you need assistance?") and listen for a response via browser speech APIs
- **News alerts** — live wildfire incident alerts pulled from CAL FIRE via ScrapeGraph
- **Keyboard controls** — W/A/S/D or arrow keys to drive the rover manually

## Configuration

All configuration is done via environment variables in `backend/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(none)_ | Required for the AI planner |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |
| `AGENT_PLAN_INTERVAL` | `4.0` | Seconds between planner calls |
| `AGENT_DRY_RUN` | `false` | Plan without sending movement commands |
| `CYBERWAVE_API_KEY` | _(none)_ | Robot connection |
| `CYBERWAVE_TWIN_UUID` | _(none)_ | UGV Beast twin ID |
| `CYBERWAVE_ENVIRONMENT_ID` | _(none)_ | Cyberwave environment ID |
| `CYBERWAVE_AFFECT` | `simulation` | `simulation` (digital twin) or `live` (physical rover) |
| `INTERHUMAN_API_KEY` | _(none)_ | Feelings sensor |
| `USE_YOLO` | `false` | Enable local YOLO pre-filter (Phase 2) |
| `CAMERA_SOURCE` | `webcam` | `webcam` or `robot` |
| `CAMERA_FPS` | `7` | Target frames per second |
| `SMALLEST_API_KEY` | _(none)_ | Text-to-speech |
| `SCRAPEGRAPH_API_KEY` | _(none)_ | Live news alerts |

### Safety Limits

| Limit | Default | Env var |
|-------|---------|---------|
| Max distance per step | 1.0 m | `DRIVE_MAX_DISTANCE_M` |
| Max angle per turn | 3.14 rad | `DRIVE_MAX_ANGLE_RAD` |
| Max wait duration | 5.0 s | `DRIVE_MAX_DURATION_S` |
| Max actions per plan | 8 | `DRIVE_MAX_ACTIONS` |

## Graceful Degradation

Every external service is optional. The system starts and runs with zero API keys configured:

| Missing key | Behavior |
|-------------|----------|
| `OPENAI_API_KEY` | Planner is "offline" — video still streams, no AI detection |
| `INTERHUMAN_API_KEY` | Feelings sensor is "offline" — planner runs without emotional context |
| `CYBERWAVE_API_KEY` | Robot is "offline" — agent plans but doesn't move; use keyboard to navigate |
| `SMALLEST_API_KEY` | TTS is silent — voice hail button is a no-op |
| `SCRAPEGRAPH_API_KEY` | News panel shows dummy wildfire alert |

## CV Model (Standalone)

The `cv_model/` directory contains a standalone injury detection pipeline that can run independently:

```bash
cd cv_model
pip install ultralytics scikit-learn opencv-python joblib

# Live webcam demo
python inference.py

# Video file
python inference.py --source path/to/video.mp4

# Single image
python inference.py --source path/to/image.jpg
```

The pipeline uses YOLOv8-pose to extract 17 body keypoints per person, computes 11 geometric features (body angle, aspect ratio, vertical spread, etc.), and classifies each person as OK or INJURED using a trained Gradient Boosting model.

## Known Limitations

- **InterHuman is video-only** — adding microphone audio would improve voice-based signals (stress/pain).
- Map pins are placed based on rover position/heading, not bounding-box pixel coordinates.
- Only locomotion verbs are used (`move_forward`, `move_backward`, `turn_left`, `turn_right`, `stop`). Camera-servo and lights are available on the UGV but not wired up yet.

## License

This project is not currently licensed for distribution.
