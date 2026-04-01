"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchDunningConfig,
  updateDunningConfig,
  fetchActiveDunningFlows,
  processDunningRetries,
  fetchRetryAnalytics,
  type DunningConfigRecord,
  type DunningFlowRecord,
  type RetryAnalyticsRecord,
} from "@/lib/api";

type Tab = "flows" | "analytics" | "config";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-warning/15 text-warning border-warning/30",
  recovered: "bg-success/15 text-success border-success/30",
  exhausted: "bg-danger/15 text-danger border-danger/30",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function DunningPage() {
  const [activeTab, setActiveTab] = useState<Tab>("flows");
  const [flows, setFlows] = useState<DunningFlowRecord[]>([]);
  const [analytics, setAnalytics] = useState<RetryAnalyticsRecord | null>(null);
  const [config, setConfig] = useState<DunningConfigRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flowsData, analyticsData, configData] = await Promise.all([
        fetchActiveDunningFlows(),
        fetchRetryAnalytics(),
        fetchDunningConfig(),
      ]);
      setFlows(flowsData);
      setAnalytics(analyticsData);
      setConfig(configData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dunning data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading dunning data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Dunning &amp; Smart Retry</h2>
        <p className="text-muted text-sm mt-1">Payment Recovery Management</p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {analytics && <RecoveryHeroCard analytics={analytics} />}

      <div>
        <TabBar activeTab={activeTab} onChange={setActiveTab} />

        <div className="mt-6">
          {activeTab === "flows" && (
            <ActiveFlowsTab
              flows={flows}
              onRetryProcessed={(updated) => {
                setFlows(updated.flows);
                setAnalytics(updated.analytics);
              }}
              onError={setError}
            />
          )}
          {activeTab === "analytics" && analytics && (
            <AnalyticsTab analytics={analytics} />
          )}
          {activeTab === "config" && config && (
            <ConfigurationTab
              config={config}
              onSaved={setConfig}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Recovery Hero Card ────────────────────────────────────────────────────────

function RecoveryHeroCard({ analytics }: { analytics: RetryAnalyticsRecord }) {
  const ratePercent = (analytics.recoveryRate * 100).toFixed(1);
  const rateColor =
    analytics.recoveryRate >= 0.7
      ? "text-success"
      : analytics.recoveryRate >= 0.4
        ? "text-warning"
        : "text-danger";

  return (
    <div className="bg-card border border-card-border rounded-xl p-6">
      <div className="flex items-center gap-8">
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">
            Recovery Rate
          </p>
          <p className={`text-6xl font-bold font-mono ${rateColor}`}>
            {ratePercent}%
          </p>
        </div>
        <div className="h-16 w-px bg-card-border" />
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted mb-0.5">Recovered</p>
            <p className="text-2xl font-semibold font-mono text-success">
              {analytics.totalRecovered.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted mb-0.5">Total Attempts</p>
            <p className="text-2xl font-semibold font-mono">
              {analytics.totalAttempts.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="ml-auto">
          <RecoveryArc rate={analytics.recoveryRate} />
        </div>
      </div>
    </div>
  );
}

function RecoveryArc({ rate }: { rate: number }) {
  const clamped = Math.min(Math.max(rate, 0), 1);
  const circumference = 94.25;
  const filled = clamped * circumference;
  const color =
    clamped >= 0.7 ? "text-success" : clamped >= 0.4 ? "text-warning" : "text-danger";

  return (
    <div className="relative w-24 h-24">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-card-border"
        />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          className={color}
          stroke="currentColor"
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${color}`}
      >
        {(clamped * 100).toFixed(0)}%
      </div>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "flows", label: "Active Flows" },
    { id: "analytics", label: "Analytics" },
    { id: "config", label: "Configuration" },
  ];

  return (
    <div className="flex gap-1 bg-card border border-card-border rounded-lg p-1 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Active Flows Tab ─────────────────────────────────────────────────────────

function ActiveFlowsTab({
  flows,
  onRetryProcessed,
  onError,
}: {
  flows: DunningFlowRecord[];
  onRetryProcessed: (data: {
    flows: DunningFlowRecord[];
    analytics: RetryAnalyticsRecord;
  }) => void;
  onError: (msg: string) => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [retryResult, setRetryResult] = useState<{
    processed: number;
    recovered: number;
    failed: number;
  } | null>(null);

  async function handleProcessRetries() {
    setProcessing(true);
    setRetryResult(null);
    try {
      const result = await processDunningRetries();
      setRetryResult(result);
      // Refresh flows and analytics after processing
      const [newFlows, newAnalytics] = await Promise.all([
        fetchActiveDunningFlows(),
        fetchRetryAnalytics(),
      ]);
      onRetryProcessed({ flows: newFlows, analytics: newAnalytics });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to process retries");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {flows.length} active flow{flows.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={handleProcessRetries}
          disabled={processing}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? "Processing..." : "Process Retries"}
        </button>
      </div>

      {retryResult && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4">
          <p className="text-sm font-medium text-success mb-1">Retry run complete</p>
          <div className="flex gap-6 text-sm">
            <span className="text-muted">
              Processed: <span className="text-foreground font-mono">{retryResult.processed}</span>
            </span>
            <span className="text-muted">
              Recovered: <span className="text-success font-mono">{retryResult.recovered}</span>
            </span>
            <span className="text-muted">
              Failed: <span className="text-danger font-mono">{retryResult.failed}</span>
            </span>
          </div>
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
              <th className="px-5 py-3">Invoice ID</th>
              <th className="px-5 py-3">Subscription</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3 text-center">Attempts</th>
              <th className="px-5 py-3">Next Retry</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {flows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-12 text-center text-muted"
                >
                  No active dunning flows. All invoices are in good standing.
                </td>
              </tr>
            ) : (
              flows.map((flow) => (
                <tr
                  key={flow.invoiceId}
                  className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs text-accent">
                    {flow.invoiceId.slice(0, 12)}...
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {flow.subscriptionId.slice(0, 10)}...
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{flow.customerId}</td>
                  <td className="px-5 py-3 text-right font-mono">
                    {formatDollars(flow.invoiceTotal)}
                    <span className="text-muted text-xs ml-1">{flow.currency}</span>
                  </td>
                  <td className="px-5 py-3 text-center font-mono text-xs">
                    <span className={flow.attemptCount >= flow.maxAttempts ? "text-danger" : "text-foreground"}>
                      {flow.attemptCount}
                    </span>
                    <span className="text-muted">/{flow.maxAttempts}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {flow.nextRetryAt ? formatDate(flow.nextRetryAt) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={flow.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status.toLowerCase()] ??
    "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {status}
    </span>
  );
}

// ─── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ analytics }: { analytics: RetryAnalyticsRecord }) {
  const maxHourRate = Math.max(
    ...analytics.byHourOfDay.map((h) => h.rate),
    0.001,
  );
  const maxDayRate = Math.max(
    ...analytics.byDayOfWeek.map((d) => d.rate),
    0.001,
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold mb-1">By Hour of Day</h3>
        <p className="text-xs text-muted mb-5">Success rate for each hour (UTC)</p>
        <div className="space-y-1.5">
          {analytics.byHourOfDay.map((item) => (
            <HourBar
              key={item.hour}
              label={`${String(item.hour).padStart(2, "0")}:00`}
              rate={item.rate}
              maxRate={maxHourRate}
              attempts={item.attempts}
            />
          ))}
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold mb-1">By Day of Week</h3>
        <p className="text-xs text-muted mb-5">Success rate per day</p>
        <div className="space-y-3">
          {analytics.byDayOfWeek.map((item) => (
            <DayBar
              key={item.day}
              label={item.dayName ?? DAY_NAMES[item.day] ?? String(item.day)}
              rate={item.rate}
              maxRate={maxDayRate}
              attempts={item.attempts}
              successes={item.successes}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HourBar({
  label,
  rate,
  maxRate,
  attempts,
}: {
  label: string;
  rate: number;
  maxRate: number;
  attempts: number;
}) {
  const widthPercent = maxRate > 0 ? (rate / maxRate) * 100 : 0;
  const rateColor =
    rate >= 0.7 ? "bg-success" : rate >= 0.4 ? "bg-warning" : "bg-danger";

  return (
    <div className="flex items-center gap-3 group">
      <span className="text-xs font-mono text-muted w-12 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-card-border/30 rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all ${rateColor}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted w-10 text-right shrink-0">
        {attempts > 0 ? `${(rate * 100).toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}

function DayBar({
  label,
  rate,
  maxRate,
  attempts,
  successes,
}: {
  label: string;
  rate: number;
  maxRate: number;
  attempts: number;
  successes: number;
}) {
  const widthPercent = maxRate > 0 ? (rate / maxRate) * 100 : 0;
  const rateColor =
    rate >= 0.7 ? "bg-success" : rate >= 0.4 ? "bg-warning" : "bg-danger";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-muted font-mono">
          {successes}/{attempts} &mdash; {attempts > 0 ? `${(rate * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="h-5 bg-card-border/30 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${rateColor}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Configuration Tab ─────────────────────────────────────────────────────────

function ConfigurationTab({
  config,
  onSaved,
  onError,
}: {
  config: DunningConfigRecord;
  onSaved: (config: DunningConfigRecord) => void;
  onError: (msg: string) => void;
}) {
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(
    String(config.maxRetryAttempts),
  );
  const [retrySchedule, setRetrySchedule] = useState(
    config.retryScheduleDays.join(","),
  );
  const [onFirstFailure, setOnFirstFailure] = useState(config.onFirstFailure);
  const [onEachRetry, setOnEachRetry] = useState(config.onEachRetry);
  const [onFinalFailure, setOnFinalFailure] = useState(config.onFinalFailure);
  const [gracePeriodDays, setGracePeriodDays] = useState(
    String(config.gracePeriodDays),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  function parseSchedule(): number[] | null {
    const parts = retrySchedule
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
    return nums;
  }

  async function handleSave() {
    const maxAttempts = parseInt(maxRetryAttempts, 10);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      setSaveError("Max retry attempts must be a positive integer");
      return;
    }
    const schedule = parseSchedule();
    if (!schedule || schedule.length === 0) {
      setSaveError("Retry schedule must be comma-separated positive integers (e.g. 1,3,5,7)");
      return;
    }
    const grace = parseInt(gracePeriodDays, 10);
    if (!Number.isInteger(grace) || grace < 0) {
      setSaveError("Grace period must be a non-negative integer");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const updated = await updateDunningConfig({
        maxRetryAttempts: maxAttempts,
        retryScheduleDays: schedule,
        onFirstFailure,
        onEachRetry,
        onFinalFailure,
        gracePeriodDays: grace,
      });
      onSaved(updated);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save config";
      setSaveError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-6 max-w-2xl space-y-6">
      <div>
        <h3 className="font-semibold">Dunning Configuration</h3>
        <p className="text-xs text-muted mt-0.5">
          Controls how the system retries failed invoice payments.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs text-muted mb-1.5">
            Max Retry Attempts
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={maxRetryAttempts}
            onChange={(e) => setMaxRetryAttempts(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1.5">
            Grace Period Days
          </label>
          <input
            type="number"
            min={0}
            max={90}
            value={gracePeriodDays}
            onChange={(e) => setGracePeriodDays(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1.5">
          Retry Schedule (days after failure, comma-separated)
        </label>
        <input
          type="text"
          value={retrySchedule}
          onChange={(e) => setRetrySchedule(e.target.value)}
          placeholder="e.g. 1,3,5,7"
          className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
        />
        <p className="text-xs text-muted mt-1">
          Example: 1,3,5,7 retries on day 1, 3, 5, and 7 after initial failure.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div>
          <label className="block text-xs text-muted mb-1.5">
            On First Failure
          </label>
          <select
            value={onFirstFailure}
            onChange={(e) => setOnFirstFailure(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          >
            <option value="email_customer">Email Customer</option>
            <option value="none">None</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1.5">On Each Retry</label>
          <select
            value={onEachRetry}
            onChange={(e) => setOnEachRetry(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          >
            <option value="email_customer">Email Customer</option>
            <option value="none">None</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1.5">
            On Final Failure
          </label>
          <select
            value={onFinalFailure}
            onChange={(e) => setOnFinalFailure(e.target.value)}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          >
            <option value="cancel_subscription">Cancel Subscription</option>
            <option value="pause_subscription">Pause Subscription</option>
            <option value="mark_unpaid">Mark Unpaid</option>
          </select>
        </div>
      </div>

      {saveError && (
        <p className="text-sm text-danger">{saveError}</p>
      )}

      {savedOk && (
        <p className="text-sm text-success">Configuration saved.</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving..." : "Save Configuration"}
      </button>
    </div>
  );
}
