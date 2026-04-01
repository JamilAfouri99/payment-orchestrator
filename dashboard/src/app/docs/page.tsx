"use client";

import { CodeBlock, InlineCode, Callout } from "@/components/code-block";
import Link from "next/link";

export default function QuickStartPage() {
  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-muted mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          5 minute read
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Quick Start</h1>
        <p className="text-muted leading-relaxed">
          Get up and running with Payment Orchestrator in under 5 minutes. This guide walks you through creating an account, getting your API key, and making your first payment.
        </p>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">1. Create an Account</h2>
      <p className="text-muted leading-relaxed mb-4">
        Head to the <Link href="/onboarding" className="text-accent hover:text-accent-hover transition-colors">onboarding page</Link> and create a new account. You&apos;ll set up your company details and get access to the sandbox environment immediately.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">2. Get Your API Key</h2>
      <p className="text-muted leading-relaxed mb-4">
        After signing in, navigate to <Link href="/settings/api-keys" className="text-accent hover:text-accent-hover transition-colors">Settings &rarr; API Keys</Link> and create a new sandbox key. Your key will look like <InlineCode>sk_sandbox_...</InlineCode>.
      </p>
      <Callout type="warning">
        Never expose your API key in client-side code. Always make API calls from your server.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">3. Install the SDK</h2>
      <CodeBlock
        title="Install"
        tabs={[
          { lang: "node", code: `npm install @payorch/node` },
          { lang: "python", code: `pip install payorch` },
          { lang: "curl", code: `# No installation needed — use cURL directly` },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">4. Make Your First Payment</h2>
      <p className="text-muted leading-relaxed mb-4">
        Create a payment with a single API call. The orchestrator automatically selects the best provider, runs fraud checks, and handles retries.
      </p>
      <CodeBlock
        title="Create a payment"
        tabs={[
          {
            lang: "node",
            code: `const PayOrch = require("@payorch/node");

const client = new PayOrch("sk_sandbox_your_key");

const payment = await client.payments.create({
  amount: 4999,        // $49.99 in cents
  currency: "USD",
  customer: "cus_abc123",
  description: "Pro plan subscription",
  metadata: { plan: "growth" }
}, {
  idempotencyKey: "pay_req_unique_id"
});

console.log(payment.id);      // "pay_7f3a2b1c"
console.log(payment.status);  // "completed"
console.log(payment.provider); // "stripe"`,
          },
          {
            lang: "python",
            code: `import payorch

client = payorch.Client("sk_sandbox_your_key")

payment = client.payments.create(
    amount=4999,          # $49.99 in cents
    currency="USD",
    customer="cus_abc123",
    description="Pro plan subscription",
    metadata={"plan": "growth"},
    idempotency_key="pay_req_unique_id"
)

print(payment.id)       # "pay_7f3a2b1c"
print(payment.status)   # "completed"
print(payment.provider) # "stripe"`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/payments \\
  -H "Authorization: Bearer sk_sandbox_your_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: pay_req_unique_id" \\
  -d '{
    "amount": 4999,
    "currency": "USD",
    "customer": "cus_abc123",
    "description": "Pro plan subscription",
    "metadata": { "plan": "growth" }
  }'`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">5. Check the Dashboard</h2>
      <p className="text-muted leading-relaxed mb-4">
        Open the <Link href="/" className="text-accent hover:text-accent-hover transition-colors">dashboard</Link> to see your payment in real time. Click into the payment detail to see the saga flow, event timeline, fraud score, and provider routing decision.
      </p>

      <Callout type="tip">
        Use the <Link href="/sandbox" className="text-accent hover:text-accent-hover transition-colors">Sandbox</Link> page to experiment with the API directly from your browser without writing any code.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">What&apos;s Next?</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {[
          { href: "/docs/authentication", label: "Authentication", desc: "API keys, scopes, and rate limits" },
          { href: "/docs/payments", label: "Payments", desc: "Create, capture, refund, and cancel" },
          { href: "/docs/webhooks", label: "Webhooks", desc: "Real-time event notifications" },
          { href: "/docs/testing", label: "Testing", desc: "Sandbox mode and test cards" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block p-4 rounded-lg border border-card-border bg-card/50 hover:border-accent/30 transition-colors"
          >
            <h3 className="font-display font-semibold text-sm mb-1">{item.label}</h3>
            <p className="text-xs text-muted">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
