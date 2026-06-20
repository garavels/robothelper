"use client";

import { useEffect, useState, useCallback } from "react";

interface NewsItem {
  title: string;
  source?: string;
  summary?: string;
}

interface NewsResponse {
  items: NewsItem[];
  fetched_via?: string;
  source_url?: string;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function NewsFeed() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [via, setVia] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const resp = await fetch(`${BACKEND_URL}/api/news`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: NewsResponse = await resp.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setVia(data.fetched_via ?? "");
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  // Fetch once when the box appears (i.e. once you're awake).
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-panel overflow-hidden max-h-72 shrink-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs uppercase tracking-widest text-accent">
          📰 Today&apos;s News
        </span>
        <div className="flex items-center gap-2">
          {via === "fallback" && (
            <span className="text-[9px] uppercase tracking-wider text-amber-400/80">
              sample
            </span>
          )}
          {via === "scrapegraph" && (
            <span className="text-[9px] uppercase tracking-wider text-emerald-400/70">
              ScrapeGraph
            </span>
          )}
          <button
            onClick={load}
            className="text-xs text-foreground/40 hover:text-accent cursor-pointer"
            title="Refresh news"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
        {status === "loading" && (
          <div className="text-[11px] text-foreground/40 px-2 py-3 text-center animate-pulse">
            Fetching today&apos;s news via ScrapeGraph…
          </div>
        )}
        {status === "error" && (
          <div className="text-[11px] text-red-400/80 px-2 py-3 text-center">
            Couldn&apos;t load news — is the backend running?
          </div>
        )}
        {status === "ready" && items.length === 0 && (
          <div className="text-[11px] text-foreground/40 px-2 py-3 text-center">
            No news items returned.
          </div>
        )}
        {status === "ready" &&
          items.map((it, i) => (
            <div
              key={i}
              className="px-2.5 py-2 rounded border border-white/5 hover:border-accent/30 transition-colors"
            >
              <div className="text-[12px] text-foreground/90 leading-snug">
                {it.title}
              </div>
              {(it.source || it.summary) && (
                <div className="mt-0.5 text-[10px] text-foreground/45 leading-snug">
                  {it.source && (
                    <span className="text-accent/70">{it.source}</span>
                  )}
                  {it.source && it.summary ? " — " : null}
                  {it.summary}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
