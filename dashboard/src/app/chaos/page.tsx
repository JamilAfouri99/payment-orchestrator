"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchChaosConfig,
  updateChaosConfig,
  resetChaos,
  type ServiceChaosConfig,
} from "@/lib/api";

const SERVICE_NAMES = ["payment-provider", "inventory-service", "notification-service"];

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "payment-provider": "Simulates payment gateway failures and latency. High failure rates trigger charge failures and saga compensation.",
  "inventory-service": "Simulates inventory system outages. Failures trigger inventory reservation rollback in the saga.",
  "notification-service": "Simulates notification delivery issues. Non-critical step -- failures are logged but do not trigger compensation.",
};

export default function ChaosPage() {
  const [services, setServices] = useState<Record<string, ServiceChaosConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchChaosConfig();
      setServices(data.services);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chaos config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateLocal(service: string, field: keyof ServiceChaosConfig, value: number | boolean) {
    setServices((prev) => ({
      ...prev,
      [service]: { ...prev[service]!, [field]: value },
    }));
  }

  async function handleSave(service: string) {
    const config = services[service];
    if (!config) return;
    setSaving((prev) => ({ ...prev, [service]: true }));
    try {
      const data = await updateChaosConfig({
        service,
        failureRate: config.failureRate,
        latencyMs: config.latencyMs,
        enabled: config.enabled,
      });
      setServices(data.services);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving((prev) => ({ ...prev, [service]: false }));
    }
  }

  async function handleResetAll() {
    setResetting(true);
    try {
      await resetChaos();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading chaos configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Chaos Engineering</h2>
          <p className="text-muted text-sm mt-1">
            Inject failures and latency to test system resilience
          </p>
        </div>
        <button
          onClick={handleResetAll}
          disabled={resetting}
          className="px-4 py-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {resetting ? "Resetting..." : "Reset All"}
        </button>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-accent mb-2">How to Demo Compensation Flows</h3>
        <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
          <li>Enable chaos on <strong className="text-foreground">payment-provider</strong> with a 100% failure rate.</li>
          <li>Create a payment via the Dashboard or New Payment page.</li>
          <li>The saga will fail at the "Charge Payment" step and automatically compensate by releasing inventory.</li>
          <li>View the payment detail page to see the full compensation event timeline.</li>
          <li>Try enabling chaos on <strong className="text-foreground">inventory-service</strong> instead to see failure at the reservation step.</li>
        </ol>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {SERVICE_NAMES.map((name) => {
          const config = services[name];
          if (!config) return null;
          const isSaving = saving[name] ?? false;

          return (
            <div key={name} className="bg-card border border-card-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{name}</h3>
                  <p className="text-xs text-muted mt-1">{SERVICE_DESCRIPTIONS[name]}</p>
                </div>
                <ToggleSwitch
                  enabled={config.enabled}
                  onChange={(val) => updateLocal(name, "enabled", val)}
                />
              </div>

              <div className="space-y-5">
                <SliderControl
                  label="Failure Rate"
                  value={config.failureRate}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={(val) => updateLocal(name, "failureRate", val)}
                  disabled={!config.enabled}
                  color={config.failureRate > 60 ? "danger" : config.failureRate > 30 ? "warning" : "accent"}
                />
                <SliderControl
                  label="Extra Latency"
                  value={config.latencyMs}
                  min={0}
                  max={5000}
                  step={100}
                  unit="ms"
                  onChange={(val) => updateLocal(name, "latencyMs", val)}
                  disabled={!config.enabled}
                  color={config.latencyMs > 3000 ? "danger" : config.latencyMs > 1000 ? "warning" : "accent"}
                />
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={() => handleSave(name)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                {!config.enabled && (
                  <span className="text-xs text-muted">Chaos disabled for this service</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-12 h-6 rounded-full transition-colors ${
        enabled ? "bg-accent" : "bg-card-border"
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
  color,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (val: number) => void;
  disabled: boolean;
  color: "accent" | "warning" | "danger";
}) {
  const colorClasses = {
    accent: "accent-blue-500",
    warning: "accent-yellow-500",
    danger: "accent-red-500",
  };

  return (
    <div className={disabled ? "opacity-40" : ""}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm text-muted">{label}</label>
        <span className="text-sm font-mono font-medium">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={`w-full h-1.5 bg-card-border rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed ${colorClasses[color]}`}
      />
      <div className="flex justify-between text-xs text-muted mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
