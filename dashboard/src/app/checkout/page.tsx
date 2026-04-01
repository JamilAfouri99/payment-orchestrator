"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createCheckoutSession,
  fetchCheckoutSessions,
  expireCheckoutSession,
  fetchCheckoutAnalytics,
  fetchSupportedPaymentMethods,
  type CheckoutSessionRecord,
  type ConversionStatsRecord,
  type PaymentMethodCapabilityRecord,
} from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-accent/15 text-accent",
  complete: "bg-success/15 text-success",
  expired: "bg-muted/15 text-muted",
};

const METHOD_LABELS: Record<string, string> = {
  card: "Card",
  bank_transfer: "Bank Transfer",
  wallet: "Wallet",
  bnpl: "Buy Now Pay Later",
  crypto: "Crypto",
};

export default function CheckoutPage() {
  const [sessions, setSessions] = useState<CheckoutSessionRecord[]>([]);
  const [stats, setStats] = useState<ConversionStatsRecord | null>(null);
  const [supportedMethods, setSupportedMethods] = useState<PaymentMethodCapabilityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form state
  const [amount, setAmount] = useState("50.00");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("Test checkout session");
  const [selectedMethods, setSelectedMethods] = useState<string[]>(["card"]);
  const [customerEmail, setCustomerEmail] = useState("customer@example.com");
  const [customerName, setCustomerName] = useState("Test Customer");
  const [successUrl, setSuccessUrl] = useState("/checkout?status=success");
  const [cancelUrl, setCancelUrl] = useState("/checkout?status=canceled");
  const [creating, setCreating] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CheckoutSessionRecord | null>(null);

  // Line items
  const [lineItemName, setLineItemName] = useState("Premium Widget");
  const [lineItemQty, setLineItemQty] = useState("1");
  const [lineItemPrice, setLineItemPrice] = useState("50.00");

  const loadData = useCallback(async () => {
    try {
      const [sessionsRes, statsRes, methodsRes] = await Promise.all([
        fetchCheckoutSessions({ limit: 50 }),
        fetchCheckoutAnalytics(),
        fetchSupportedPaymentMethods(currency),
      ]);
      setSessions(sessionsRes.sessions);
      setStats(statsRes);
      setSupportedMethods(methodsRes.methods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const amountCents = Math.round(parseFloat(amount) * 100);
      const itemPriceCents = Math.round(parseFloat(lineItemPrice) * 100);
      const qty = parseInt(lineItemQty, 10);

      const session = await createCheckoutSession({
        amount: amountCents,
        currency,
        description,
        allowedPaymentMethods: selectedMethods,
        customer: { email: customerEmail, name: customerName },
        successUrl,
        cancelUrl,
        lineItems: [{ name: lineItemName, quantity: qty, unitPrice: itemPriceCents }],
      });
      setSessions((prev) => [session, ...prev]);
      setSelectedSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const handleExpire = async (id: string) => {
    try {
      await expireCheckoutSession(id);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to expire session");
    }
  };

  const toggleMethod = (method: string) => {
    setSelectedMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method],
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-muted animate-pulse">Loading checkout data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="text-muted text-sm mt-1">
          Create and manage embeddable checkout sessions
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 text-danger text-sm">{error}</div>
      )}

      {/* Conversion Analytics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wider">Total Sessions</p>
            <p className="text-2xl font-bold mt-1">{stats.totalSessions}</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wider">Conversion Rate</p>
            <p className="text-2xl font-bold mt-1 text-success">{stats.conversionRate}%</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-bold mt-1 text-accent">{stats.completedSessions}</p>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-4">
            <p className="text-xs text-muted uppercase tracking-wider">Avg Time</p>
            <p className="text-2xl font-bold mt-1">
              {stats.avgCompletionTimeMs > 0 ? `${Math.round(stats.avgCompletionTimeMs / 1000)}s` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Payment Method Breakdown */}
      {stats && Object.keys(stats.byPaymentMethod).length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-3">Conversion by Payment Method</h3>
          <div className="space-y-2">
            {Object.entries(stats.byPaymentMethod).map(([method, data]) => (
              <div key={method} className="flex items-center gap-3">
                <span className="text-sm text-muted w-28">{METHOD_LABELS[method] ?? method}</span>
                <div className="flex-1 h-5 bg-card-border/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${data.percentage}%` }}
                  />
                </div>
                <span className="text-sm font-mono w-16 text-right">{data.count} ({data.percentage}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Session Form */}
        <div className="bg-card border border-card-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Create Session</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted">Amount</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
                  placeholder="50.00"
                />
              </div>
              <div>
                <label className="text-xs text-muted">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted">Customer Email</label>
              <input
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted">Customer Name</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>

            {/* Line Item */}
            <div className="border border-card-border rounded-lg p-3 space-y-2">
              <p className="text-xs text-muted font-semibold">Line Item</p>
              <input
                value={lineItemName}
                onChange={(e) => setLineItemName(e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-background border border-card-border text-sm"
                placeholder="Item name"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={lineItemQty}
                  onChange={(e) => setLineItemQty(e.target.value)}
                  className="px-3 py-1.5 rounded bg-background border border-card-border text-sm"
                  placeholder="Qty"
                  type="number"
                />
                <input
                  value={lineItemPrice}
                  onChange={(e) => setLineItemPrice(e.target.value)}
                  className="px-3 py-1.5 rounded bg-background border border-card-border text-sm"
                  placeholder="Price"
                />
              </div>
            </div>

            {/* Payment Methods */}
            <div>
              <label className="text-xs text-muted">Allowed Methods</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {["card", "bank_transfer", "wallet", "bnpl", "crypto"].map((m) => (
                  <button
                    key={m}
                    onClick={() => toggleMethod(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedMethods.includes(m)
                        ? "bg-accent/15 text-accent border-accent/30"
                        : "bg-background border-card-border text-muted"
                    }`}
                  >
                    {METHOD_LABELS[m] ?? m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted">Success URL</label>
              <input
                value={successUrl}
                onChange={(e) => setSuccessUrl(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted">Cancel URL</label>
              <input
                value={cancelUrl}
                onChange={(e) => setCancelUrl(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create Checkout Session"}
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">Sessions ({sessions.length})</h2>

          {sessions.length === 0 ? (
            <div className="bg-card border border-card-border rounded-lg p-8 text-center text-muted text-sm">
              No checkout sessions yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => setSelectedSession(session)}
                  className={`bg-card border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedSession?.id === session.id ? "border-accent" : "border-card-border hover:border-card-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[session.status] ?? "bg-muted/15 text-muted"}`}>
                        {session.status}
                      </span>
                      <span className="font-mono text-sm">
                        {(session.amount / 100).toFixed(2)} {session.currency}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.status === "open" && (
                        <>
                          <a
                            href={`/checkout/${session.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="px-2 py-1 rounded text-xs bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                          >
                            Open
                          </a>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExpire(session.id); }}
                            className="px-2 py-1 rounded text-xs bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
                          >
                            Expire
                          </button>
                        </>
                      )}
                      <span className="text-xs text-muted font-mono">{session.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted">
                    <span>{session.description || "No description"}</span>
                    <span>{session.allowedPaymentMethods.map((m) => METHOD_LABELS[m] ?? m).join(", ")}</span>
                    {session.paymentMethodType && <span>Paid via {session.paymentMethodType}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Session Detail */}
          {selectedSession && (
            <div className="bg-card border border-card-border rounded-lg p-6">
              <h3 className="text-sm font-semibold mb-3">Session Detail</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted">ID:</span>
                  <span className="ml-2 font-mono text-xs">{selectedSession.id}</span>
                </div>
                <div>
                  <span className="text-muted">Status:</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[selectedSession.status] ?? ""}`}>
                    {selectedSession.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Amount:</span>
                  <span className="ml-2">{(selectedSession.amount / 100).toFixed(2)} {selectedSession.currency}</span>
                </div>
                <div>
                  <span className="text-muted">Expires:</span>
                  <span className="ml-2 text-xs">{new Date(selectedSession.expiresAt).toLocaleString()}</span>
                </div>
                {selectedSession.customer?.email && (
                  <div>
                    <span className="text-muted">Customer:</span>
                    <span className="ml-2">{selectedSession.customer.email}</span>
                  </div>
                )}
                {selectedSession.paymentId && (
                  <div>
                    <span className="text-muted">Payment:</span>
                    <span className="ml-2 font-mono text-xs">{selectedSession.paymentId}</span>
                  </div>
                )}
                {selectedSession.checkoutUrl && (
                  <div className="col-span-2">
                    <span className="text-muted">Checkout URL:</span>
                    <a href={selectedSession.checkoutUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:underline text-xs">
                      {selectedSession.checkoutUrl}
                    </a>
                  </div>
                )}
              </div>

              {selectedSession.lineItems.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-muted font-semibold mb-2">Line Items</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted text-xs">
                        <th className="text-left pb-1">Item</th>
                        <th className="text-right pb-1">Qty</th>
                        <th className="text-right pb-1">Price</th>
                        <th className="text-right pb-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSession.lineItems.map((item, i) => (
                        <tr key={i} className="border-t border-card-border">
                          <td className="py-1">{item.name}</td>
                          <td className="text-right">{item.quantity}</td>
                          <td className="text-right font-mono">{(item.unitPrice / 100).toFixed(2)}</td>
                          <td className="text-right font-mono">{((item.quantity * item.unitPrice) / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Supported Payment Methods */}
      <div className="bg-card border border-card-border rounded-lg p-6">
        <h3 className="text-sm font-semibold mb-3">Supported Payment Methods ({currency})</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {supportedMethods.map((m) => (
            <div key={`${m.type}-${m.subtype}`} className="border border-card-border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{m.subtype}</span>
                <span className="px-2 py-0.5 rounded text-xs bg-accent/15 text-accent">{m.type}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                <span>
                  {(m.minAmount / 100).toFixed(0)}–{(m.maxAmount / 100).toLocaleString()} {currency}
                </span>
                {m.countries.length > 0 && (
                  <span className="ml-2">({m.countries.slice(0, 3).join(", ")}{m.countries.length > 3 ? "..." : ""})</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
