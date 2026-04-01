"use client";

import { resetCircuitBreaker, type CircuitBreakerInfo } from "@/lib/api";
import { useState } from "react";

const stateStyles: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  closed: { bg: "bg-success/10", text: "text-success", border: "border-success/30", dot: "bg-success" },
  open: { bg: "bg-danger/10", text: "text-danger", border: "border-danger/30", dot: "bg-danger" },
  "half-open": { bg: "bg-warning/10", text: "text-warning", border: "border-warning/30", dot: "bg-warning" },
};

export function CircuitBreakerCard({
  breaker,
  onReset,
}: {
  breaker: CircuitBreakerInfo;
  onReset: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const style = stateStyles[breaker.state] ?? stateStyles["closed"]!;

  async function handleReset() {
    setResetting(true);
    try {
      await resetCircuitBreaker(breaker.name);
      onReset();
    } catch {
      // Reset will be reflected on next poll
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${style.text}`}>
            {breaker.state}
          </span>
        </div>
        {breaker.state !== "closed" && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="text-xs px-2.5 py-1 rounded-md bg-background/50 border border-card-border text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {resetting ? "Resetting..." : "Reset"}
          </button>
        )}
      </div>
      <p className="text-sm font-semibold">{breaker.name}</p>
      <p className="text-xs text-muted mt-1">
        {breaker.state === "closed" && "Circuit is healthy, all requests flowing through."}
        {breaker.state === "open" && "Circuit is tripped, requests are being rejected."}
        {breaker.state === "half-open" && "Circuit is testing, limited requests allowed."}
      </p>
    </div>
  );
}
