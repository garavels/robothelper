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
  danger: "bg-red-100 border border-red-200/60",
  clear: "bg-emerald-100 border border-emerald-200/60",
  "person-injured": "bg-red-400/70 border border-red-400 animate-pulse",
  "person-ok": "bg-sky-300/60 border border-sky-400/60",
};

function MapGrid({ grid, robotPos, rows, cols }: Props) {
  return (
    <div className="relative h-full bg-panel rounded-xl border border-border overflow-hidden flex flex-col shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-[10px] font-mono text-accent uppercase tracking-widest">
          Area Map — Sector Alpha
        </span>
        <span className="text-[10px] font-mono text-foreground/30">
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
                    rounded-[2px] transition-colors duration-500
                    ${CELL_STYLE[cell]}
                    ${isRobot ? "!bg-cyan-500 !border-cyan-600 z-10 relative" : ""}
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
