"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function DisputesPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Disputes</h1>
      <p className="text-muted leading-relaxed mb-8">
        Manage chargebacks and disputes with automated lifecycle tracking, evidence submission, and resolution management.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/api/disputes" desc="List disputes" />
        <Endpoint method="GET" path="/api/disputes/:id" desc="Get dispute details" />
        <Endpoint method="POST" path="/api/disputes/:id/evidence" desc="Submit evidence" />
        <Endpoint method="POST" path="/api/disputes/:id/accept" desc="Accept the dispute" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Dispute Lifecycle</h2>
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
              ["needs_response", "Dispute opened — evidence required within deadline"],
              ["under_review", "Evidence submitted, awaiting card network decision"],
              ["won", "Dispute resolved in your favor — funds returned"],
              ["lost", "Dispute resolved in cardholder's favor — funds deducted"],
              ["accepted", "Merchant accepted the dispute without contesting"],
            ].map(([status, desc]) => (
              <tr key={status} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{status}</InlineCode></td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Submit Evidence</h2>
      <p className="text-muted leading-relaxed mb-4">
        Upload evidence to contest a dispute. Include as much documentation as possible to increase your chances of winning.
      </p>
      <CodeBlock
        title="POST /api/disputes/:id/evidence"
        tabs={[
          {
            lang: "node",
            code: `const evidence = await fetch(
  "http://localhost:3000/api/disputes/dsp_abc123/evidence",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer sk_sandbox_...",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      customerEmail: "customer@example.com",
      shippingTracking: "1Z999AA10123456784",
      receiptUrl: "https://your-app.com/receipts/inv_123",
      description: "Customer received product on 2025-01-10.
        Tracking confirms delivery."
    })
  }
);`,
          },
          {
            lang: "python",
            code: `response = requests.post(
    "http://localhost:3000/api/disputes/dsp_abc123/evidence",
    headers={"Authorization": "Bearer sk_sandbox_..."},
    json={
        "customerEmail": "customer@example.com",
        "shippingTracking": "1Z999AA10123456784",
        "receiptUrl": "https://your-app.com/receipts/inv_123",
        "description": "Customer received product on 2025-01-10."
    }
)`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/api/disputes/dsp_abc123/evidence \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerEmail": "customer@example.com",
    "shippingTracking": "1Z999AA10123456784",
    "receiptUrl": "https://your-app.com/receipts/inv_123",
    "description": "Customer received product on 2025-01-10."
  }'`,
          },
        ]}
      />

      <Callout type="warning">
        Evidence must be submitted before the dispute deadline. The deadline is set by the card network and typically ranges from 7 to 21 days.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Dispute Reason Codes</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Reason</th>
              <th className="text-left py-3 text-muted font-medium">Best Response</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["fraudulent", "Provide proof of legitimate purchase and delivery"],
              ["duplicate", "Show only one charge occurred, or refund the duplicate"],
              ["product_not_received", "Provide shipping tracking and delivery confirmation"],
              ["product_unacceptable", "Show product matched description, offer partial refund"],
              ["unrecognized", "Provide transaction details and customer communication"],
            ].map(([reason, response]) => (
              <tr key={reason} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{reason}</InlineCode></td>
                <td className="py-3 text-muted">{response}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
