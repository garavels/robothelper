"use client";

import { useMemo } from "react";
import type { CVDetection } from "../hooks/useBackend";

interface Props {
  frame: string | null;
  detections: CVDetection[];
  cameraSource: string;
  backendConnected: boolean;
}

export default function VideoFeed({
  frame,
  detections,
  cameraSource,
  backendConnected,
}: Props) {
  const injuredCount = useMemo(
    () => detections.filter((d) => d.label === "INJURED").length,
    [detections],
  );

  const sourceLabel =
    cameraSource === "robot"
      ? "Robot Camera"
      : cameraSource === "webcam"
        ? "Webcam (Fallback)"
        : "No Feed";

  return (
    <div className="relative h-full bg-panel rounded-lg border border-border overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-mono text-accent uppercase tracking-widest">
          {sourceLabel} — CV MODEL{" "}
          {backendConnected ? "Active" : "Disconnected"}
        </span>
        <span
          className={`text-xs font-mono ${detections.length > 0 ? "text-amber-400" : "text-foreground/50"
            }`}
        >
          {detections.length > 0
            ? `● ${detections.length} DETECTED`
            : "○ SCANNING"}
        </span>
      </div>


      <div className="relative flex-1 bg-black overflow-hidden">
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt="CV Feed"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-sm font-mono text-zinc-500">
              {backendConnected
                ? "AWAITING CAMERA FEED"
                : "BACKEND OFFLINE — run: python server.py"}
            </span>
          </div>
        )}

        <div
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent pointer-events-none"
          style={{ animation: "scan 3s linear infinite" }}
        />

        {injuredCount > 0 && (
          <div className="absolute bottom-0 inset-x-0 px-4 py-2 bg-red-600/90 text-white text-xs font-mono text-center uppercase tracking-wider animate-pulse">
            ⚠ {injuredCount} Potentially Injured Person
            {injuredCount > 1 ? "s" : ""} Detected
          </div>
        )}
      </div>

      {detections.length > 0 && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-border text-xs font-mono">
          <span className="text-emerald-400">
            OK: {detections.filter((d) => d.label === "OK").length}
          </span>
          <span className="text-red-400">INJURED: {injuredCount}</span>
        </div>
      )}
    </div>
  );
}
