"use client";

import { useState } from "react";
import { verifyWebhookSignature } from "@/lib/api";

const EXAMPLE_PAYLOAD = JSON.stringify({ event: "payment.completed", paymentId: "pay_123" });
const EXAMPLE_SECRET = "whsec_test_secret";

export default function VerifyPage() {
  const [payload, setPayload] = useState(EXAMPLE_PAYLOAD);
  const [signature, setSignature] = useState("");
  const [secret, setSecret] = useState(EXAMPLE_SECRET);
  const [result, setResult] = useState<{
    valid: boolean;
    computedSignature: string;
    expectedSignature: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await verifyWebhookSignature(payload, signature, secret);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Webhook Signature Verification</h2>
        <p className="text-muted text-sm mt-1">
          Verify HMAC-SHA256 webhook signatures to confirm payload authenticity
        </p>
      </div>

      <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-accent mb-3">How HMAC-SHA256 Verification Works</h3>
        <div className="space-y-3 text-sm text-muted">
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <p>When the system delivers a webhook, it computes <code className="text-foreground bg-background/50 px-1 rounded">HMAC-SHA256(payload, secret)</code> and includes the hex digest in the <code className="text-foreground bg-background/50 px-1 rounded">X-Webhook-Signature</code> header.</p>
          </div>
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <p>The receiver computes the same HMAC using their copy of the shared secret and the raw request body.</p>
          </div>
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <p>If the computed signature matches the header value, the payload is authentic and unmodified. A timing-safe comparison prevents side-channel attacks.</p>
          </div>
          <div className="flex gap-3">
            <span className="bg-accent/15 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <p>If they do not match, the payload may have been tampered with or the wrong secret was used. Reject the request.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleVerify} className="bg-card border border-card-border rounded-xl p-6 space-y-5">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted">Verify a Signature</h3>

        <div>
          <label className="block text-xs text-muted mb-1">Payload (JSON body)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={4}
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent resize-y"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Signature (hex string)</label>
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="e.g. a1b2c3d4e5f6..."
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-muted mt-1">
            The value from the X-Webhook-Signature header. Leave empty to see what the correct signature should be.
          </p>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Secret</label>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="whsec_..."
            className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
          />
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !payload || !secret}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Verifying..." : "Verify Signature"}
        </button>
      </form>

      {result && (
        <div className={`rounded-xl p-6 border ${
          result.valid
            ? "bg-success/10 border-success/30"
            : "bg-danger/10 border-danger/30"
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-3 h-3 rounded-full ${result.valid ? "bg-success" : "bg-danger"}`} />
            <h3 className={`text-lg font-semibold ${result.valid ? "text-success" : "text-danger"}`}>
              {result.valid ? "Valid Signature" : "Invalid Signature"}
            </h3>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Computed Signature</p>
              <p className="font-mono text-sm break-all bg-background/30 rounded-lg p-3">
                {result.computedSignature}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Expected Signature (from input)</p>
              <p className="font-mono text-sm break-all bg-background/30 rounded-lg p-3">
                {result.expectedSignature || "(empty -- no signature provided)"}
              </p>
            </div>

            {!result.valid && (
              <p className="text-sm text-muted">
                The signatures do not match. Either the payload was modified after signing,
                the wrong secret was used, or the signature value is incorrect.
              </p>
            )}
            {result.valid && (
              <p className="text-sm text-muted">
                The computed HMAC matches the provided signature, confirming the payload
                is authentic and has not been tampered with.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
