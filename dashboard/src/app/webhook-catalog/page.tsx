"use client";

import { useEffect, useState } from "react";
import { fetchWebhookCatalog, type WebhookEventDef } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  payment: "bg-accent/15 text-accent",
  subscription: "bg-success/15 text-success",
  dispute: "bg-danger/15 text-danger",
  payout: "bg-warning/15 text-warning",
  merchant: "bg-muted/15 text-muted",
};

const CATEGORY_ICONS: Record<string, string> = {
  payment: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  subscription: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  dispute: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  payout: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  merchant: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
};

export default function WebhookCatalogPage() {
  const [events, setEvents] = useState<WebhookEventDef[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEventDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWebhookCatalog(selectedCategory ?? undefined)
      .then((data) => {
        setEvents(data.events);
        setCategories(data.categories);
      })
      .catch(() => setError("Failed to load webhook catalog"));
  }, [selectedCategory]);

  const groupedEvents = events.reduce<Record<string, WebhookEventDef[]>>((acc, event) => {
    if (!acc[event.category]) acc[event.category] = [];
    acc[event.category]!.push(event);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Webhook Event Catalog</h1>
        <p className="text-muted text-sm mt-1">
          Complete reference of all webhook event types, payloads, and integration guides
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {categories.map((cat) => {
          const count = events.filter((e) => e.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`bg-card border rounded-xl p-4 text-left transition-colors ${
                selectedCategory === cat ? "border-accent" : "border-card-border hover:border-card-border/70"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={CATEGORY_ICONS[cat] ?? ""} />
                </svg>
                <span className="text-xs text-muted capitalize">{cat}</span>
              </div>
              <p className="text-lg font-bold">{count}</p>
              <p className="text-xs text-muted">events</p>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Event List */}
        <div className="lg:col-span-1 space-y-4">
          {Object.entries(groupedEvents).map(([category, categoryEvents]) => (
            <div key={category} className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={CATEGORY_ICONS[category] ?? ""} />
                </svg>
                <h3 className="font-semibold text-sm capitalize">{category} Events</h3>
                <span className="text-xs text-muted ml-auto">{categoryEvents.length}</span>
              </div>
              <div className="divide-y divide-card-border">
                {categoryEvents.map((event) => (
                  <button
                    key={event.type}
                    onClick={() => setSelectedEvent(event)}
                    className={`w-full text-left px-4 py-3 hover:bg-card-border/30 transition-colors ${
                      selectedEvent?.type === event.type ? "bg-card-border/50" : ""
                    }`}
                  >
                    <p className="text-sm font-mono text-accent">{event.type}</p>
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{event.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Event Detail Panel */}
        <div className="lg:col-span-2">
          {selectedEvent ? (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden sticky top-8">
              <div className="p-6 border-b border-card-border">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xs px-2 py-1 rounded font-medium ${CATEGORY_COLORS[selectedEvent.category] ?? "bg-muted/15 text-muted"}`}>
                    {selectedEvent.category}
                  </span>
                  <code className="text-lg font-mono text-accent">{selectedEvent.type}</code>
                </div>
                <p className="text-sm text-muted">{selectedEvent.description}</p>
              </div>

              {/* Payload Schema */}
              <div className="p-6 border-b border-card-border">
                <h4 className="text-sm font-semibold mb-3">Payload Fields</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted border-b border-card-border">
                        <th className="pb-2 font-medium">Field</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Required</th>
                        <th className="pb-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEvent.payloadFields.map((field) => (
                        <tr key={field.name} className="border-b border-card-border last:border-0">
                          <td className="py-2 font-mono text-accent text-xs">{field.name}</td>
                          <td className="py-2 text-xs text-muted">{field.type}</td>
                          <td className="py-2 text-xs">
                            {field.required ? (
                              <span className="text-success">yes</span>
                            ) : (
                              <span className="text-muted">no</span>
                            )}
                          </td>
                          <td className="py-2 text-xs text-muted">{field.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Example Payload */}
              <div className="p-6 border-b border-card-border">
                <h4 className="text-sm font-semibold mb-3">Example Payload</h4>
                <pre className="bg-background border border-card-border rounded-lg p-4 text-xs overflow-x-auto">
                  {JSON.stringify(
                    {
                      id: "evt_example_123",
                      type: selectedEvent.type,
                      apiVersion: "2024-01-01",
                      createdAt: new Date().toISOString(),
                      data: { object: selectedEvent.example },
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>

              {/* Signature Verification */}
              <div className="p-6 border-b border-card-border">
                <h4 className="text-sm font-semibold mb-3">Signature Verification</h4>
                <p className="text-xs text-muted mb-3">
                  Every webhook delivery includes an HMAC-SHA256 signature in the <code className="text-accent">X-Webhook-Signature</code> header.
                  Verify it against the raw request body using your webhook secret.
                </p>
                <div className="space-y-2 text-xs text-muted">
                  <div>
                    <span className="font-medium text-foreground">Headers:</span>
                  </div>
                  <pre className="bg-background border border-card-border rounded-lg p-3 overflow-x-auto">
{`X-Webhook-Signature: <hmac-sha256-hex>
X-Webhook-Timestamp: <iso-8601>
X-Webhook-ID: <delivery-id>
Content-Type: application/json`}
                  </pre>
                </div>
              </div>

              {/* Code Snippets */}
              <div className="p-6">
                <h4 className="text-sm font-semibold mb-3">Verification Code</h4>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-muted mb-2">Node.js</p>
                    <pre className="bg-background border border-card-border rounded-lg p-3 text-xs overflow-x-auto">
{`const crypto = require('crypto');

function verifyWebhook(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}`}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-2">Python</p>
                    <pre className="bg-background border border-card-border rounded-lg p-3 text-xs overflow-x-auto">
{`import hmac, hashlib

def verify_webhook(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-xl p-12 text-center">
              <svg className="w-12 h-12 text-muted mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p className="text-muted text-sm">Select an event type to view its documentation</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
