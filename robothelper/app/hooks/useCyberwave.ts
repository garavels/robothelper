"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import mqtt, { type MqttClient } from "mqtt";

export interface SafeScoutStatus {
  personDetected: boolean;
  posture: "prone" | "supine" | "standing" | "none";
  gasLevel: "safe" | "elevated" | "high";
  coReading: number;
  methaneReading: number;
  thermalRisk: "low" | "medium" | "high";
  recommendation: "safe" | "caution" | "unsafe";
}

export interface RobotTelemetry {
  position: { x: number; y: number; z: number };
  connected: boolean;
  batteryPct: number;
}

const DEFAULT_STATUS: SafeScoutStatus = {
  personDetected: false,
  posture: "none",
  gasLevel: "safe",
  coReading: 0,
  methaneReading: 0,
  thermalRisk: "low",
  recommendation: "safe",
};

const DEFAULT_TELEMETRY: RobotTelemetry = {
  position: { x: 0, y: 0, z: 0 },
  connected: false,
  batteryPct: 100,
};

function deriveRecommendation(
  person: boolean,
  gas: string,
  thermal: string
): SafeScoutStatus["recommendation"] {
  if (!person && gas === "safe" && thermal === "low") return "safe";
  if (person && (gas === "high" || thermal === "high")) return "unsafe";
  return "caution";
}

export function useCyberwave() {
  const [status, setStatus] = useState<SafeScoutStatus>(DEFAULT_STATUS);
  const [telemetry, setTelemetry] = useState<RobotTelemetry>(DEFAULT_TELEMETRY);
  const [mqttConnected, setMqttConnected] = useState(false);
  const clientRef = useRef<MqttClient | null>(null);

  const twinUuid = process.env.NEXT_PUBLIC_CYBERWAVE_TWIN_UUID;
  const mqttUrl = process.env.NEXT_PUBLIC_CYBERWAVE_MQTT_URL;
  const apiKey = process.env.NEXT_PUBLIC_CYBERWAVE_API_KEY;

  useEffect(() => {
    if (!mqttUrl || !apiKey || !twinUuid) return;

    const client = mqtt.connect(mqttUrl, {
      username: apiKey,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    clientRef.current = client;

    client.on("connect", () => {
      setMqttConnected(true);
      setTelemetry((prev) => ({ ...prev, connected: true }));

      client.subscribe(`cyberwave.twin.${twinUuid}.position`);
      client.subscribe(`cyberwave.twin.${twinUuid}.telemetry`);
      client.subscribe(`cyberwave.twin.${twinUuid}.safescout`);
    });

    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());

        if (topic.endsWith(".position")) {
          setTelemetry((prev) => ({
            ...prev,
            position: data.position ?? prev.position,
          }));
        }

        if (topic.endsWith(".telemetry")) {
          setTelemetry((prev) => ({
            ...prev,
            batteryPct: data.battery_pct ?? prev.batteryPct,
          }));
        }

        if (topic.endsWith(".safescout")) {
          setStatus((prev) => {
            const personDetected = data.person_detected ?? prev.personDetected;
            const gasLevel = data.gas_level ?? prev.gasLevel;
            const thermalRisk = data.thermal_risk ?? prev.thermalRisk;
            return {
              personDetected,
              posture: data.posture ?? prev.posture,
              gasLevel,
              coReading: data.co_reading ?? prev.coReading,
              methaneReading: data.methane_reading ?? prev.methaneReading,
              thermalRisk,
              recommendation: deriveRecommendation(personDetected, gasLevel, thermalRisk),
            };
          });
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    client.on("close", () => {
      setMqttConnected(false);
      setTelemetry((prev) => ({ ...prev, connected: false }));
    });

    client.on("error", () => {
      setMqttConnected(false);
    });

    return () => {
      client.end(true);
      clientRef.current = null;
    };
  }, [mqttUrl, apiKey, twinUuid]);

  const runSimulation = useCallback(() => {
    const simSteps: SafeScoutStatus[] = [
      { ...DEFAULT_STATUS },
      {
        personDetected: true,
        posture: "prone",
        gasLevel: "safe",
        coReading: 12,
        methaneReading: 0.3,
        thermalRisk: "low",
        recommendation: "caution",
      },
      {
        personDetected: true,
        posture: "prone",
        gasLevel: "elevated",
        coReading: 85,
        methaneReading: 1.2,
        thermalRisk: "medium",
        recommendation: "caution",
      },
      {
        personDetected: true,
        posture: "prone",
        gasLevel: "high",
        coReading: 210,
        methaneReading: 3.8,
        thermalRisk: "high",
        recommendation: "unsafe",
      },
    ];

    let step = 0;
    setTelemetry((prev) => ({ ...prev, connected: true }));

    const interval = setInterval(() => {
      if (step < simSteps.length) {
        setStatus(simSteps[step]);
        step++;
      } else {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return { status, telemetry, mqttConnected, runSimulation };
}
