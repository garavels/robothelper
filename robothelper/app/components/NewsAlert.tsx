"use client";

import { useState, useEffect } from "react";

interface NewsData {
  headline: string;
  summary: string;
  severity: "critical" | "high" | "moderate" | "low";
  source: string;
  search_zone_expanded: boolean;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

const SEVERITY_STYLES: Record<string, string> = {
  critical:
    "border-red-500/60 bg-red-950/80 text-red-100",
  high: "border-orange-500/60 bg-orange-950/80 text-orange-100",
  moderate:
    "border-amber-500/60 bg-amber-950/80 text-amber-100",
  low: "border-blue-500/60 bg-blue-950/80 text-blue-100",
};

const SEVERITY_ACCENT: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  moderate: "text-amber-400",
  low: "text-blue-400",
};

export default function NewsAlert() {
  const [news, setNews] = useState<NewsData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchNews() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/news`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: NewsData = await res.json();
        if (!cancelled) {
          setNews(data);
          if (data.search_zone_expanded) {
            setTimeout(() => setExpanding(true), 2000);
          }
        }
      } catch (err) {
        console.warn("[NewsAlert] fetch failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNews();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !news || dismissed) return null;

  const style = SEVERITY_STYLES[news.severity] ?? SEVERITY_STYLES.high;
  const accent = SEVERITY_ACCENT[news.severity] ?? SEVERITY_ACCENT.high;

  return (
    <div
      className={`relative border rounded-lg backdrop-blur-sm overflow-hidden transition-all duration-500 ${style}`}
    >
      {/* Animated urgency bar */}
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
        <div
          className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent"
          style={{ animation: "newsSlide 2s linear infinite" }}
        />
      </div>

      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${accent}`}>
              {news.severity === "critical" ? "⚠ CRITICAL ALERT" : "⚠ NEWS ALERT"}
            </span>
            {news.source === "scrapegraph" && (
              <span className="text-[8px] text-foreground/30 uppercase">
                LIVE
              </span>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-foreground/40 hover:text-foreground text-xs shrink-0 cursor-pointer leading-none"
          >
            ✕
          </button>
        </div>

        <div className="text-xs font-bold leading-snug">
          {news.headline}
        </div>
        <div className="text-[11px] leading-relaxed opacity-80">
          {news.summary}
        </div>

        {news.search_zone_expanded && (
          <div className="flex items-center gap-2 pt-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                expanding ? "bg-amber-400 animate-pulse" : "bg-amber-400/40"
              }`}
            />
            <span className="text-[10px] text-amber-300/90 uppercase tracking-wider font-medium">
              {expanding
                ? "Search zone expansion loading..."
                : "Search zone expansion queued"}
            </span>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes newsSlide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(400%);
          }
        }
      `}</style>
    </div>
  );
}
