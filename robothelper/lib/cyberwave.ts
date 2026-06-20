/**
 * Cyberwave integration for RobotHelper.
 *
 * Prerequisites:
 *  1. Cyberwave Private Beta access — https://cyberwave.com/request-early-access
 *  2. API token from Dashboard → Profile → API Tokens
 *  3. A Unitree Go2 paired with a digital twin in a Cyberwave environment
 *  4. Edge device (Raspberry Pi / Jetson) running Cyberwave Edge Core
 *
 * Set env vars:
 *   NEXT_PUBLIC_CYBERWAVE_TWIN_UUID=<your-twin-uuid>
 *   CYBERWAVE_API_TOKEN=<your-api-token>
 *   NEXT_PUBLIC_CYBERWAVE_MQTT_URL=wss://<your-mqtt-broker>
 */

// ── Types ──────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RobotTelemetry {
  position: Vec3;
  rotation: { x: number; y: number; z: number; w: number };
  timestamp: number;
}

export type TelemetryCallback = (data: RobotTelemetry) => void;

// ── MQTT-based telemetry (position tracking) ──────────────────────

const TWIN_UUID = process.env.NEXT_PUBLIC_CYBERWAVE_TWIN_UUID ?? "";
const MQTT_URL = process.env.NEXT_PUBLIC_CYBERWAVE_MQTT_URL ?? "";

let mqttClient: ReturnType<typeof import("mqtt").connect> | null = null;

export async function connectTelemetry(onData: TelemetryCallback) {
  if (!TWIN_UUID || !MQTT_URL) {
    console.warn("[cyberwave] Missing TWIN_UUID or MQTT_URL — running in demo mode");
    return null;
  }

  const mqtt = await import("mqtt");
  const client = mqtt.connect(MQTT_URL);

  client.on("connect", () => {
    console.log("[cyberwave] MQTT connected");
    client.subscribe(`cyberwave.twin.${TWIN_UUID}.position`);
    client.subscribe(`cyberwave.twin.${TWIN_UUID}.rotation`);
  });

  const latest: Partial<RobotTelemetry> = {};

  client.on("message", (topic: string, payload: Buffer) => {
    try {
      const data = JSON.parse(payload.toString());
      if (topic.endsWith(".position")) {
        latest.position = data.position;
        latest.timestamp = data.timestamp;
      } else if (topic.endsWith(".rotation")) {
        latest.rotation = data.rotation;
        latest.timestamp = data.timestamp;
      }
      if (latest.position && latest.rotation) {
        onData(latest as RobotTelemetry);
      }
    } catch {
      console.error("[cyberwave] Failed to parse MQTT message");
    }
  });

  mqttClient = client;
  return client;
}

export function disconnectTelemetry() {
  mqttClient?.end();
  mqttClient = null;
}

// ── WebRTC video stream ────────────────────────────────────────────

export async function connectVideoStream(
  videoElement: HTMLVideoElement
): Promise<RTCPeerConnection | null> {
  if (!TWIN_UUID || !MQTT_URL) {
    console.warn("[cyberwave] No credentials — video will use local camera fallback");
    return null;
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ontrack = (event) => {
    videoElement.srcObject = event.streams[0];
  };

  /**
   * Full WebRTC signaling flow via MQTT:
   *  1. Subscribe to `cyberwave.twin.{uuid}.webrtc-offer`
   *  2. On offer received, set as remote description
   *  3. Create answer, set as local description
   *  4. Publish answer back to MQTT
   *
   * The edge device initiates streaming — the browser just answers.
   * This stub is ready to wire up once the robot is connected.
   */

  return pc;
}

// ── REST API helpers (server-side only) ────────────────────────────

const API_BASE = "https://api.cyberwave.com";
const API_TOKEN = process.env.CYBERWAVE_API_TOKEN ?? "";

async function cyberwaveAPI(path: string, options?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

export async function getTwinStatus() {
  if (!API_TOKEN || !TWIN_UUID) return null;
  const res = await cyberwaveAPI(`/twins/${TWIN_UUID}`);
  return res.json();
}

export async function updateTwinPosition(position: Vec3) {
  if (!API_TOKEN || !TWIN_UUID) return null;
  return cyberwaveAPI(`/twins/${TWIN_UUID}/position`, {
    method: "PUT",
    body: JSON.stringify({ position }),
  });
}
