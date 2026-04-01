"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function SubscriptionsPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Subscriptions</h1>
      <p className="text-muted leading-relaxed mb-8">
        Manage recurring billing with plan-based subscriptions, automatic invoicing, dunning for failed payments, and lifecycle management.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="POST" path="/api/subscriptions" desc="Create a subscription" />
        <Endpoint method="GET" path="/api/subscriptions" desc="List subscriptions" />
        <Endpoint method="GET" path="/api/subscriptions/:id" desc="Get subscription details" />
        <Endpoint method="POST" path="/api/subscriptions/:id/cancel" desc="Cancel a subscription" />
        <Endpoint method="POST" path="/api/subscriptions/:id/pause" desc="Pause billing" />
        <Endpoint method="POST" path="/api/subscriptions/:id/resume" desc="Resume billing" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Create a Subscription</h2>
      <CodeBlock
        title="POST /api/subscriptions"
        tabs={[
          {
            lang: "node",
            code: `const subscription = await fetch("http://localhost:3000/api/subscriptions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    customerId: "cus_abc123",
    planId: "plan_growth",
    interval: "monthly",
    amount: 19900,         // $199.00/mo in cents
    currency: "USD",
    trialDays: 14
  })
});`,
          },
          {
            lang: "python",
            code: `response = requests.post(
    "http://localhost:3000/api/subscriptions",
    headers={
        "Authorization": "Bearer sk_sandbox_...",
        "Content-Type": "application/json"
    },
    json={
        "customerId": "cus_abc123",
        "planId": "plan_growth",
        "interval": "monthly",
        "amount": 19900,
        "currency": "USD",
        "trialDays": 14
    }
)`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/api/subscriptions \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "cus_abc123",
    "planId": "plan_growth",
    "interval": "monthly",
    "amount": 19900,
    "currency": "USD",
    "trialDays": 14
  }'`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Subscription Lifecycle</h2>
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
              ["trialing", "Free trial period — no charges yet"],
              ["active", "Subscription is active and billing normally"],
              ["past_due", "Payment failed — dunning retry in progress"],
              ["paused", "Billing paused by customer or admin"],
              ["canceled", "Subscription ended — no further billing"],
              ["expired", "Trial ended without conversion"],
            ].map(([status, desc]) => (
              <tr key={status} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{status}</InlineCode></td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Billing Intervals</h2>
      <p className="text-muted leading-relaxed mb-4">
        Subscriptions support the following billing intervals: <InlineCode>daily</InlineCode>, <InlineCode>weekly</InlineCode>, <InlineCode>monthly</InlineCode>, <InlineCode>quarterly</InlineCode>, and <InlineCode>yearly</InlineCode>.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Dunning</h2>
      <p className="text-muted leading-relaxed mb-4">
        When a subscription payment fails, the dunning system automatically retries with configurable schedules. Failed payments trigger the <InlineCode>subscription.payment_failed</InlineCode> webhook event.
      </p>
      <Callout type="info">
        Configure dunning retry schedules in the <InlineCode>Dunning</InlineCode> dashboard page. Default: retry at 1, 3, 5, and 7 days after failure.
      </Callout>
    </div>
  );
}
