"use client";

import type { AgentState, FeelingsState } from "../hooks/useBackend";

interface Props {
  agent: AgentState;
  feelings: FeelingsState;
}

const STATUS_STYLE: Record<string, string> = {
  idle: "text-zinc-500",
  disabled: "text-zinc-500",
  scanning: "text-accent-light",
  planning: "text-amber-400",
  acting: "text-red-400",
  error: "text-red-400",
};

const PROB_STYLE: Record<string, string> = {
  high: "bg-red-500/10 border-red-500/25 text-red-300",
  medium: "bg-amber-500/10 border-amber-500/25 text-amber-300",
  low: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
};

export default function AgentStatus({ agent, feelings }: Props) {
  const statusClass = STATUS_STYLE[agent.status] ?? "text-zinc-500";

  return (
    <div className="px-4 py-3 rounded-2xl border border-white/[0.06] bg-surface space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.15em] font-medium gradient-text-purple">
          AI Rescue Agent
        </span>
        <span className={`text-[11px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${statusClass}`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              agent.enabled
                ? agent.status === "acting"
                  ? "bg-red-400"
                  : agent.status === "scanning"
                    ? "bg-accent"
                    : "bg-amber-400"
                : "bg-zinc-600"
            }`}
            style={agent.status === "acting" ? { animation: "dot-pulse 1s ease-in-out infinite" } : undefined}
          />
          {agent.enabled ? agent.status : "offline"}
        </span>
      </div>

      {!agent.enabled && (
        <div className="text-[11px] text-zinc-500">
          Planner offline — set OPENAI_API_KEY in backend/.env
        </div>
      )}

      {/* Feeling (InterHuman) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-zinc-500 uppercase tracking-wider font-medium">Feeling</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              feelings.connected ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          <span className="text-zinc-300">
            {feelings.connected ? feelings.engagement : "InterHuman offline"}
          </span>
        </div>
        {feelings.signals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {feelings.signals.slice(0, 6).map((s, i) => (
              <span
                key={`${s.type}-${i}`}
                className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${
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
        <div className="text-[11px] text-zinc-300 leading-snug">
          <span className={agent.injured ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
            {agent.injured ? `Injured (${agent.injured_count})` : "No injury"}
          </span>
          {" — "}
          <span className="italic text-zinc-400">{agent.assessment}</span>
        </div>
      )}

      {/* What the rover says */}
      {agent.say && (
        <div className="text-[11px] text-accent-light italic">&ldquo;{agent.say}&rdquo;</div>
      )}

      {/* Planned / executed actions */}
      {agent.actions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500 font-medium">
            Plan
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.actions.map((a, i) => {
              const exec = agent.executed[i];
              const ok = exec ? exec.status === "ok" : null;
              const color =
                ok === null
                  ? "border-white/[0.06] text-zinc-400 bg-white/[0.02]"
                  : ok
                    ? "border-emerald-500/25 text-emerald-300 bg-emerald-500/10"
                    : "border-red-500/25 text-red-300 bg-red-500/10";
              return (
                <span
                  key={i}
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-medium ${color}`}
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
        <div className="text-[10px] text-red-400/80">{agent.error}</div>
      )}
    </div>
  );
}
