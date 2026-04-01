"use client";

import { CodeBlock, InlineCode, Callout } from "@/components/code-block";

export default function TestingPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Testing</h1>
      <p className="text-muted leading-relaxed mb-8">
        Use the sandbox environment to test your integration without processing real payments. Simulate different scenarios including provider failures, fraud blocks, and decline codes.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Sandbox Environment</h2>
      <p className="text-muted leading-relaxed mb-4">
        All API keys prefixed with <InlineCode>sk_sandbox_</InlineCode> route to the sandbox environment. No real charges are made, and all provider responses are simulated.
      </p>
      <Callout type="tip">
        The sandbox environment behaves identically to production, including fraud scoring, webhook delivery, and event sourcing. The only difference is that no real money moves.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Test Cards</h2>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Card Number</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Scenario</th>
              <th className="text-left py-3 text-muted font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["4242 4242 4242 4242", "Successful payment", "completed"],
              ["4000 0000 0000 0002", "Card declined", "failed"],
              ["4000 0000 0000 9995", "Insufficient funds", "failed (soft decline)"],
              ["4000 0000 0000 0069", "Expired card", "failed (hard decline)"],
              ["4000 0000 0000 0127", "CVC check fails", "failed"],
              ["4000 0000 0000 3220", "3D Secure required", "requires_action"],
            ].map(([card, scenario, result]) => (
              <tr key={card} className="border-b border-card-border">
                <td className="py-3 pr-4 font-mono text-sm">{card}</td>
                <td className="py-3 pr-4">{scenario}</td>
                <td className="py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                    result === "completed" ? "bg-success/15 text-success" :
                    result === "requires_action" ? "bg-warning/15 text-warning" :
                    "bg-danger/15 text-danger"
                  }`}>
                    {result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted mb-4">
        Use any future expiry date and any 3-digit CVC with these test cards.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Simulating Provider Failures</h2>
      <p className="text-muted leading-relaxed mb-4">
        Use the Chaos Engineering controls to simulate provider failures and test your error handling:
      </p>
      <CodeBlock
        title="Configure chaos"
        tabs={[
          {
            lang: "node",
            code: `// Set Stripe failure rate to 100% — all payments will route to Adyen
await fetch("http://localhost:3000/admin/chaos", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    "stripe": { "failureRate": 1.0, "enabled": true },
    "adyen": { "failureRate": 0, "enabled": true },
    "paypal": { "failureRate": 0, "enabled": true }
  })
});`,
          },
          {
            lang: "python",
            code: `# Set Stripe failure rate to 100%
requests.post(
    "http://localhost:3000/admin/chaos",
    headers={"Authorization": "Bearer sk_sandbox_..."},
    json={
        "stripe": {"failureRate": 1.0, "enabled": True},
        "adyen": {"failureRate": 0, "enabled": True},
        "paypal": {"failureRate": 0, "enabled": True}
    }
)`,
          },
          {
            lang: "curl",
            code: `# Set Stripe failure rate to 100%
curl -X POST http://localhost:3000/admin/chaos \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "stripe": { "failureRate": 1.0, "enabled": true }
  }'`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Simulated Webhook Events</h2>
      <p className="text-muted leading-relaxed mb-4">
        Register a webhook URL and create a payment to see real-time webhook deliveries. Each payment triggers events through the full lifecycle.
      </p>
      <CodeBlock
        title="Test webhooks end-to-end"
        tabs={[
          {
            lang: "node",
            code: `// 1. Register a webhook
await fetch("http://localhost:3000/webhooks/register", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: "https://webhook.site/your-unique-id",
    events: ["payment.completed", "payment.failed"]
  })
});

// 2. Create a payment — webhook fires automatically
await fetch("http://localhost:3000/payments", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json",
    "Idempotency-Key": "test_webhook_001"
  },
  body: JSON.stringify({
    amount: 1000,
    currency: "USD",
    items: [{ name: "Test", quantity: 1, unitPrice: 1000 }]
  })
});

// 3. Check delivery status
const deliveries = await fetch(
  "http://localhost:3000/webhooks/deliveries",
  { headers: { "Authorization": "Bearer sk_sandbox_..." } }
);`,
          },
        ]}
      />

      <Callout type="info">
        Use <a href="https://webhook.site" target="_blank" rel="noopener" className="text-accent hover:text-accent-hover">webhook.site</a> to get a temporary URL for testing webhook delivery without running your own server.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Dashboard Sandbox</h2>
      <p className="text-muted leading-relaxed">
        The <InlineCode>/sandbox</InlineCode> page in the dashboard provides an interactive API playground where you can make API calls directly from the browser, inspect requests and responses, and experiment without writing code.
      </p>
    </div>
  );
}
