"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function FraudPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Fraud Prevention</h1>
      <p className="text-muted leading-relaxed mb-8">
        Rule-based fraud scoring engine that evaluates every payment before the saga starts. Configurable rules with weighted scoring and automatic blocking of high-risk transactions.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/fraud/rules" desc="List all fraud rules" />
        <Endpoint method="POST" path="/admin/fraud/rules" desc="Create a fraud rule" />
        <Endpoint method="PUT" path="/admin/fraud/rules/:id" desc="Update a fraud rule" />
        <Endpoint method="DELETE" path="/admin/fraud/rules/:id" desc="Delete a fraud rule" />
        <Endpoint method="POST" path="/admin/fraud/simulate" desc="Simulate fraud scoring" />
        <Endpoint method="GET" path="/payments/:id/fraud" desc="Get fraud evaluation for a payment" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">How Scoring Works</h2>
      <p className="text-muted leading-relaxed mb-4">
        Each fraud rule produces a weighted score. Scores are summed and compared against thresholds:
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Score Range</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Action</th>
              <th className="text-left py-3 text-muted font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-card-border">
              <td className="py-3 pr-4"><InlineCode>&le; 30</InlineCode></td>
              <td className="py-3 pr-4 text-success font-medium">ALLOW</td>
              <td className="py-3 text-muted">Payment proceeds normally</td>
            </tr>
            <tr className="border-b border-card-border">
              <td className="py-3 pr-4"><InlineCode>31 &ndash; 70</InlineCode></td>
              <td className="py-3 pr-4 text-warning font-medium">REVIEW</td>
              <td className="py-3 text-muted">Payment proceeds but flagged for review</td>
            </tr>
            <tr className="border-b border-card-border">
              <td className="py-3 pr-4"><InlineCode>&gt; 70</InlineCode></td>
              <td className="py-3 pr-4 text-danger font-medium">BLOCK</td>
              <td className="py-3 text-muted">Payment rejected with 403</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Default Rules</h2>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Rule</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Weight</th>
              <th className="text-left py-3 text-muted font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Velocity check", "25", "Flags multiple transactions in a short window"],
              ["Amount anomaly", "20", "Flags amounts that deviate from customer average"],
              ["High-value", "30", "Flags transactions above a configurable threshold"],
              ["Geo mismatch", "15", "Flags mismatched card country and IP location"],
              ["New customer", "10", "Flags first-time customers with no transaction history"],
            ].map(([rule, weight, desc]) => (
              <tr key={rule} className="border-b border-card-border">
                <td className="py-3 pr-4">{rule}</td>
                <td className="py-3 pr-4 font-mono text-accent">{weight}</td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Simulate Fraud Scoring</h2>
      <p className="text-muted leading-relaxed mb-4">
        Test your fraud rules without creating a real payment:
      </p>
      <CodeBlock
        title="POST /admin/fraud/simulate"
        tabs={[
          {
            lang: "node",
            code: `const result = await fetch("http://localhost:3000/admin/fraud/simulate", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    amount: 50000,       // $500
    currency: "USD",
    customerId: "cus_abc123",
    region: "US"
  })
});

// Response:
// {
//   "score": 45,
//   "action": "REVIEW",
//   "rules": [
//     { "name": "high-value", "score": 30, "triggered": true },
//     { "name": "velocity", "score": 15, "triggered": true }
//   ]
// }`,
          },
          {
            lang: "python",
            code: `response = requests.post(
    "http://localhost:3000/admin/fraud/simulate",
    headers={"Authorization": "Bearer sk_sandbox_..."},
    json={
        "amount": 50000,
        "currency": "USD",
        "customerId": "cus_abc123",
        "region": "US"
    }
)

print(response.json())
# {"score": 45, "action": "REVIEW", "rules": [...]}`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/admin/fraud/simulate \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 50000,
    "currency": "USD",
    "customerId": "cus_abc123",
    "region": "US"
  }'`,
          },
        ]}
      />

      <Callout type="tip">
        Use the <strong>Fraud Rules</strong> page in the dashboard to visually adjust rule weights and test different scenarios with the built-in simulator.
      </Callout>
    </div>
  );
}
