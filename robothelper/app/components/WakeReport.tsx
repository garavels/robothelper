"use client";

import type { AgentState, FeelingsState } from "../hooks/useBackend";
import { useState } from "react";

interface Props {
  agent: AgentState;
  feelings: FeelingsState;
}

const PHASE: Record<
  string,
  { label: string; sub: string; cls: string; dot: string }
> = {
  scanning: {
    label: "Scanning",
    sub: "Looking for someone asleep…",
    cls: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10",
    dot: "bg-cyan-400",
  },
  waking: {
    label: "Waking you up",
    sub: "Robot approaching + calling out",
    cls: "text-amber-300 border-amber-500/50 bg-amber-500/10",
    dot: "bg-amber-400 animate-pulse",
  },
  awake: {
    label: "Awake",
    sub: "Reading your reaction…",
    cls: "text-emerald-300 border-emerald-500/50 bg-emerald-500/10",
    dot: "bg-emerald-400",
  },
  monitoring: {
    label: "Already awake",
    sub: "No wake-up needed",
    cls: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
    dot: "bg-zinc-400",
  },
  rate_limited: {
    label: "Rate-limited",
    sub: "OpenAI throttling — add billing to speed up",
    cls: "text-orange-300 border-orange-500/50 bg-orange-500/10",
    dot: "bg-orange-400 animate-pulse",
  },
  error: {
    label: "Error",
    sub: "Planner issue",
    cls: "text-red-300 border-red-500/50 bg-red-500/10",
    dot: "bg-red-400",
  },
};

const PROB_STYLE: Record<string, string> = {
  high: "bg-red-600/20 border-red-500/50 text-red-300",
  medium: "bg-amber-600/20 border-amber-500/50 text-amber-300",
  low: "bg-zinc-600/20 border-zinc-500/40 text-zinc-300",
};

function grogColor(g: number): { bar: string; text: string; word: string } {
  if (g >= 66)
    return { bar: "bg-violet-500", text: "text-violet-300", word: "Deeply asleep" };
  if (g >= 33)
    return { bar: "bg-amber-500", text: "text-amber-300", word: "Drowsy" };
  return { bar: "bg-emerald-500", text: "text-emerald-300", word: "Alert" };
}

export default function WakeReport({ agent, feelings }: Props) {
  const [downloading, setDownloading] = useState(false);
  const phase = PHASE[agent.phase] ?? PHASE.scanning;
  const grog = grogColor(agent.grogginess);
  const summary = agent.reaction_summary || agent.assessment;

  const downloadEmotionReport = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/api/emotion-report`);
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
        return;
      }

      // Create a downloadable JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wake-up-emotion-report-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download emotion report:", error);
      alert("Failed to download emotion report");
    } finally {
      setDownloading(false);
    }
  };

  const clearEmotionLog = async () => {
    if (!confirm("Are you sure you want to clear the emotion log? This cannot be undone.")) {
      return;
    }
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/api/emotion-report/clear`, {
        method: "POST",
      });
      const data = await response.json();
      if (data.status === "cleared") {
        alert("Emotion log cleared successfully!");
      }
    } catch (error) {
      console.error("Failed to clear emotion log:", error);
      alert("Failed to clear emotion log");
    }
  };

  return (
    <div className="h-full flex flex-col rounded-lg border border-border bg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-xs uppercase tracking-widest text-accent">
          Wake-Up Report
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={downloadEmotionReport}
            disabled={downloading}
            className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/30 text-[10px] text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {downloading ? "Downloading..." : "📊 Download Report"}
          </button>
          <button
            onClick={clearEmotionLog}
            className="px-2 py-1 rounded bg-red-500/20 border border-red-500/30 text-[10px] text-red-300 hover:bg-red-500/30 transition-colors"
          >
            🗑️ Clear Log
          </button>
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold">
            <span className={`w-1.5 h-1.5 rounded-full ${phase.dot}`} />
            <span className={agent.enabled ? "text-foreground/70" : "text-foreground/40"}>
              {agent.enabled ? agent.phase : "offline"}
            </span>
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {!agent.enabled && (
          <div className="text-[11px] text-foreground/50 leading-snug">
            Planner offline — set <code className="text-accent">OPENAI_API_KEY</code>{" "}
            in <code>backend/.env</code> to start detecting sleepers.
          </div>
        )}

        {/* Phase banner */}
        <div className={`rounded-md border px-3 py-2.5 ${phase.cls}`}>
          <div className="text-sm font-bold tracking-tight">{phase.label}</div>
          <div className="text-[11px] opacity-80">{phase.sub}</div>
        </div>

        {/* Emotion logging indicator */}
        {agent.phase === "awake" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-300">Recording emotions...</span>
            </div>
            <div className="text-[10px] text-emerald-200/70 mt-1">
              How you feel when waking up is being logged
            </div>
          </div>
        )}

        {/* Grogginess gauge */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
            <span className="text-foreground/50">Grogginess</span>
            <span className={`font-bold ${grog.text}`}>
              {agent.grogginess} · {grog.word}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-black/40 border border-border overflow-hidden">
            <div
              className={`h-full ${grog.bar} transition-all duration-700`}
              style={{ width: `${Math.max(2, Math.min(100, agent.grogginess))}%` }}
            />
          </div>
        </div>

        {/* Emotional reaction (InterHuman) */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
            <span className="text-foreground/50">Emotional reaction</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                feelings.connected ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <span className="text-foreground/70 normal-case tracking-normal">
              {feelings.connected ? feelings.engagement : "InterHuman offline"}
            </span>
          </div>
          {feelings.error && (
            <div className="text-[9px] text-red-400/80">
              ⚠️ InterHuman error: {typeof feelings.error === 'string' ? feelings.error : 'Connection failed'}
            </div>
          )}
          {feelings.signals.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {feelings.signals.slice(0, 8).map((s, i) => (
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
          ) : (
            <div className="text-[10px] text-foreground/30">
              {feelings.connected ? "No social signals yet." : "InterHuman not connected - emotions unavailable"}
            </div>
          )}
        </div>

        {/* AI natural-language summary */}
        {summary && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-foreground/50">
              AI summary
            </div>
            <p className="text-[12px] leading-relaxed text-foreground/85 italic">
              “{summary}”
            </p>
          </div>
        )}

        {/* What the robot says */}
        {agent.say && (
          <div className="text-[12px] text-cyan-300">
            🔊 &ldquo;{agent.say}&rdquo;
          </div>
        )}

        {/* Planned / executed actions */}
        {agent.actions.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-foreground/50">
              Approach plan
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
          <div className="text-[10px] text-red-400/80">⚠ {agent.error}</div>
        )}
      </div>
    </div>
  );
}
