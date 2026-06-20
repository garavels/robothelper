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
    "border-red-500/25 bg-red-500/8 text-red-100",
  high: "border-orange-500/25 bg-orange-500/8 text-orange-100",
  moderate:
    "border-amber-500/25 bg-amber-500/8 text-amber-100",
  low: "border-blue-500/25 bg-blue-500/8 text-blue-100",
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
      className={`relative border rounded-2xl overflow-hidden transition-all duration-500 ${style}`}
    >
      {/* Animated urgency bar */}
      <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
        <div
          className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
          style={{ animation: "newsSlide 2s linear infinite" }}
        />
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${accent}`}>
              {news.severity === "critical" ? "Critical Alert" : "News Alert"}
            </span>
            {news.source === "scrapegraph" && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/[0.06] text-[9px] text-zinc-400 uppercase font-medium">
                Live
              </span>
            )}
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-zinc-500 hover:text-zinc-300 text-sm shrink-0 cursor-pointer leading-none transition-colors"
          >
            &times;
          </button>
        </div>

        <div className="text-xs font-semibold leading-snug">
          {news.headline}
        </div>
        <div className="text-[11px] leading-relaxed opacity-80">
          {news.summary}
        </div>

        {news.search_zone_expanded && (
          <div className="flex items-center gap-2 pt-0.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                expanding ? "bg-amber-400" : "bg-amber-400/40"
              }`}
              style={expanding ? { animation: "dot-pulse 1.5s ease-in-out infinite" } : undefined}
            />
            <span className="text-[10px] text-amber-300/90 uppercase tracking-wider font-medium">
              {expanding
                ? "Search zone expansion loading..."
                : "Search zone expansion queued"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
