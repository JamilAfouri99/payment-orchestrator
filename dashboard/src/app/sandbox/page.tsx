"use client";

import { useEffect, useState } from "react";
import {
  fetchTestCards,
  triggerSandboxDispute,
  resetSandbox,
  type TestCardRecord,
} from "@/lib/api";

const BEHAVIOR_COLORS: Record<string, string> = {
  success: "text-success",
  decline_insufficient_funds: "text-danger",
  "3ds_challenge": "text-warning",
  timeout: "text-danger",
  fraud_block: "text-danger",
  success_then_dispute: "text-warning",
  soft_decline_retry: "text-warning",
};

const BEHAVIOR_BADGES: Record<string, string> = {
  success: "bg-success/15 text-success",
  decline_insufficient_funds: "bg-danger/15 text-danger",
  "3ds_challenge": "bg-warning/15 text-warning",
  timeout: "bg-danger/15 text-danger",
  fraud_block: "bg-danger/15 text-danger",
  success_then_dispute: "bg-warning/15 text-warning",
  soft_decline_retry: "bg-warning/15 text-warning",
};

export default function SandboxPage() {
  const [cards, setCards] = useState<TestCardRecord[]>([]);
  const [disputePaymentId, setDisputePaymentId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTestCards()
      .then((data) => setCards(data.cards))
      .catch(() => setError("Failed to load test cards"));
  }, []);

  async function handleTriggerDispute() {
    if (!disputePaymentId.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await triggerSandboxDispute(disputePaymentId.trim());
      setResult(`Dispute ${res.disputeId} created for payment ${res.paymentId}`);
      setDisputePaymentId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger dispute");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset all sandbox data? This cannot be undone.")) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await resetSandbox();
      setResult(`Sandbox reset complete. ${res.deleted} records deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset sandbox");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Sandbox</h1>
        <p className="text-muted text-sm mt-1">
          Test card numbers and sandbox tools for development
        </p>
      </div>

      {/* Environment indicator */}
      <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-warning shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-warning">Sandbox Mode</p>
          <p className="text-xs text-muted mt-0.5">
            Payments using test cards never touch real payment providers. Data is isolated from production.
          </p>
        </div>
      </div>

      {/* Test Card Reference */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-6 border-b border-card-border">
          <h2 className="text-lg font-semibold">Test Card Numbers</h2>
          <p className="text-muted text-sm mt-1">Use these card numbers in sandbox mode to trigger specific behaviors</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-muted">
                <th className="px-6 py-3 font-medium">Card Number</th>
                <th className="px-6 py-3 font-medium">Behavior</th>
                <th className="px-6 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.number} className="border-b border-card-border last:border-0 hover:bg-card-border/30">
                  <td className="px-6 py-4 font-mono text-accent">
                    {card.number.replace(/(.{4})/g, "$1 ").trim()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block text-xs px-2 py-1 rounded font-medium ${BEHAVIOR_BADGES[card.behavior] ?? "bg-muted/15 text-muted"}`}>
                      {card.behavior}
                    </span>
                  </td>
                  <td className={`px-6 py-4 ${BEHAVIOR_COLORS[card.behavior] ?? "text-muted"}`}>
                    {card.description}
                  </td>
                </tr>
              ))}
              {cards.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-muted">Loading test cards...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sandbox Tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Trigger Dispute */}
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Trigger Dispute</h3>
          <p className="text-muted text-sm mb-4">
            Manually create a chargeback dispute on a sandbox payment for testing your dispute handling flow.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={disputePaymentId}
              onChange={(e) => setDisputePaymentId(e.target.value)}
              placeholder="Payment ID"
              className="flex-1 px-3 py-2 bg-background border border-card-border rounded-lg text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleTriggerDispute}
              disabled={loading || !disputePaymentId.trim()}
              className="px-4 py-2 bg-warning/20 text-warning rounded-lg text-sm font-medium hover:bg-warning/30 disabled:opacity-50 transition-colors"
            >
              Trigger
            </button>
          </div>
        </div>

        {/* Reset Sandbox */}
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="font-semibold mb-3">Reset Sandbox Data</h3>
          <p className="text-muted text-sm mb-4">
            Delete all sandbox payment data (sagas, events, snapshots) for a clean testing slate.
          </p>
          <button
            onClick={handleReset}
            disabled={loading}
            className="px-4 py-2 bg-danger/20 text-danger rounded-lg text-sm font-medium hover:bg-danger/30 disabled:opacity-50 transition-colors"
          >
            Reset All Sandbox Data
          </button>
        </div>
      </div>

      {/* Result/Error messages */}
      {result && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-success text-sm">
          {result}
        </div>
      )}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Integration guide */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold mb-3">Integration Guide</h3>
        <div className="space-y-4 text-sm text-muted">
          <div>
            <p className="font-medium text-foreground mb-1">1. Use sandbox API keys</p>
            <p>All API keys with prefix <code className="text-accent">pk_test_</code> operate in sandbox mode. Create one via Settings &rarr; API Keys.</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">2. Send test card numbers</p>
            <p>Include a test card number in the <code className="text-accent">card.pan</code> field of your payment request to trigger specific behaviors.</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">3. Verify webhook handling</p>
            <p>Register a webhook endpoint, then create payments with test cards. Webhook deliveries are instant in sandbox mode.</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">4. CLI tool</p>
            <pre className="bg-background border border-card-border rounded-lg p-3 mt-2 text-xs overflow-x-auto">
{`npx tsx bin/payorchestrate.ts login --key pk_test_your_key
npx tsx bin/payorchestrate.ts payments create --amount 5000 --currency USD
npx tsx bin/payorchestrate.ts sandbox test-cards`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
