"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";

function generateKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface RequestResult {
  status: number;
  durationMs: number;
  body: Record<string, unknown>;
}

const DEMO_PAYMENT = {
  amount: 2500,
  currency: "USD",
  customerId: "cust_idempotency_demo",
  orderId: "ord_idem_test",
  items: [{ productId: "prod_test", quantity: 1, pricePerUnit: 2500 }],
};

export default function IdempotencyPage() {
  const [key, setKey] = useState(generateKey);
  const [firstResult, setFirstResult] = useState<RequestResult | null>(null);
  const [replayResult, setReplayResult] = useState<RequestResult | null>(null);
  const [sendingFirst, setSendingFirst] = useState(false);
  const [sendingReplay, setSendingReplay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendRequest(): Promise<RequestResult> {
    const start = performance.now();
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(DEMO_PAYMENT),
    });
    const durationMs = Math.round(performance.now() - start);
    const body = await res.json();
    return { status: res.status, durationMs, body };
  }

  async function handleSendFirst() {
    setSendingFirst(true);
    setError(null);
    setFirstResult(null);
    setReplayResult(null);
    try {
      const result = await sendRequest();
      setFirstResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSendingFirst(false);
    }
  }

  async function handleReplay() {
    setSendingReplay(true);
    setError(null);
    setReplayResult(null);
    try {
      const result = await sendRequest();
      setReplayResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay request failed");
    } finally {
      setSendingReplay(false);
    }
  }

  function handleNewKey() {
    setKey(generateKey());
    setFirstResult(null);
    setReplayResult(null);
    setError(null);
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Idempotency Demo</h2>
        <p className="text-muted text-sm mt-1">
          Demonstrate how idempotency keys prevent duplicate payment processing
        </p>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-accent mb-2">How Idempotency Works</h3>
        <div className="text-sm text-muted space-y-2">
          <p>
            Every payment request requires an <code className="text-foreground bg-background/50 px-1 rounded">Idempotency-Key</code> header.
            The server stores a mapping from key to response.
          </p>
          <p>
            When the same key is sent again, the server returns the cached response without
            re-executing the payment saga. This prevents double-charging if a client retries
            due to network timeouts or other transient failures.
          </p>
          <p>
            Try it: send a payment, then replay with the same key. Notice the replay returns
            the same payment ID and response instantly without creating a new payment.
          </p>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted mb-4">Idempotency Key</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Key</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={handleNewKey}
            className="px-3 py-2 rounded-lg bg-card-border/50 border border-card-border text-sm text-muted hover:text-foreground transition-colors"
          >
            Generate New
          </button>
        </div>

        <div className="mt-4 bg-background/50 rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Request Body (fixed)</p>
          <pre className="text-xs font-mono text-foreground/80 overflow-x-auto">
            {JSON.stringify(DEMO_PAYMENT, null, 2)}
          </pre>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={handleSendFirst}
            disabled={sendingFirst || !key}
            className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendingFirst ? "Sending..." : "Send Payment"}
          </button>
          <button
            onClick={handleReplay}
            disabled={sendingReplay || !firstResult || !key}
            className="px-5 py-2.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm font-medium hover:bg-warning/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendingReplay ? "Replaying..." : "Replay Same Key"}
          </button>
        </div>

        {error && (
          <p className="text-sm text-danger mt-3">{error}</p>
        )}
      </div>

      {(firstResult || replayResult) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ResultCard
            title="First Request"
            result={firstResult}
            highlight="New payment created and saga executed"
          />
          <ResultCard
            title="Replay (Same Key)"
            result={replayResult}
            highlight="Cached response returned, no new payment"
          />
        </div>
      )}

      {firstResult && replayResult && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Comparison</h3>
          <div className="space-y-3">
            <ComparisonRow
              label="Payment ID"
              first={String(firstResult.body.id ?? "--")}
              replay={String(replayResult.body.id ?? "--")}
              match={firstResult.body.id === replayResult.body.id}
            />
            <ComparisonRow
              label="HTTP Status"
              first={String(firstResult.status)}
              replay={String(replayResult.status)}
              match={firstResult.status === replayResult.status}
            />
            <ComparisonRow
              label="Response Time"
              first={`${firstResult.durationMs}ms`}
              replay={`${replayResult.durationMs}ms`}
              match={false}
            />
            <div className="border-t border-card-border pt-3 text-sm text-muted">
              {firstResult.body.id === replayResult.body.id ? (
                <p className="text-success">
                  Both requests returned the same payment ID, confirming the idempotency key
                  prevented a duplicate payment.
                </p>
              ) : (
                <p className="text-warning">
                  Different payment IDs returned. This may indicate the idempotency cache expired
                  or the server was restarted between requests.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  title,
  result,
  highlight,
}: {
  title: string;
  result: RequestResult | null;
  highlight: string;
}) {
  if (!result) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h4 className="font-semibold mb-2">{title}</h4>
        <p className="text-sm text-muted">Waiting for request...</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-6">
      <h4 className="font-semibold mb-3">{title}</h4>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={result.status < 300 ? "completed" : "failed"} />
          <span className="font-mono text-sm">HTTP {result.status}</span>
          <span className="text-xs text-muted ml-auto">{result.durationMs}ms</span>
        </div>
        <p className="text-xs text-muted">{highlight}</p>
        <div className="bg-background/50 rounded-lg p-3 max-h-48 overflow-y-auto">
          <pre className="text-xs font-mono text-foreground/80">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function ComparisonRow({
  label,
  first,
  replay,
  match,
}: {
  label: string;
  first: string;
  replay: string;
  match: boolean;
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-muted w-32">{label}</span>
      <span className="font-mono flex-1">{first}</span>
      <span className="font-mono flex-1">{replay}</span>
      {match && (
        <span className="text-xs text-success font-medium">Match</span>
      )}
    </div>
  );
}
