"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchLogs, type LogEntry } from "@/lib/api";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const levelStyles: Record<string, string> = {
  debug: "bg-muted/15 text-muted border-muted/30",
  info: "bg-accent/15 text-accent border-accent/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  error: "bg-danger/15 text-danger border-danger/30",
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await fetchLogs(200);
      setLogs(data.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  function toggleLevel(level: LogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  function toggleExpand(index: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  const searchLower = search.toLowerCase();
  const filtered = logs.filter((log) => {
    if (!activeLevels.has(log.level as LogLevel)) return false;
    if (search && !log.message.toLowerCase().includes(searchLower)) {
      const fullText = JSON.stringify(log).toLowerCase();
      if (!fullText.includes(searchLower)) return false;
    }
    return true;
  });

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading logs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">System Logs</h2>
          <p className="text-muted text-sm mt-1">
            Live log stream, auto-refreshing every 3 seconds
          </p>
        </div>
        <div className="text-xs text-muted">
          {filtered.length} of {logs.length} entries shown
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-2">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeLevels.has(level)
                  ? levelStyles[level]
                  : "bg-background border-card-border text-muted/40"
              }`}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs..."
            className="w-full bg-background border border-card-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No log entries match the current filters.
          </div>
        ) : (
          <div className="divide-y divide-card-border/50 max-h-[70vh] overflow-y-auto">
            {filtered.map((log, i) => {
              const expanded = expandedIds.has(i);
              const extraKeys = Object.keys(log).filter(
                (k) => !["timestamp", "level", "message"].includes(k),
              );
              const hasExtra = extraKeys.length > 0;

              return (
                <div
                  key={i}
                  className={`px-5 py-3 hover:bg-card-border/10 transition-colors ${
                    hasExtra ? "cursor-pointer" : ""
                  }`}
                  onClick={() => hasExtra && toggleExpand(i)}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-muted font-mono whitespace-nowrap shrink-0 pt-0.5">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${
                        levelStyles[log.level] ?? levelStyles["info"]
                      }`}
                    >
                      {log.level.toUpperCase().padEnd(5)}
                    </span>
                    <span className="text-sm flex-1 break-words">{log.message}</span>
                    {hasExtra && (
                      <svg
                        className={`w-4 h-4 text-muted shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                  {expanded && hasExtra && (
                    <div className="mt-2 ml-[140px] bg-background/50 rounded-lg p-3 font-mono text-xs space-y-0.5">
                      {extraKeys.map((k) => (
                        <div key={k}>
                          <span className="text-muted">{k}:</span>{" "}
                          <span className="text-foreground">
                            {typeof log[k] === "object"
                              ? JSON.stringify(log[k], null, 2)
                              : String(log[k])}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString() + "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch {
    return ts;
  }
}
