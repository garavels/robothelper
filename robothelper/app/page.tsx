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

  // --- Handle CV detections → injury pins + voice ---
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

    let isNewPin = false;

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
      isNewPin = true;
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
    <div className="flex flex-col h-screen overflow-hidden font-mono">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-panel shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-accent">
            ROBOTHELPER
          </span>
          <span className="text-xs text-foreground/40 uppercase tracking-[0.15em] hidden sm:inline">
            Search &amp; Rescue Ops
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                backend.robotConnected
                  ? "bg-emerald-400"
                  : backend.connected
                    ? "bg-amber-400 animate-pulse"
                    : "bg-red-400 animate-pulse"
              }`}
            />
            <span className="text-foreground/50">
              {backend.robotConnected
                ? "ROBOT ONLINE"
                : backend.connected
                  ? "ROBOT OFFLINE — CV ACTIVE"
                  : "BACKEND OFFLINE"}
            </span>
          </div>
          <button
            onClick={() => setCameraOn((c) => !c)}
            className={`px-3 py-1.5 text-xs rounded border transition-colors cursor-pointer ${
              cameraOn
                ? "border-accent/50 text-accent"
                : "border-border text-foreground/50 hover:text-accent hover:border-accent/50"
            }`}
          >
            {cameraOn ? "CAM ON" : "CAM OFF"}
          </button>
          <button
            onClick={reset}
            className="px-3 py-1.5 text-xs rounded border border-border text-foreground/50 hover:text-red-400 hover:border-red-400/50 transition-colors cursor-pointer"
          >
            RESET
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Map panel */}
        <div className="w-[60%] p-3 border-r border-border">
          <div className="h-full rounded-lg overflow-hidden border border-border relative">
            <SearchMap
              grid={grid}
              robotPos={robotPos}
              robotDir={robotDir}
              rows={ROWS}
              cols={COLS}
              injuries={injuries}
              onPinClick={handlePinClick}
            />
            <div className="absolute top-3 left-3 z-[1000] bg-panel/95 backdrop-blur-sm px-3 py-1.5 rounded border border-border">
              <span className="text-xs text-accent uppercase tracking-widest">
                Forest Search Zone — Temescal Canyon
              </span>
            </div>

            {/* Injury log overlay inside the map */}
            {panelOpen && (
              <div className="absolute top-3 right-3 z-[1000] w-64 max-h-[calc(100%-24px)] bg-panel/95 backdrop-blur-sm rounded-lg border border-border flex flex-col shadow-lg shadow-black/40">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] font-mono text-red-400 uppercase tracking-widest">
                    Injury Log
                  </span>
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      setSelectedPin(null);
                    }}
                    className="text-foreground/40 hover:text-foreground text-[10px] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
                  {injuries.length === 0 ? (
                    <div className="text-center text-[10px] text-foreground/30 py-6">
                      No injuries detected yet.
                    </div>
                  ) : (
                    injuries.map((pin) => (
                      <div
                        key={pin.id}
                        onClick={() => setSelectedPin(pin.id)}
                        className={`px-2.5 py-2 rounded border cursor-pointer transition-colors ${
                          selectedPin === pin.id
                            ? "border-red-500/60 bg-red-500/15"
                            : "border-white/5 hover:border-red-500/30 hover:bg-red-500/5"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-red-400 font-bold">
                            INJURED{pin.count > 1 ? ` ×${pin.count}` : ""}
                          </span>
                          <span className="text-[9px] text-foreground/40">
                            {new Date(pin.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-[9px] text-foreground/50">
                          ({pin.gridX}, {pin.gridY}) — {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                        </div>
                        <div className="mt-1.5 flex flex-col gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproach();
                            }}
                            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] uppercase tracking-wider rounded border border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10 transition-colors cursor-pointer"
                          >
                            ▶ Approach
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerVoice();
                            }}
                            disabled={voiceStatus !== "idle" && voiceStatus !== "done"}
                            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] uppercase tracking-wider rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {voiceStatus === "speaking" || voiceStatus === "responding" ? (
                              <span className="animate-pulse">Speaking...</span>
                            ) : voiceStatus === "listening" ? (
                              <span className="animate-pulse">Listening...</span>
                            ) : (
                              <>🔊 Hail</>
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-3 py-2 border-t border-border shrink-0 flex items-center justify-between text-[10px]">
                  <span className="text-foreground/40">
                    {injuries.length} location{injuries.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-red-400 font-bold">
                    {totalInjured} injured
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Camera + Stats panel */}
        <div className="w-[40%] flex flex-col p-3 gap-3">
          <div className="flex-1 min-h-0">
            {cameraOn ? (
              <VideoFeed
                frame={backend.frame}
                detections={backend.detections}
                cameraSource={backend.cameraSource}
                backendConnected={backend.connected}
              />
            ) : (
              <div className="h-full bg-panel rounded-lg border border-border flex items-center justify-center">
                <span className="text-sm font-mono text-zinc-500 uppercase">
                  Camera Disabled
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2">
            <AgentStatus agent={backend.agent} feelings={backend.feelings} />

            <NewsAlert />

            <div className="flex gap-2">
              <Stat
                label="Cleared"
                value={`${pct}%`}
                accent="text-emerald-400"
              />
              <Stat
                label="Scanned"
                value={`${cleared}/${ACTIVE_CELLS}`}
                accent="text-cyan-400"
              />
              <Stat
                label="Injured"
                value={`${totalInjured}`}
                accent="text-red-400"
              />
              <Stat
                label="Pins"
                value={`${injuries.length}`}
                accent="text-amber-400"
              />
            </div>

            {/* Voice interaction panel */}
            {voiceStatus !== "idle" && (
              <div className="px-3 py-2.5 rounded border border-border bg-panel space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-accent">🔊</span>
                  <span className="text-foreground/60 uppercase tracking-wider text-[10px]">
                    Voice Assistant
                  </span>
                </div>
                <div className="text-xs text-foreground/80">
                  🤖 &quot;Do you need assistance?&quot;
                </div>
                {voiceStatus === "speaking" && (
                  <div className="text-[10px] text-amber-400 animate-pulse">
                    Speaking...
                  </div>
                )}
                {voiceStatus === "listening" && (
                  <div className="text-[10px] text-cyan-400 animate-pulse">
                    🎤 Listening...
                  </div>
                )}
                {(voiceStatus === "responding" || voiceStatus === "done") &&
                  voiceTranscript && (
                    <>
                      <div className="text-xs text-emerald-300">
                        💬 &quot;{voiceTranscript}&quot;
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
                            <div className="text-xs text-foreground/80">
                              🤖 &quot;{replyText}&quot;
                            </div>
                            {voiceStatus === "responding" && (
                              <div className="text-[10px] text-amber-400 animate-pulse">
                                Speaking...
                              </div>
                            )}
                            {voiceStatus === "done" && needsHelp && (
                              <div className="mt-1 px-2.5 py-2 rounded bg-red-600/20 border border-red-500/50 text-[10px] text-red-300 space-y-1">
                                <div className="font-bold uppercase tracking-wider text-red-400">
                                  ⚠ Emergency Response Recommended
                                </div>
                                <div className="text-red-300/80">
                                  Person requires immediate assistance. Dispatch
                                  emergency personnel to this location.
                                </div>
                              </div>
                            )}
                            {voiceStatus === "done" && !needsHelp && (
                              <div className="mt-1 px-2.5 py-2 rounded bg-emerald-600/10 border border-emerald-500/30 text-[10px] text-emerald-400">
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
              <div className="px-3 py-2 rounded border border-border bg-panel text-[10px] text-foreground/40 text-center uppercase tracking-wider">
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
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex-1 px-3 py-2 rounded border border-border bg-panel">
      <div className="text-[9px] text-foreground/40 uppercase tracking-wide">
        {label}
      </div>
      <div className={`text-sm font-bold ${accent}`}>{value}</div>
    </div>
  );
}
