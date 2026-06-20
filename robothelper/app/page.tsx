"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { CellState, InjuryPin } from "./components/SearchMap";
import VideoFeed from "./components/VideoFeed";
import NewsAlert from "./components/NewsAlert";
import AgentStatus from "./components/AgentStatus";
import { useBackend } from "./hooks/useBackend";
import { useCyberwave } from "./hooks/useCyberwave";
import {
  ROWS,
  COLS,
  CELL_MASK,
  ACTIVE_CELLS,
  AREA,
  DEMO_CLEARED,
} from "@/lib/searchZone";

const SearchMap = dynamic(() => import("./components/SearchMap"), {
  ssr: false,
});

function initGrid(): CellState[][] {
  const grid = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, (): CellState => "unsearched"),
  );
  for (const [x, y] of DEMO_CLEARED) {
    if (y < ROWS && x < COLS && CELL_MASK[y]?.[x]) {
      grid[y][x] = "clear";
    }
  }
  return grid;
}

const CELL_SIZE_M = 5;
let pinIdCounter = 0;

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function Home() {
  const [grid, setGrid] = useState(initGrid);
  const [robotPos, setRobotPos] = useState({ x: 5, y: 5 });
  const [robotDir, setRobotDir] = useState<"n" | "s" | "e" | "w">("n");
  const [injuries, setInjuries] = useState<InjuryPin[]>([]);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);

  // Voice interaction state
  const [voiceStatus, setVoiceStatus] = useState<
    "idle" | "speaking" | "listening" | "responding" | "done"
  >("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceCooldown = useRef(false);

  const robotPosRef = useRef(robotPos);
  robotPosRef.current = robotPos;
  const robotDirRef = useRef(robotDir);
  robotDirRef.current = robotDir;
  const lastDetectionTime = useRef(0);
  const lastApproachTime = useRef(0);
  const lastAgentSpeakRef = useRef<{ text: string; at: number }>({
    text: "",
    at: 0,
  });

  const backend = useBackend();
  const { telemetry, mqttConnected } = useCyberwave();

  // --- SDK position tracking (MQTT) ---
  useEffect(() => {
    if (!mqttConnected || !telemetry.connected) return;
    const { x: wx, y: wy } = telemetry.position;
    const gridX = Math.round(COLS / 2 + wx / CELL_SIZE_M);
    const gridY = Math.round(ROWS / 2 - wy / CELL_SIZE_M);
    if (
      gridX >= 0 &&
      gridX < COLS &&
      gridY >= 0 &&
      gridY < ROWS &&
      CELL_MASK[gridY]?.[gridX]
    ) {
      setRobotPos({ x: gridX, y: gridY });
    }
  }, [mqttConnected, telemetry]);

  // --- Clear the single cell the robot occupies ---
  const clearCell = useCallback((cx: number, cy: number) => {
    setGrid((prev) => {
      if (
        cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS ||
        !CELL_MASK[cy]?.[cx] || prev[cy][cx] === "clear"
      ) return prev;
      const next = prev.map((r) => [...r]);
      next[cy][cx] = "clear";
      return next;
    });
  }, []);

  useEffect(() => {
    clearCell(Math.round(robotPos.x), Math.round(robotPos.y));
  }, [robotPos, clearCell]);

  // --- Voice interaction: TTS + STT + response ---
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

  const listenSTT = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const SpeechRecognition =
        (window as /* eslint-disable-line @typescript-eslint/no-explicit-any */ any)
          .SpeechRecognition ||
        (window as /* eslint-disable-line @typescript-eslint/no-explicit-any */ any)
          .webkitSpeechRecognition;

      if (!SpeechRecognition) {
        resolve("(speech recognition not supported in this browser)");
        return;
      }

      let settled = false;
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };

      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
        finish(event.results[0][0].transcript);
      };
      recognition.onerror = () => finish("(no response detected)");
      recognition.onend = () => finish("(no response detected)");

      recognition.start();
      setTimeout(() => {
        try { recognition.stop(); } catch { /* already stopped */ }
      }, 8000);
    });
  }, []);

  const triggerVoice = useCallback(async () => {
    if (voiceCooldown.current) return;
    voiceCooldown.current = true;

    setVoiceStatus("speaking");
    setVoiceTranscript("");

    await playTTS("Do you need assistance?");

    setVoiceStatus("listening");
    const transcript = await listenSTT();
    setVoiceTranscript(transcript);

    const t = transcript.toLowerCase();
    const needsHelp =
      t.includes("no response") ||
      t.includes("yes") ||
      t.includes("help") ||
      t.includes("please") ||
      t.includes("hurt") ||
      t.includes("pain") ||
      t.includes("stuck");

    setVoiceStatus("responding");
    if (needsHelp) {
      await playTTS(
        "Stay calm. Help is on the way. Emergency response has been notified of your location.",
      );
    } else {
      await playTTS("Understood. Stay safe. Flagging your position for the rescue team.");
    }

    setVoiceStatus("done");

    setTimeout(() => {
      voiceCooldown.current = false;
    }, 15000);
  }, [playTTS, listenSTT]);

  // --- Handle CV detections -> injury pins + voice ---
  useEffect(() => {
    if (!cameraOn || !backend.detections.length) return;

    const now = Date.now();
    if (now - lastDetectionTime.current < 4000) return;
    if (now - lastApproachTime.current < 5000) return;

    const injured = backend.detections.filter((d) => d.label === "INJURED");
    if (!injured.length) return;

    lastDetectionTime.current = now;
    const pos = robotPosRef.current;
    const dir = robotDirRef.current;
    const dirOffset: Record<string, [number, number]> = {
      n: [0, -2], s: [0, 2], e: [2, 0], w: [-2, 0],
    };
    const [offX, offY] = dirOffset[dir] ?? [0, -2];
    const pinX = Math.max(0, Math.min(COLS - 1, pos.x + offX));
    const pinY = Math.max(0, Math.min(ROWS - 1, pos.y + offY));

    const cellW = (AREA.east - AREA.west) / COLS;
    const cellH = (AREA.north - AREA.south) / ROWS;
    const lat = AREA.north - (pinY + 0.5) * cellH;
    const lng = AREA.west + (pinX + 0.5) * cellW;

    setInjuries((prev) => {
      const existing = prev.find(
        (p) =>
          Math.abs(p.gridX - pinX) <= 1 && Math.abs(p.gridY - pinY) <= 1,
      );
      if (existing) {
        if (injured.length <= existing.count) return prev;
        return prev.map((p) =>
          p.id === existing.id
            ? { ...p, count: injured.length, timestamp: now }
            : p,
        );
      }
      pinIdCounter++;
      return [
        ...prev,
        {
          id: `injury-${pinIdCounter}`,
          lat,
          lng,
          gridX: pinX,
          gridY: pinY,
          count: injured.length,
          timestamp: now,
        },
      ];
    });

  }, [backend.detections, cameraOn]);

  // --- Rescue agent: speak its reassurance line (deduped + rate-limited) ---
  useEffect(() => {
    if (!cameraOn) return;
    const say = backend.agent.say?.trim();
    if (!say || !backend.agent.injured) return;
    const now = Date.now();
    if (say === lastAgentSpeakRef.current.text) return;
    if (now - lastAgentSpeakRef.current.at < 12000) return;
    lastAgentSpeakRef.current = { text: say, at: now };
    playTTS(say);
  }, [backend.agent.say, backend.agent.injured, cameraOn, playTTS]);

  // --- Keyboard controls ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const moves: Record<string, [number, number]> = {
        w: [0, -1],
        arrowup: [0, -1],
        s: [0, 1],
        arrowdown: [0, 1],
        a: [-1, 0],
        arrowleft: [-1, 0],
        d: [1, 0],
        arrowright: [1, 0],
      };
      const dir = moves[e.key.toLowerCase()];
      if (!dir) return;

      e.preventDefault();

      // Track direction
      if (dir[1] < 0) setRobotDir("n");
      else if (dir[1] > 0) setRobotDir("s");
      else if (dir[0] > 0) setRobotDir("e");
      else if (dir[0] < 0) setRobotDir("w");

      if (backend.robotConnected) {
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
        backend.sendCommand(cmds[e.key.toLowerCase()]);
      } else {
        setRobotPos((prev) => {
          const nx = Math.max(0, Math.min(COLS - 1, Math.round(prev.x) + dir[0]));
          const ny = Math.max(0, Math.min(ROWS - 1, Math.round(prev.y) + dir[1]));
          if (!CELL_MASK[ny]?.[nx]) return prev;
          return { x: nx, y: ny };
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [backend.robotConnected, backend.sendCommand]);

  // --- Derived stats ---
  const cleared = grid
    .flat()
    .filter((c, i) => {
      const y = Math.floor(i / COLS);
      const x = i % COLS;
      return CELL_MASK[y]?.[x] && c === "clear";
    }).length;
  const pct =
    ACTIVE_CELLS > 0 ? ((cleared / ACTIVE_CELLS) * 100).toFixed(1) : "0";
  const totalInjured = injuries.reduce((sum, p) => sum + p.count, 0);

  const reset = () => {
    setGrid(initGrid());
    setRobotPos({ x: 5, y: 5 });
    setRobotDir("n");
    setInjuries([]);
    setSelectedPin(null);
    setPanelOpen(false);
    setVoiceStatus("idle");
    setVoiceTranscript("");
  };

  const handlePinClick = (id: string) => {
    setSelectedPin(id);
    setPanelOpen(true);
  };

  const handleApproach = useCallback(() => {
    lastApproachTime.current = Date.now();
    backend.sendCommand("approach");

    const step = 10 / CELL_SIZE_M;
    const dirDelta: Record<string, [number, number]> = {
      n: [0, -step], s: [0, step], e: [step, 0], w: [-step, 0],
    };
    const [dx, dy] = dirDelta[robotDir] ?? [0, -step];

    setRobotPos((prev) => {
      const nx = Math.max(0, Math.min(COLS - 1, prev.x + dx));
      const ny = Math.max(0, Math.min(ROWS - 1, prev.y + dy));
      if (!CELL_MASK[Math.round(ny)]?.[Math.round(nx)]) return prev;
      return { x: nx, y: ny };
    });
  }, [robotDir, backend]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Navigation — glass morphism header */}
      <header className="glass-strong flex items-center justify-between px-6 py-3 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="gradient-text-purple">RobotHelper</span>
          </h1>
          <span className="text-xs text-muted uppercase tracking-[0.2em] hidden sm:inline">
            Search &amp; Rescue Ops
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* Connection status pill */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <span
              className={`w-2 h-2 rounded-full ${
                backend.robotConnected
                  ? "bg-emerald-400"
                  : backend.connected
                    ? "bg-amber-400"
                    : "bg-red-400"
              }`}
              style={{ animation: !backend.robotConnected ? "dot-pulse 2s ease-in-out infinite" : undefined }}
            />
            <span className="text-xs text-zinc-400">
              {backend.robotConnected
                ? "Robot Online"
                : backend.connected
                  ? "CV Active"
                  : "Offline"}
            </span>
          </div>
          {/* Camera toggle */}
          <button
            onClick={() => setCameraOn((c) => !c)}
            className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all cursor-pointer ${
              cameraOn
                ? "bg-accent/15 text-accent-light border border-accent/30"
                : "bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:text-accent-light hover:border-accent/30"
            }`}
          >
            {cameraOn ? "Cam On" : "Cam Off"}
          </button>
          {/* Reset button */}
          <button
            onClick={reset}
            className="px-4 py-1.5 text-xs font-medium rounded-full bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:text-red-400 hover:border-red-400/30 transition-all cursor-pointer"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Map panel */}
        <div className="w-[60%] p-4">
          <div className="h-full rounded-2xl overflow-hidden border border-white/[0.06] relative bg-surface">
            <SearchMap
              grid={grid}
              robotPos={robotPos}
              robotDir={robotDir}
              rows={ROWS}
              cols={COLS}
              injuries={injuries}
              onPinClick={handlePinClick}
            />
            {/* Zone label — glass overlay */}
            <div className="absolute top-4 left-4 z-[1000] glass px-4 py-2 rounded-full">
              <span className="text-xs text-accent-light uppercase tracking-[0.15em] font-medium">
                Forest Search Zone — Temescal Canyon
              </span>
            </div>

            {/* Injury log overlay */}
            {panelOpen && (
              <div className="absolute top-4 right-4 z-[1000] w-72 max-h-[calc(100%-32px)] glass-strong rounded-2xl flex flex-col shadow-2xl shadow-black/60">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
                  <span className="text-[11px] font-medium text-red-400 uppercase tracking-[0.15em]">
                    Injury Log
                  </span>
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      setSelectedPin(null);
                    }}
                    className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer transition-colors"
                  >
                    &times;
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                  {injuries.length === 0 ? (
                    <div className="text-center text-xs text-zinc-600 py-8">
                      No injuries detected yet.
                    </div>
                  ) : (
                    injuries.map((pin) => (
                      <div
                        key={pin.id}
                        onClick={() => setSelectedPin(pin.id)}
                        className={`px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                          selectedPin === pin.id
                            ? "bg-red-500/10 border border-red-500/30"
                            : "bg-white/[0.02] border border-white/[0.04] hover:border-red-500/20 hover:bg-red-500/5"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-red-400 font-semibold">
                            INJURED{pin.count > 1 ? ` x${pin.count}` : ""}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(pin.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          ({pin.gridX}, {pin.gridY}) — {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                        </div>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproach();
                            }}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer"
                          >
                            Approach
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerVoice();
                            }}
                            disabled={voiceStatus !== "idle" && voiceStatus !== "done"}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider rounded-lg bg-accent/10 border border-accent/25 text-accent-light hover:bg-accent/20 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {voiceStatus === "speaking" || voiceStatus === "responding" ? (
                              <span className="animate-pulse">Speaking...</span>
                            ) : voiceStatus === "listening" ? (
                              <span className="animate-pulse">Listening...</span>
                            ) : (
                              "Hail"
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-4 py-2.5 border-t border-white/[0.06] shrink-0 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">
                    {injuries.length} location{injuries.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-red-400 font-semibold">
                    {totalInjured} injured
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel — Camera + Status */}
        <div className="w-[40%] flex flex-col p-4 pl-0 gap-3">
          {/* Camera feed */}
          <div className="flex-1 min-h-0">
            {cameraOn ? (
              <VideoFeed
                frame={backend.frame}
                detections={backend.detections}
                cameraSource={backend.cameraSource}
                backendConnected={backend.connected}
              />
            ) : (
              <div className="h-full bg-surface rounded-2xl border border-white/[0.06] flex items-center justify-center">
                <span className="text-sm text-zinc-600">
                  Camera Disabled
                </span>
              </div>
            )}
          </div>

          {/* Status panels */}
          <div className="shrink-0 space-y-3">
            <AgentStatus agent={backend.agent} feelings={backend.feelings} />

            <NewsAlert />

            {/* Stats row */}
            <div className="flex gap-2">
              <Stat
                label="Cleared"
                value={`${pct}%`}
                color="text-emerald-400"
              />
              <Stat
                label="Scanned"
                value={`${cleared}/${ACTIVE_CELLS}`}
                color="text-accent-light"
              />
              <Stat
                label="Injured"
                value={`${totalInjured}`}
                color="text-red-400"
              />
              <Stat
                label="Pins"
                value={`${injuries.length}`}
                color="text-amber-400"
              />
            </div>

            {/* Voice interaction panel */}
            {voiceStatus !== "idle" && (
              <div className="px-4 py-3 rounded-2xl border border-white/[0.06] bg-surface space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: "dot-pulse 1.5s ease-in-out infinite" }} />
                  <span className="text-[11px] text-zinc-400 uppercase tracking-[0.15em] font-medium">
                    Voice Assistant
                  </span>
                </div>
                <div className="text-xs text-zinc-300">
                  &quot;Do you need assistance?&quot;
                </div>
                {voiceStatus === "speaking" && (
                  <div className="text-[11px] text-amber-400 animate-pulse">
                    Speaking...
                  </div>
                )}
                {voiceStatus === "listening" && (
                  <div className="text-[11px] text-accent-light animate-pulse">
                    Listening...
                  </div>
                )}
                {(voiceStatus === "responding" || voiceStatus === "done") &&
                  voiceTranscript && (
                    <>
                      <div className="text-xs text-emerald-300">
                        &quot;{voiceTranscript}&quot;
                      </div>
                      {(() => {
                        const t = voiceTranscript.toLowerCase();
                        const needsHelp =
                          t.includes("no response") ||
                          t.includes("yes") ||
                          t.includes("help") ||
                          t.includes("please") ||
                          t.includes("hurt") ||
                          t.includes("pain") ||
                          t.includes("stuck");
                        const replyText = needsHelp
                          ? "Stay calm. Help is on the way. Emergency response has been notified of your location."
                          : "Understood. Stay safe. Flagging your position for the rescue team.";
                        return (
                          <>
                            <div className="text-xs text-zinc-300">
                              &quot;{replyText}&quot;
                            </div>
                            {voiceStatus === "responding" && (
                              <div className="text-[11px] text-amber-400 animate-pulse">
                                Speaking...
                              </div>
                            )}
                            {voiceStatus === "done" && needsHelp && (
                              <div className="mt-1.5 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-[11px] text-red-300 space-y-1">
                                <div className="font-semibold uppercase tracking-wider text-red-400">
                                  Emergency Response Recommended
                                </div>
                                <div className="text-red-300/80">
                                  Person requires immediate assistance. Dispatch
                                  emergency personnel to this location.
                                </div>
                              </div>
                            )}
                            {voiceStatus === "done" && !needsHelp && (
                              <div className="mt-1.5 px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-[11px] text-emerald-400">
                                Person declined assistance — no action needed.
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}
              </div>
            )}

            {!backend.robotConnected && (
              <div className="px-4 py-2.5 rounded-xl border border-white/[0.04] bg-white/[0.02] text-[11px] text-zinc-500 text-center tracking-wide">
                Use W A S D or arrow keys to move the robot
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-surface">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
