"use client";

import { useState, useEffect, useCallback } from "react";
import {
  registerWebhook,
  fetchWebhookRegistrations,
  fetchWebhookDeliveries,
  fetchDeadLetterQueue,
  retryDeadLetter,
  type WebhookRegistration,
  type WebhookDeliveryRecord,
  type DeadLetterEntry,
} from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";

type Tab = "registrations" | "deliveries" | "dlq";

const eventOptions = [
  { value: "*", label: "All Events" },
  { value: "payment.completed", label: "payment.completed" },
  { value: "payment.failed", label: "payment.failed" },
];

export default function WebhooksPage() {
  const [activeTab, setActiveTab] = useState<Tab>("registrations");
  const [url, setUrl] = useState("https://httpbin.org/post");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [registrations, setRegistrations] = useState<WebhookRegistration[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [dlqEntries, setDlqEntries] = useState<DeadLetterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const loadRegistrations = useCallback(async () => {
    setTabLoading(true);
    try {
      const data = await fetchWebhookRegistrations();
      setRegistrations(data);
    } catch {
      // Will show empty state
    } finally {
      setTabLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async () => {
    setTabLoading(true);
    try {
      const data = await fetchWebhookDeliveries();
      setDeliveries(data);
    } catch {
      // Will show empty state
    } finally {
      setTabLoading(false);
    }
  }, []);

  const loadDlq = useCallback(async () => {
    setTabLoading(true);
    try {
      const data = await fetchDeadLetterQueue();
      setDlqEntries(data);
    } catch {
      // Will show empty state
    } finally {
      setTabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "registrations") loadRegistrations();
    if (activeTab === "deliveries") loadDeliveries();
    if (activeTab === "dlq") loadDlq();
  }, [activeTab, loadRegistrations, loadDeliveries, loadDlq]);

  function toggleEvent(value: string) {
    if (value === "*") {
      setSelectedEvents(["*"]);
      return;
    }
    const without = selectedEvents.filter((e) => e !== "*" && e !== value);
    if (selectedEvents.includes(value)) {
      setSelectedEvents(without.length ? without : ["*"]);
    } else {
      setSelectedEvents([...without, value]);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await registerWebhook(url, selectedEvents);
      await loadRegistrations();
      setActiveTab("registrations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRetryDlq(id: string) {
    setRetrying((prev) => ({ ...prev, [id]: true }));
    try {
      await retryDeadLetter(id);
      await loadDlq();
    } catch {
      // Retry failure reflected on next load
    } finally {
      setRetrying((prev) => ({ ...prev, [id]: false }));
    }
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "registrations", label: "Registrations", count: registrations.length },
    { key: "deliveries", label: "Deliveries", count: deliveries.length },
    { key: "dlq", label: "Dead Letter Queue", count: dlqEntries.length },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Webhook Management</h2>
        <p className="text-muted text-sm mt-1">
          Register callback URLs to receive payment events with HMAC-SHA256 signatures.
        </p>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold text-sm mb-3">How Webhooks Work</h3>
        <div className="space-y-3 text-sm text-muted">
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <p>Register a URL below. The system will POST payment events to it.</p>
          </div>
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <p>Each delivery includes an <code className="text-foreground bg-background/50 px-1 rounded">X-Webhook-Signature</code> header (HMAC-SHA256).</p>
          </div>
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <p>Failed deliveries retry 3 times with exponential backoff, then go to the dead-letter queue.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleRegister} className="bg-card border border-card-border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted">Register Endpoint</h3>

        <div>
          <label className="block text-xs text-muted mb-1">Callback URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-service.com/webhook"
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-2">Event Types</label>
          <div className="flex flex-wrap gap-2">
            {eventOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleEvent(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedEvents.includes(opt.value)
                    ? "bg-accent/15 border-accent/30 text-accent"
                    : "bg-background border-card-border text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading || !url}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Registering..." : "Register Webhook"}
        </button>
      </form>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="flex border-b border-card-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-accent border-b-2 border-accent bg-accent/5"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-2 text-xs bg-card-border/50 rounded-full px-2 py-0.5">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tabLoading ? (
            <div className="text-center py-8 text-muted animate-pulse">Loading...</div>
          ) : activeTab === "registrations" ? (
            <RegistrationsTab registrations={registrations} />
          ) : activeTab === "deliveries" ? (
            <DeliveriesTab deliveries={deliveries} />
          ) : (
            <DlqTab entries={dlqEntries} retrying={retrying} onRetry={handleRetryDlq} />
          )}
        </div>
      </div>
    </div>
  );
}

function RegistrationsTab({ registrations }: { registrations: WebhookRegistration[] }) {
  if (registrations.length === 0) {
    return <p className="text-sm text-muted text-center py-4">No webhook registrations yet.</p>;
  }

  return (
    <div className="space-y-3">
      {registrations.map((reg) => (
        <div
          key={reg.id}
          className="bg-background/50 border border-card-border/50 rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs text-muted">{reg.id}</span>
            <StatusBadge status={reg.active ? "healthy" : "unhealthy"} />
          </div>
          <p className="text-sm font-mono break-all">{reg.url}</p>
          <div className="flex items-center gap-2 mt-2">
            {reg.events.map((ev) => (
              <span
                key={ev}
                className="text-xs bg-card-border/50 text-muted rounded px-2 py-0.5"
              >
                {ev}
              </span>
            ))}
            <span className="text-xs text-muted ml-auto">
              {new Date(reg.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeliveriesTab({ deliveries }: { deliveries: WebhookDeliveryRecord[] }) {
  if (deliveries.length === 0) {
    return <p className="text-sm text-muted text-center py-4">No webhook deliveries yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-card-border">
            <th className="pb-3 pr-4">Status</th>
            <th className="pb-3 pr-4">Event Type</th>
            <th className="pb-3 pr-4">URL</th>
            <th className="pb-3 pr-4 text-right">Attempts</th>
            <th className="pb-3 pr-4">Error</th>
            <th className="pb-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id} className="border-b border-card-border/50">
              <td className="py-3 pr-4">
                <StatusBadge status={d.status === "delivered" ? "completed" : d.status === "failed" ? "failed" : "pending"} />
              </td>
              <td className="py-3 pr-4 font-mono text-xs">{d.eventType}</td>
              <td className="py-3 pr-4 font-mono text-xs max-w-[200px] truncate">{d.url}</td>
              <td className="py-3 pr-4 text-right">{d.attempts}</td>
              <td className="py-3 pr-4 text-xs text-danger max-w-[200px] truncate">
                {d.lastError ?? "--"}
              </td>
              <td className="py-3 text-xs text-muted">
                {new Date(d.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DlqTab({
  entries,
  retrying,
  onRetry,
}: {
  entries: DeadLetterEntry[];
  retrying: Record<string, boolean>;
  onRetry: (id: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted text-center py-4">Dead letter queue is empty.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-card-border">
            <th className="pb-3 pr-4">ID</th>
            <th className="pb-3 pr-4">Source</th>
            <th className="pb-3 pr-4">Error</th>
            <th className="pb-3 pr-4 text-right">Attempts</th>
            <th className="pb-3 pr-4">Created</th>
            <th className="pb-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-card-border/50">
              <td className="py-3 pr-4 font-mono text-xs">{entry.id.slice(0, 12)}...</td>
              <td className="py-3 pr-4 text-xs">
                <span className="text-muted">{entry.sourceType}:</span>{" "}
                <span className="font-mono">{entry.sourceId.slice(0, 8)}...</span>
              </td>
              <td className="py-3 pr-4 text-xs text-danger max-w-[250px] truncate">{entry.error}</td>
              <td className="py-3 pr-4 text-right">{entry.attempts}</td>
              <td className="py-3 pr-4 text-xs text-muted">
                {new Date(entry.createdAt).toLocaleString()}
              </td>
              <td className="py-3">
                <button
                  onClick={() => onRetry(entry.id)}
                  disabled={retrying[entry.id]}
                  className="px-3 py-1 rounded-md bg-accent/10 border border-accent/30 text-accent text-xs font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
                >
                  {retrying[entry.id] ? "Retrying..." : "Retry"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
