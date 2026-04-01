"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchExperiments,
  createExperiment,
  startExperiment,
  pauseExperiment,
  completeExperiment,
  fetchExperimentResults,
  declareExperimentWinner,
  type ExperimentRecord,
  type ExperimentResultsRecord,
} from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted/20 text-muted",
  running: "bg-success/20 text-success",
  paused: "bg-warning/20 text-warning",
  completed: "bg-accent/20 text-accent",
};

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [selected, setSelected] = useState<ExperimentRecord | null>(null);
  const [results, setResults] = useState<ExperimentResultsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formControlProvider, setFormControlProvider] = useState("stripe");
  const [formControlWeight, setFormControlWeight] = useState(50);
  const [formVariantName, setFormVariantName] = useState("variant_a");
  const [formVariantProvider, setFormVariantProvider] = useState("adyen");
  const [formVariantWeight, setFormVariantWeight] = useState(50);
  const [formTraffic, setFormTraffic] = useState(100);
  const [formSampleSize, setFormSampleSize] = useState(1000);

  const load = useCallback(async () => {
    try {
      const data = await fetchExperiments();
      setExperiments(data.experiments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load experiments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected || selected.status === "draft") {
      setResults(null);
      return;
    }
    fetchExperimentResults(selected.id)
      .then(setResults)
      .catch(() => setResults(null));
  }, [selected]);

  // Poll for running experiments
  useEffect(() => {
    const running = experiments.some((e) => e.status === "running");
    if (!running) return;
    const interval = setInterval(() => {
      load();
      if (selected && selected.status === "running") {
        fetchExperimentResults(selected.id).then(setResults).catch(() => {});
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [experiments, selected, load]);

  async function handleCreate() {
    setError("");
    try {
      await createExperiment({
        name: formName,
        description: formDescription,
        controlProviderId: formControlProvider,
        controlWeight: formControlWeight,
        variants: [{ name: formVariantName, providerId: formVariantProvider, weight: formVariantWeight }],
        trafficAllocation: formTraffic,
        minimumSampleSize: formSampleSize,
      });
      setShowForm(false);
      setFormName("");
      setFormDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create experiment");
    }
  }

  async function handleAction(id: string, action: "start" | "pause" | "complete") {
    setError("");
    try {
      const fn = action === "start" ? startExperiment : action === "pause" ? pauseExperiment : completeExperiment;
      const updated = await fn(id);
      setExperiments((prev) => prev.map((e) => (e.id === id ? updated : e)));
      if (selected?.id === id) setSelected(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action} experiment`);
    }
  }

  async function handleDeclareWinner(id: string, variantName: string) {
    setError("");
    try {
      const updated = await declareExperimentWinner(id, variantName);
      setExperiments((prev) => prev.map((e) => (e.id === id ? updated : e)));
      if (selected?.id === id) setSelected(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to declare winner");
    }
  }

  const activeExps = experiments.filter((e) => e.status === "running" || e.status === "paused");
  const draftExps = experiments.filter((e) => e.status === "draft");
  const completedExps = experiments.filter((e) => e.status === "completed");

  if (loading) {
    return <div className="text-muted animate-pulse">Loading experiments...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Routing Experiments</h1>
          <p className="text-sm text-muted mt-1">A/B test payment providers with statistical significance</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 text-sm font-medium"
        >
          {showForm ? "Cancel" : "New Experiment"}
        </button>
      </div>

      {error && <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">{error}</div>}

      {/* Create Form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold">Create Experiment</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Experiment Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" placeholder="Stripe vs Adyen" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Description</label>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" placeholder="Testing authorization rates" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Control Provider</label>
              <select value={formControlProvider} onChange={(e) => setFormControlProvider(e.target.value)} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm">
                <option value="stripe">Stripe</option>
                <option value="adyen">Adyen</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Control Weight (%)</label>
              <input type="number" value={formControlWeight} onChange={(e) => setFormControlWeight(Number(e.target.value))} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Variant Provider</label>
              <select value={formVariantProvider} onChange={(e) => setFormVariantProvider(e.target.value)} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm">
                <option value="stripe">Stripe</option>
                <option value="adyen">Adyen</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Variant Weight (%)</label>
              <input type="number" value={formVariantWeight} onChange={(e) => setFormVariantWeight(Number(e.target.value))} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Traffic Allocation (%)</label>
              <input type="number" value={formTraffic} onChange={(e) => setFormTraffic(Number(e.target.value))} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" min={1} max={100} />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min Sample Size</label>
              <input type="number" value={formSampleSize} onChange={(e) => setFormSampleSize(Number(e.target.value))} className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={handleCreate} disabled={!formName || !formControlProvider} className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 text-sm font-medium disabled:opacity-50">
            Create Experiment
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Total Experiments</p>
          <p className="text-2xl font-bold mt-1">{experiments.length}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Active</p>
          <p className="text-2xl font-bold mt-1 text-success">{activeExps.length}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Draft</p>
          <p className="text-2xl font-bold mt-1 text-muted">{draftExps.length}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <p className="text-xs text-muted">Completed</p>
          <p className="text-2xl font-bold mt-1 text-accent">{completedExps.length}</p>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Experiment List */}
        <div className="col-span-2 space-y-3">
          {experiments.length === 0 && (
            <div className="text-center py-12 text-muted">No experiments yet. Create one to get started.</div>
          )}
          {experiments.map((exp) => (
            <div
              key={exp.id}
              onClick={() => setSelected(exp)}
              className={`bg-card border rounded-xl p-4 cursor-pointer transition-colors ${
                selected?.id === exp.id ? "border-accent" : "border-card-border hover:border-card-border/80"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{exp.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[exp.status] ?? "bg-muted/20 text-muted"}`}>
                      {exp.status}
                    </span>
                    {exp.winnerVariant && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-success/20 text-success">
                        Winner: {exp.winnerVariant}
                      </span>
                    )}
                  </div>
                  {exp.description && <p className="text-xs text-muted mt-1">{exp.description}</p>}
                </div>
                <div className="text-right text-xs text-muted">
                  <p>{exp.controlProviderId} vs {exp.variants.map((v) => v.providerId).join(", ")}</p>
                  <p>{exp.trafficAllocation}% traffic</p>
                </div>
              </div>

              {/* Variant weights bar */}
              <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-background">
                <div
                  className="bg-accent"
                  style={{ width: `${exp.controlWeight}%` }}
                  title={`Control: ${exp.controlProviderId} (${exp.controlWeight}%)`}
                />
                {exp.variants.map((v, i) => (
                  <div
                    key={i}
                    className={i === 0 ? "bg-warning" : "bg-success"}
                    style={{ width: `${v.weight}%` }}
                    title={`${v.name}: ${v.providerId} (${v.weight}%)`}
                  />
                ))}
              </div>

              {/* Actions */}
              <div className="mt-3 flex gap-2">
                {exp.status === "draft" && (
                  <button onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "start"); }} className="px-3 py-1 bg-success/20 text-success rounded text-xs font-medium hover:bg-success/30">
                    Start
                  </button>
                )}
                {exp.status === "running" && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "pause"); }} className="px-3 py-1 bg-warning/20 text-warning rounded text-xs font-medium hover:bg-warning/30">
                      Pause
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "complete"); }} className="px-3 py-1 bg-accent/20 text-accent rounded text-xs font-medium hover:bg-accent/30">
                      Complete
                    </button>
                  </>
                )}
                {exp.status === "paused" && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "start"); }} className="px-3 py-1 bg-success/20 text-success rounded text-xs font-medium hover:bg-success/30">
                      Resume
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "complete"); }} className="px-3 py-1 bg-accent/20 text-accent rounded text-xs font-medium hover:bg-accent/30">
                      Complete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="col-span-1">
          {selected ? (
            <div className="bg-card border border-card-border rounded-xl p-5 sticky top-8 space-y-5">
              <div>
                <h3 className="font-semibold text-lg">{selected.name}</h3>
                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[selected.status] ?? ""}`}>
                  {selected.status}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Control</span>
                  <span>{selected.controlProviderId} ({selected.controlWeight}%)</span>
                </div>
                {selected.variants.map((v, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted">{v.name}</span>
                    <span>{v.providerId} ({v.weight}%)</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-muted">Traffic</span>
                  <span>{selected.trafficAllocation}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Min Samples</span>
                  <span>{selected.minimumSampleSize}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Confidence</span>
                  <span>{selected.confidenceLevel}%</span>
                </div>
                {selected.startedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted">Started</span>
                    <span className="text-xs">{new Date(selected.startedAt).toLocaleString()}</span>
                  </div>
                )}
                {selected.endedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted">Ended</span>
                    <span className="text-xs">{new Date(selected.endedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Results */}
              {results && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Results</h4>

                  {/* Sample progress */}
                  <div>
                    <div className="flex justify-between text-xs text-muted mb-1">
                      <span>Samples: {results.totalSamples} / {results.requiredSamples}</span>
                      <span>{Math.min(100, Math.round((results.totalSamples / results.requiredSamples) * 100))}%</span>
                    </div>
                    <div className="h-2 bg-background rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${Math.min(100, (results.totalSamples / results.requiredSamples) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Significance indicator */}
                  <div className={`p-3 rounded-lg text-sm ${results.isSignificant ? "bg-success/10 text-success" : "bg-muted/10 text-muted"}`}>
                    {results.isSignificant
                      ? `Significant at ${selected.confidenceLevel}% (X\u00B2 = ${results.chiSquared})`
                      : `Not yet significant (X\u00B2 = ${results.chiSquared}, need ${selected.confidenceLevel}%)`
                    }
                  </div>

                  {/* Per-variant metrics */}
                  {results.variants.map((v) => (
                    <div key={v.name} className="bg-background rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{v.name}</span>
                        <span className="text-xs text-muted">{v.providerId}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted">Auth Rate</p>
                          <p className="font-semibold">{(v.authorizationRate * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-muted">Avg Latency</p>
                          <p className="font-semibold">{v.avgLatencyMs}ms</p>
                        </div>
                        <div>
                          <p className="text-muted">Samples</p>
                          <p className="font-semibold">{v.sampleSize}</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Declare Winner */}
                  {results.isSignificant && !selected.winnerVariant && selected.status !== "completed" && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted font-medium">Declare Winner</p>
                      {results.variants.map((v) => (
                        <button
                          key={v.name}
                          onClick={() => handleDeclareWinner(selected.id, v.name)}
                          className="w-full px-3 py-2 bg-success/20 text-success rounded-lg text-sm font-medium hover:bg-success/30"
                        >
                          Declare {v.name} ({v.providerId})
                        </button>
                      ))}
                    </div>
                  )}

                  {selected.winnerVariant && (
                    <div className="p-3 bg-success/10 rounded-lg text-center">
                      <p className="text-xs text-muted">Winner</p>
                      <p className="font-bold text-success">{selected.winnerVariant}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted text-sm">
              Select an experiment to view details and results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
