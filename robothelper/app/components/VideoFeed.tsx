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
  const sourceLabel =
    cameraSource === "robot"
      ? "Robot Camera"
      : cameraSource === "webcam"
        ? "Webcam (Fallback)"
        : "No Feed";

  return (
    <div className="relative h-full bg-surface rounded-2xl border border-white/[0.06] overflow-hidden flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${backendConnected ? "bg-accent" : "bg-zinc-600"}`} />
          <span className="text-[11px] text-zinc-400 uppercase tracking-[0.12em] font-medium">
            {sourceLabel} — CV {backendConnected ? "Active" : "Off"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {detections.length > 0 ? (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-[10px] text-amber-400 font-medium">
              {detections.length} detected
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[10px] text-zinc-500 font-medium">
              Scanning
            </span>
          )}
        </div>
      </div>

      {/* Video area */}
      <div className="relative flex-1 bg-black overflow-hidden">
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt="CV Feed"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-sm text-zinc-600">
              {backendConnected
                ? "Awaiting camera feed"
                : "Backend offline — run: python server.py"}
            </span>
          </div>
        )}

        {/* Scan line */}
        <div
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent pointer-events-none"
          style={{ animation: "scan 3s linear infinite" }}
        />
      </div>

      {/* Detection summary */}
      {detections.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] text-[11px] font-medium">
          <span className="text-emerald-400">
            OK: {detections.filter((d) => d.label === "OK").length}
          </span>
        </div>
      )}
    </div>
  );
}
