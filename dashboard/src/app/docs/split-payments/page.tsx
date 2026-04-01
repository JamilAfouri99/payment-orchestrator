"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function SplitPaymentsPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Split Payments</h1>
      <p className="text-muted leading-relaxed mb-8">
        Split a single payment across multiple recipients for marketplace and platform use cases. Configure hold periods, fee structures, and automatic payout schedules.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/api/payouts" desc="List payouts" />
        <Endpoint method="GET" path="/api/payouts/:id" desc="Get payout details" />
        <Endpoint method="GET" path="/api/payout-accounts" desc="List payout accounts" />
        <Endpoint method="POST" path="/api/payout-accounts" desc="Create a payout account" />
        <Endpoint method="GET" path="/api/settlements" desc="List settlements" />
        <Endpoint method="GET" path="/api/settlements/:id" desc="Get settlement details" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">How Splits Work</h2>
      <p className="text-muted leading-relaxed mb-4">
        When a customer pays on your marketplace, the payment is split according to your rules:
      </p>
      <div className="rounded-xl border border-card-border bg-card/50 p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-2">
              <span className="text-accent font-mono font-bold">$100</span>
            </div>
            <p className="text-muted">Customer pays</p>
          </div>
          <svg className="w-6 h-6 text-muted rotate-90 sm:rotate-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-2">
              <span className="text-success font-mono font-bold">$85</span>
            </div>
            <p className="text-muted">Seller receives</p>
          </div>
          <svg className="w-6 h-6 text-muted rotate-90 sm:rotate-0 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-2">
              <span className="text-warning font-mono font-bold">$15</span>
            </div>
            <p className="text-muted">Platform fee</p>
          </div>
        </div>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Create a Split Payment</h2>
      <CodeBlock
        title="POST /payments with splits"
        tabs={[
          {
            lang: "node",
            code: `const payment = await fetch("http://localhost:3000/payments", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json",
    "Idempotency-Key": "split_pay_001"
  },
  body: JSON.stringify({
    amount: 10000,          // $100.00
    currency: "USD",
    splits: [
      {
        accountId: "acct_seller_123",
        amount: 8500,       // $85.00 to seller
        description: "Product sale"
      },
      {
        accountId: "acct_platform",
        amount: 1500,       // $15.00 platform fee
        description: "Platform commission"
      }
    ]
  })
});`,
          },
          {
            lang: "python",
            code: `response = requests.post(
    "http://localhost:3000/payments",
    headers={
        "Authorization": "Bearer sk_sandbox_...",
        "Idempotency-Key": "split_pay_001"
    },
    json={
        "amount": 10000,
        "currency": "USD",
        "splits": [
            {
                "accountId": "acct_seller_123",
                "amount": 8500,
                "description": "Product sale"
            },
            {
                "accountId": "acct_platform",
                "amount": 1500,
                "description": "Platform commission"
            }
        ]
    }
)`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/payments \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Idempotency-Key: split_pay_001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 10000,
    "currency": "USD",
    "splits": [
      { "accountId": "acct_seller_123", "amount": 8500 },
      { "accountId": "acct_platform", "amount": 1500 }
    ]
  }'`,
          },
        ]}
      />

      <Callout type="warning">
        Split amounts must sum to the total payment amount. The API returns a 400 error if they don&apos;t match.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Settlement Schedule</h2>
      <p className="text-muted leading-relaxed mb-4">
        Settlements are calculated daily by default. Each settlement groups completed payments for a merchant account and calculates the net payout after fees.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Schedule</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Payout Delay</th>
              <th className="text-left py-3 text-muted font-medium">Min Payout</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Daily", "T+2 business days", "$25.00"],
              ["Weekly", "Next Monday", "$50.00"],
              ["Monthly", "1st of month", "$100.00"],
            ].map(([schedule, delay, min]) => (
              <tr key={schedule} className="border-b border-card-border">
                <td className="py-3 pr-4">{schedule}</td>
                <td className="py-3 pr-4 text-muted">{delay}</td>
                <td className="py-3 text-muted">{min}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
