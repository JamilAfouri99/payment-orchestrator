"use client";

import { useState } from "react";
import { registerWebhook, type WebhookRegistration } from "@/lib/api";

const eventOptions = [
  { value: "*", label: "All Events" },
  { value: "payment.completed", label: "payment.completed" },
  { value: "payment.failed", label: "payment.failed" },
];

export default function WebhooksPage() {
  const [url, setUrl] = useState("https://httpbin.org/post");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [registrations, setRegistrations] = useState<WebhookRegistration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const reg = await registerWebhook(url, selectedEvents);
      setRegistrations((prev) => [reg, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Webhook Management</h2>
        <p className="text-muted text-sm mt-1">
          Register callback URLs to receive payment events with HMAC-SHA256 signatures.
        </p>
      </div>

      {/* How it works */}
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

      {/* Registration Form */}
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

      {/* Registered Webhooks */}
      {registrations.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted mb-4">
            Registered Webhooks ({registrations.length})
          </h3>
          <div className="space-y-3">
            {registrations.map((reg) => (
              <div
                key={reg.id}
                className="bg-background/50 border border-card-border/50 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-muted">{reg.id}</span>
                  <span className="text-xs bg-success/15 text-success border border-success/30 rounded-full px-2 py-0.5">active</span>
                </div>
                <p className="text-sm font-mono break-all">{reg.url}</p>
                <div className="flex gap-2 mt-2">
                  {reg.events.map((ev) => (
                    <span
                      key={ev}
                      className="text-xs bg-card-border/50 text-muted rounded px-2 py-0.5"
                    >
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
