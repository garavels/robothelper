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

  // Debug: Log agent state changes
  useEffect(() => {
    console.log('[Agent State Update]', backend.agent);
  }, [backend.agent]);

  const lastAgentSpeakRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  // --- TTS for wake-up voice ---
  const playTTS = useCallback(async (text: string) => {
    console.log('[TTS] Attempting to speak:', text);
    
    // Always use browser TTS as primary since it's more reliable
    if ('speechSynthesis' in window) {
      try {
        console.log('[TTS] Using browser speech synthesis');
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onstart = () => console.log('[TTS] Browser TTS started');
        utterance.onend = () => console.log('[TTS] Browser TTS finished');
        utterance.onerror = (e) => console.error('[TTS] Browser TTS error:', e);
        
        speechSynthesis.speak(utterance);
        return;
      } catch (err) {
        console.error('[TTS] Browser TTS failed:', err);
      }
    } else {
      console.log('[TTS] Browser speech synthesis not available');
    }
    
    // Fallback to API if browser TTS fails
    try {
      console.log('[TTS] Trying API fallback');
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
        console.log('[TTS] API TTS completed');
      } else {
        console.log('[TTS] API also failed, no audio options left');
      }
    } catch (err) {
      console.error('[TTS] API fallback failed:', err);
    }
  }, []);

  // --- Speak wake-up line (repeated while asleep, different message when awake) ---
  useEffect(() => {
    console.log('[TTS Debug] Camera on:', cameraOn);
    console.log('[TTS Debug] Agent state:', backend.agent);
    console.log('[TTS Debug] Agent say:', backend.agent.say);
    
    if (!cameraOn) {
      console.log('[TTS Debug] Skipping - camera off');
      return;
    }
    
    const { asleep, phase, say: agentSay } = backend.agent;
    const now = Date.now();
    const timeSinceLastSpeak = now - lastAgentSpeakRef.current.at;
    
    // Generate appropriate message based on state
    let message = "";
    
    if (asleep && phase === "waking") {
      // While asleep: repeat wake-up messages every 5 seconds
      message = agentSay?.trim() || "Wake up! Time to wake up!";
      if (timeSinceLastSpeak < 5000) { // 5 second cooldown for repetition
        console.log('[TTS Debug] Skipping - rate limited (5s cooldown for repetition)');
        return;
      }
    } else if (!asleep && (phase === "awake" || phase === "monitoring")) {
      // Just woke up: special message, say it only once
      message = "Finally you are awake!";
      if (message === lastAgentSpeakRef.current.text) {
        console.log('[TTS Debug] Skipping - already said wake-up completion message');
        return;
      }
    } else {
      console.log('[TTS Debug] Skipping - not in appropriate phase for speech');
      return;
    }
    
    console.log('[TTS] Speaking:', message);
    console.log('[TTS Debug] State:', { asleep, phase, timeSinceLastSpeak });
    lastAgentSpeakRef.current = { text: message, at: now };
    playTTS(message).catch(err => {
      console.error('[TTS] Error playing audio:', err);
    });
  }, [backend.agent.asleep, backend.agent.phase, backend.agent.say, cameraOn, playTTS]);

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
            <img 
              src="/logo.png" 
              alt="RobotHelper Logo" 
              className="w-10 h-10 rounded-lg object-contain"
            />
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
            <button
              onClick={() => {
                console.log('[Manual TTS] Testing TTS...');
                playTTS("Good morning! This is a manual test of the text-to-speech system.");
              }}
              className="px-3 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 text-xs hover:bg-emerald-500/30 transition-colors text-emerald-400"
            >
              Test TTS
            </button>
            <button
              onClick={() => {
                console.log('[Simulate Sleep] Simulating sleep detection...');
                // Manually trigger the TTS by directly calling the function
                // This bypasses all the agent logic to test the audio chain
                lastAgentSpeakRef.current = { text: "", at: 0 }; // Reset rate limiting
                playTTS("Good morning! Time to wake up! I detected that you are asleep.");
              }}
              className="px-3 py-1.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-xs hover:bg-amber-500/30 transition-colors text-amber-400"
            >
              Simulate Sleep
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