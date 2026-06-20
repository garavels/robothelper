"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import VideoFeed from "./components/VideoFeed";
import WakeReport from "./components/WakeReport";
import NewsFeed from "./components/NewsFeed";
import { useBackend } from "./hooks/useBackend";
import { useCyberwave } from "./hooks/useCyberwave";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function Home() {
  const [cameraOn, setCameraOn] = useState(true);
  const [showNews, setShowNews] = useState(false);

  const backend = useBackend();
  const { telemetry, mqttConnected } = useCyberwave();

  const lastAgentSpeakRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  // --- TTS for wake-up voice ---
  const playTTS = useCallback(async (text: string) => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      }
    } catch {
      /* TTS unavailable */
    }
  }, []);

  // --- Speak wake-up line (deduped + rate-limited) ---
  useEffect(() => {
    if (!cameraOn) return;
    const say = backend.agent.say?.trim();
    if (!say) return;
    const now = Date.now();
    if (say === lastAgentSpeakRef.current.text) return;
    if (now - lastAgentSpeakRef.current.at < 12000) return;
    lastAgentSpeakRef.current = { text: say, at: now };
    playTTS(say);
  }, [backend.agent.say, cameraOn, playTTS]);

  // --- Show news feed when awake ---
  useEffect(() => {
    setShowNews(backend.agent.phase === "awake" || backend.agent.phase === "monitoring");
  }, [backend.agent.phase]);

  // --- Keyboard controls ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const cmds: Record<string, string> = {
        w: "forward",
        arrowup: "forward",
        s: "backward",
        arrowdown: "backward",
        a: "left",
        arrowleft: "left",
        d: "right",
        arrowright: "right",
      };
      const cmd = cmds[e.key.toLowerCase()];
      if (!cmd) return;

      e.preventDefault();
      if (backend.robotConnected) {
        backend.sendCommand(cmd);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [backend.robotConnected, backend.sendCommand]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-sm font-bold">
              🤖
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">RobotHelper</h1>
              <p className="text-xs text-zinc-500">Wake-Up Robot</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${backend.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
              <span className="text-xs text-zinc-400">
                {backend.connected ? "Backend" : "Offline"}
              </span>
            </div>
            <button
              onClick={() => setCameraOn(!cameraOn)}
              className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs hover:bg-white/10 transition-colors"
            >
              {cameraOn ? "Camera On" : "Camera Off"}
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Left column - Video feed */}
        <div className="lg:col-span-2 h-[500px]">
          <VideoFeed
            frame={backend.frame}
            detections={backend.detections}
            cameraSource={backend.cameraSource}
            backendConnected={backend.connected}
          />
        </div>

        {/* Right column - Wake report */}
        <div className="h-[500px]">
          <WakeReport agent={backend.agent} feelings={backend.feelings} />
        </div>

        {/* Bottom row - News feed (when awake) */}
        {showNews && (
          <div className="lg:col-span-3">
            <NewsFeed />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-zinc-600">
          <p>Controls: W/A/S/D or Arrow keys to move robot manually</p>
        </div>
      </footer>
    </main>
  );
}