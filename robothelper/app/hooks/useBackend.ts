"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface CVDetection {
  bbox: [number, number, number, number];
  label: "OK" | "INJURED";
  confidence: number;
}

export interface SocialSignal {
  type: string | null;
  probability: string | null;
  rationale?: string | null;
}

export interface FeelingsState {
  connected: boolean;
  engagement: string;
  signals: SocialSignal[];
  quality: number | null;
  updated: number;
}

export interface PlannedAction {
  type: string;
  distance: number;
  angle: number;
  duration: number;
  label: string;
}

export interface ExecutedAction {
  action: string;
  status: string;
}

export interface AgentState {
  enabled: boolean;
  injured: boolean;
  injured_count: number;
  assessment: string;
  say: string;
  feelings_summary: string;
  actions: PlannedAction[];
  executed: ExecutedAction[];
  status: string;
  error: string | null;
  updated: number;
}

const DEFAULT_FEELINGS: FeelingsState = {
  connected: false,
  engagement: "unknown",
  signals: [],
  quality: null,
  updated: 0,
};

const DEFAULT_AGENT: AgentState = {
  enabled: false,
  injured: false,
  injured_count: 0,
  assessment: "",
  say: "",
  feelings_summary: "",
  actions: [],
  executed: [],
  status: "idle",
  error: null,
  updated: 0,
};

export interface BackendState {
  connected: boolean;
  robotConnected: boolean;
  cameraSource: string;
  frame: string | null;
  detections: CVDetection[];
  feelings: FeelingsState;
  agent: AgentState;
  sendCommand: (command: string) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS ?? "ws://localhost:8000/ws";

export function useBackend(): BackendState {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [robotConnected, setRobotConnected] = useState(false);
  const [cameraSource, setCameraSource] = useState("none");
  const [frame, setFrame] = useState<string | null>(null);
  const [detections, setDetections] = useState<CVDetection[]>([]);
  const [feelings, setFeelings] = useState<FeelingsState>(DEFAULT_FEELINGS);
  const [agent, setAgent] = useState<AgentState>(DEFAULT_AGENT);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "frame") {
            if (msg.frame) setFrame(msg.frame);
            if (msg.detections) setDetections(msg.detections);
            if (msg.camera_source) setCameraSource(msg.camera_source);
            if (msg.feelings) setFeelings(msg.feelings);
            if (msg.agent) setAgent(msg.agent);
          } else if (msg.type === "status") {
            setRobotConnected(msg.robot_connected ?? false);
            setCameraSource(msg.camera_source ?? "none");
          }
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(() => connectRef.current(), 3000);
      };

      ws.onerror = () => ws.close();
    } catch {
      reconnectTimer.current = setTimeout(() => connectRef.current(), 3000);
    }
  }, []);

  useEffect(() => {
    connectRef.current = connect;
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", command }));
    }
  }, []);

  return {
    connected,
    robotConnected,
    cameraSource,
    frame,
    detections,
    feelings,
    agent,
    sendCommand,
  };
}
