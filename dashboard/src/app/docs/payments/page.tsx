"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function PaymentsPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Payments</h1>
      <p className="text-muted leading-relaxed mb-8">
        Create, retrieve, and manage payments. Each payment runs through a 4-step saga: validate, reserve inventory, charge via provider, and notify.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="POST" path="/payments" desc="Create a new payment" />
        <Endpoint method="GET" path="/payments" desc="List payments with pagination" />
        <Endpoint method="GET" path="/payments/:id" desc="Get payment current state" />
        <Endpoint method="GET" path="/payments/:id/events" desc="Get full event history" />
        <Endpoint method="GET" path="/payments/:id/state?at=" desc="Temporal query — state at a point in time" />
        <Endpoint method="POST" path="/payments/:id/replay" desc="Rebuild state from events (bypass snapshot)" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Create a Payment</h2>
      <p className="text-muted leading-relaxed mb-4">
        All amounts are in <strong>cents</strong> (integer). The <InlineCode>Idempotency-Key</InlineCode> header is required to prevent duplicate charges.
      </p>
      <CodeBlock
        title="POST /payments"
        tabs={[
          {
            lang: "node",
            code: `const response = await fetch("http://localhost:3000/payments", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json",
    "Idempotency-Key": "unique-request-id"
  },
  body: JSON.stringify({
    amount: 9999,           // $99.99
    currency: "USD",
    region: "US",
    items: [
      { name: "Pro Plan", quantity: 1, unitPrice: 9999 }
    ],
    card: {
      number: "4242424242424242",
      expMonth: 12,
      expYear: 2027,
      cvc: "123"
    }
  })
});

const payment = await response.json();
// { id, status, amount, currency, provider, fraudScore, events }`,
          },
          {
            lang: "python",
            code: `import requests

response = requests.post(
    "http://localhost:3000/payments",
    headers={
        "Authorization": "Bearer sk_sandbox_...",
        "Content-Type": "application/json",
        "Idempotency-Key": "unique-request-id"
    },
    json={
        "amount": 9999,
        "currency": "USD",
        "region": "US",
        "items": [
            {"name": "Pro Plan", "quantity": 1, "unitPrice": 9999}
        ],
        "card": {
            "number": "4242424242424242",
            "expMonth": 12,
            "expYear": 2027,
            "cvc": "123"
        }
    }
)

payment = response.json()`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/payments \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: unique-request-id" \\
  -d '{
    "amount": 9999,
    "currency": "USD",
    "region": "US",
    "items": [
      { "name": "Pro Plan", "quantity": 1, "unitPrice": 9999 }
    ],
    "card": {
      "number": "4242424242424242",
      "expMonth": 12,
      "expYear": 2027,
      "cvc": "123"
    }
  }'`,
          },
        ]}
      />

      <Callout type="info">
        You can also pass a <InlineCode>token</InlineCode> field instead of <InlineCode>card</InlineCode> to use a previously tokenized payment method.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Payment Lifecycle</h2>
      <p className="text-muted leading-relaxed mb-4">
        Payments move through a state machine driven by the saga orchestrator:
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Status</th>
              <th className="text-left py-3 text-muted font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["initiated", "Payment created, saga starting"],
              ["validated", "Request validation passed"],
              ["inventory_reserved", "Inventory held for this payment"],
              ["charged", "Provider successfully charged"],
              ["completed", "All steps succeeded, customer notified"],
              ["failed", "Saga failed, compensation started"],
              ["compensated", "Rollback completed (inventory released, refund issued)"],
            ].map(([status, desc]) => (
              <tr key={status} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{status}</InlineCode></td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">List Payments</h2>
      <CodeBlock
        title="GET /payments"
        tabs={[
          {
            lang: "node",
            code: `const response = await fetch(
  "http://localhost:3000/payments?limit=20&offset=0",
  { headers: { "Authorization": "Bearer sk_sandbox_..." } }
);

const payments = await response.json();
// Array of payment objects`,
          },
          {
            lang: "python",
            code: `response = requests.get(
    "http://localhost:3000/payments",
    params={"limit": 20, "offset": 0},
    headers={"Authorization": "Bearer sk_sandbox_..."}
)

payments = response.json()`,
          },
          {
            lang: "curl",
            code: `curl "http://localhost:3000/payments?limit=20&offset=0" \\
  -H "Authorization: Bearer sk_sandbox_..."`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Temporal Queries</h2>
      <p className="text-muted leading-relaxed mb-4">
        Reconstruct the payment state at any past moment using event sourcing:
      </p>
      <CodeBlock
        title="GET /payments/:id/state?at="
        tabs={[
          {
            lang: "curl",
            code: `# Get payment state as it was at a specific timestamp
curl "http://localhost:3000/payments/pay_abc123/state?at=2025-01-15T10:30:00Z" \\
  -H "Authorization: Bearer sk_sandbox_..."`,
          },
        ]}
      />
    </div>
  );
}
