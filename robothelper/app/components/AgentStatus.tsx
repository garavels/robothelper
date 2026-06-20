"use client";

import type { AgentState, FeelingsState } from "../hooks/useBackend";

interface Props {
  agent: AgentState;
  feelings: FeelingsState;
}

const STATUS_STYLE: Record<string, string> = {
  idle: "text-foreground/40",
  disabled: "text-foreground/40",
  scanning: "text-cyan-400",
  planning: "text-amber-400",
  acting: "text-red-400 animate-pulse",
  error: "text-red-400",
};

const PROB_STYLE: Record<string, string> = {
  high: "bg-red-600/20 border-red-500/50 text-red-300",
  medium: "bg-amber-600/20 border-amber-500/50 text-amber-300",
  low: "bg-zinc-600/20 border-zinc-500/40 text-zinc-300",
};

export default function AgentStatus({ agent, feelings }: Props) {
  const statusClass = STATUS_STYLE[agent.status] ?? "text-foreground/40";

  return (
    <div className="px-3 py-2.5 rounded border border-border bg-panel space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-accent">
          AI Rescue Agent
        </span>
        <span className={`text-[10px] uppercase tracking-wider font-bold ${statusClass}`}>
          {agent.enabled ? `● ${agent.status}` : "○ offline"}
        </span>
      </div>

      {!agent.enabled && (
        <div className="text-[10px] text-foreground/40">
          Planner offline — set OPENAI_API_KEY in backend/.env
        </div>
      )}

      {/* Feeling (InterHuman) */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-foreground/50 uppercase tracking-wider">Feeling</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              feelings.connected ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          <span className="text-foreground/70">
            {feelings.connected ? feelings.engagement : "InterHuman offline"}
          </span>
        </div>
        {feelings.signals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {feelings.signals.slice(0, 6).map((s, i) => (
              <span
                key={`${s.type}-${i}`}
                className={`px-1.5 py-0.5 rounded border text-[9px] ${
                  PROB_STYLE[s.probability ?? "low"] ?? PROB_STYLE.low
                }`}
                title={s.rationale ?? undefined}
              >
                {s.type} {s.probability ? `(${s.probability})` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Assessment */}
      {agent.assessment && (
        <div className="text-[11px] text-foreground/80 leading-snug">
          <span className={agent.injured ? "text-red-400" : "text-emerald-400"}>
            {agent.injured ? `⚠ Injured (${agent.injured_count})` : "No injury"}
          </span>
          {" — "}
          <span className="italic">{agent.assessment}</span>
        </div>
      )}

      {/* What the rover says */}
      {agent.say && (
        <div className="text-[11px] text-cyan-300">🔊 &ldquo;{agent.say}&rdquo;</div>
      )}

      {/* Planned / executed actions */}
      {agent.actions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-foreground/40">
            Plan
          </div>
          <div className="flex flex-wrap gap-1">
            {agent.actions.map((a, i) => {
              const exec = agent.executed[i];
              const ok = exec ? exec.status === "ok" : null;
              const color =
                ok === null
                  ? "border-border text-foreground/60"
                  : ok
                    ? "border-emerald-500/40 text-emerald-300"
                    : "border-red-500/50 text-red-300";
              return (
                <span
                  key={i}
                  className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${color}`}
                  title={exec ? exec.status : "planned"}
                >
                  {a.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {agent.error && (
        <div className="text-[9px] text-red-400/80">⚠ {agent.error}</div>
      )}
    </div>
  );
}
