"use client";

import { memo } from "react";

export type CellState = "danger" | "clear" | "person-injured" | "person-ok";

interface Props {
  grid: CellState[][];
  robotPos: { x: number; y: number };
  rows: number;
  cols: number;
}

const CELL_STYLE: Record<CellState, string> = {
  danger: "bg-red-500/15 border border-red-500/20",
  clear: "bg-emerald-500/15 border border-emerald-500/20",
  "person-injured": "bg-red-400/60 border border-red-400 animate-pulse",
  "person-ok": "bg-accent/30 border border-accent/40",
};

function MapGrid({ grid, robotPos, rows, cols }: Props) {
  return (
    <div className="relative h-full bg-surface rounded-2xl border border-white/[0.06] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-[11px] text-accent-light uppercase tracking-[0.15em] font-medium">
          Area Map — Sector Alpha
        </span>
        <span className="text-[11px] text-zinc-500 font-mono">
          {cols}&times;{rows}
        </span>
      </div>
      <div className="flex-1 p-3">
        <div
          className="grid gap-px h-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {grid.flatMap((row, y) =>
            row.map((cell, x) => {
              const isRobot = robotPos.x === x && robotPos.y === y;
              return (
                <div
                  key={`${x}-${y}`}
                  className={`
                    rounded-[3px] transition-colors duration-500
                    ${CELL_STYLE[cell]}
                    ${isRobot ? "!bg-accent !border-accent z-10 relative" : ""}
                  `}
                  style={isRobot ? { animation: "pulse-glow 1.5s ease-in-out infinite" } : undefined}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MapGrid);
