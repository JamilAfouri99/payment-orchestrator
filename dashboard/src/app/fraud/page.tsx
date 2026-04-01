"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchFraudRules,
  createFraudRule,
  deleteFraudRule,
  updateFraudRule,
  simulateFraud,
  type FraudRuleRecord,
  type FraudResult,
} from "@/lib/api";

const RULE_TYPES = [
  "velocity_check",
  "amount_threshold",
  "geo_block",
  "device_fingerprint",
  "card_bin_check",
  "customer_history",
  "ip_reputation",
] as const;

const ACTION_STYLES: Record<string, string> = {
  allow: "bg-success/15 text-success border-success/30",
  review: "bg-warning/15 text-warning border-warning/30",
  block: "bg-danger/15 text-danger border-danger/30",
};

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD"];
const REGIONS = ["US", "EU", "GB", "APAC", "CA", "AU"];

const DEFAULT_FORM: Omit<FraudRuleRecord, "id"> = {
  name: "",
  description: "",
  ruleType: "amount_threshold",
  config: {},
  weight: 50,
  enabled: true,
};

export default function FraudPage() {
  const [rules, setRules] = useState<FraudRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<FraudRuleRecord, "id">>(DEFAULT_FORM);
  const [configText, setConfigText] = useState("{}");
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Simulation state
  const [simAmount, setSimAmount] = useState("10000");
  const [simCurrency, setSimCurrency] = useState("USD");
  const [simRegion, setSimRegion] = useState("US");
  const [simPaymentCount, setSimPaymentCount] = useState("0");
  const [simResult, setSimResult] = useState<FraudResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchFraudRules();
      setRules(data.rules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fraud rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function validateConfig(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(configText) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setConfigError("Config must be a JSON object");
        return null;
      }
      setConfigError(null);
      return parsed as Record<string, unknown>;
    } catch {
      setConfigError("Invalid JSON");
      return null;
    }
  }

  async function handleCreate() {
    const config = validateConfig();
    if (!config) return;
    if (!form.name.trim()) {
      setError("Rule name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rule = await createFraudRule({ ...form, config });
      setRules((prev) => [rule, ...prev]);
      setForm(DEFAULT_FORM);
      setConfigText("{}");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteFraudRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(rule: FraudRuleRecord) {
    setTogglingId(rule.id);
    try {
      const updated = await updateFraudRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle rule");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSimulate() {
    const amount = parseInt(simAmount, 10);
    if (!amount || amount <= 0) {
      setSimError("Amount must be a positive number (in cents)");
      return;
    }
    setSimLoading(true);
    setSimError(null);
    setSimResult(null);
    try {
      const result = await simulateFraud({
        amount,
        currency: simCurrency,
        region: simRegion,
        customerPaymentCount: parseInt(simPaymentCount, 10) || 0,
      });
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading fraud rules...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Fraud Rules</h2>
          <p className="text-muted text-sm mt-1">
            Configure the rule engine and simulate fraud scoring
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Rule"}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Create rule form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-5">
          <h3 className="font-semibold">New Fraud Rule</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. High-value transaction check"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Rule Type</label>
              <select
                value={form.ruleType}
                onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe what this rule detects"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">
              Weight: <span className="font-mono text-foreground">{form.weight}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.weight}
              onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))}
              className="w-full h-1.5 bg-card-border rounded-full appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>0 (low)</span>
              <span>100 (critical)</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1.5">
              Config JSON
            </label>
            <textarea
              value={configText}
              onChange={(e) => {
                setConfigText(e.target.value);
                setConfigError(null);
              }}
              rows={4}
              spellCheck={false}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent transition-colors resize-none"
            />
            {configError && (
              <p className="text-xs text-danger mt-1">{configError}</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Creating..." : "Create Rule"}
            </button>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <ToggleSwitch
                enabled={form.enabled}
                onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
              <span className="text-muted">Enabled immediately</span>
            </label>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-card-border">
          <h3 className="font-semibold">Active Rules</h3>
          <p className="text-xs text-muted mt-0.5">{rules.length} rule{rules.length !== 1 ? "s" : ""} configured</p>
        </div>

        {rules.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No fraud rules configured. Add a rule above to get started.
          </div>
        ) : (
          <div className="divide-y divide-card-border/50">
            {rules.map((rule) => (
              <div key={rule.id} className="p-5 flex items-center gap-4">
                <ToggleSwitch
                  enabled={rule.enabled}
                  onChange={() => handleToggle(rule)}
                  disabled={togglingId === rule.id}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm">{rule.name}</span>
                    <span className="px-1.5 py-0.5 bg-accent/10 text-accent text-xs rounded font-mono">
                      {rule.ruleType}
                    </span>
                  </div>
                  {rule.description && (
                    <p className="text-xs text-muted truncate">{rule.description}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted mb-0.5">Weight</p>
                  <p className="font-mono text-sm font-semibold">{rule.weight}</p>
                </div>
                <button
                  onClick={() => handleDelete(rule.id)}
                  disabled={deleting === rule.id}
                  className="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {deleting === rule.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fraud simulator */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold mb-1">Fraud Simulator</h3>
        <p className="text-xs text-muted mb-5">
          Run a transaction through the fraud engine without creating a real payment to see how rules apply.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Amount (cents)</label>
            <input
              type="number"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              min="1"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Currency</label>
            <select
              value={simCurrency}
              onChange={(e) => setSimCurrency(e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Region</label>
            <select
              value={simRegion}
              onChange={(e) => setSimRegion(e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Customer past payments</label>
            <input
              type="number"
              value={simPaymentCount}
              onChange={(e) => setSimPaymentCount(e.target.value)}
              min="0"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>

        <button
          onClick={handleSimulate}
          disabled={simLoading}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {simLoading ? "Evaluating..." : "Run Fraud Check"}
        </button>

        {simError && (
          <p className="text-sm text-danger mt-3">{simError}</p>
        )}

        {simResult && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-5 p-4 bg-background/50 border border-card-border rounded-lg">
              <ScoreGauge score={simResult.score} />
              <div>
                <p className="text-xs text-muted mb-1">Fraud Score</p>
                <p className="text-3xl font-bold font-mono">{simResult.score.toFixed(1)}</p>
                <p className="text-xs text-muted mt-1">
                  Evaluated at {new Date(simResult.evaluatedAt).toLocaleTimeString()}
                </p>
              </div>
              <div className="ml-auto">
                <p className="text-xs text-muted mb-1.5">Action</p>
                <ActionBadge action={simResult.action} />
              </div>
            </div>

            {simResult.ruleResults.length > 0 && (
              <div>
                <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
                  Rule Breakdown
                </h4>
                <div className="space-y-2">
                  {simResult.ruleResults.map((r) => (
                    <div
                      key={r.ruleId}
                      className={`p-3 rounded-lg border ${
                        r.triggered
                          ? "bg-danger/5 border-danger/20"
                          : "bg-card-border/10 border-card-border/30"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            r.triggered ? "bg-danger" : "bg-success"
                          }`}
                        />
                        <span className="text-sm font-medium flex-1">{r.ruleName}</span>
                        <span className="px-1.5 py-0.5 bg-card-border/50 text-xs rounded font-mono text-muted">
                          {r.ruleType}
                        </span>
                        <span
                          className={`font-mono text-sm font-semibold ${
                            r.triggered ? "text-danger" : "text-muted"
                          }`}
                        >
                          +{r.score.toFixed(1)}
                        </span>
                      </div>
                      {r.detail && (
                        <p className="text-xs text-muted mt-1.5 pl-5">{r.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled = false,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
        enabled ? "bg-accent" : "bg-card-border"
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ScoreGauge({ score }: { score: number }) {
  // Score 0–100; clamp to display range
  const clamped = Math.min(Math.max(score, 0), 100);
  const color =
    clamped >= 70 ? "text-danger" : clamped >= 40 ? "text-warning" : "text-success";

  return (
    <div className={`relative w-16 h-16 shrink-0`}>
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
          strokeDasharray={`${(clamped / 100) * 94.25} 94.25`}
          strokeLinecap="round"
          className={color}
          stroke="currentColor"
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${color}`}>
        {clamped.toFixed(0)}
      </div>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const style =
    ACTION_STYLES[action.toLowerCase()] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${style}`}
    >
      {action.toUpperCase()}
    </span>
  );
}
