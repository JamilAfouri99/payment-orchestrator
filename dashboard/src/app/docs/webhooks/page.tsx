"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function WebhooksPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Webhooks</h1>
      <p className="text-muted leading-relaxed mb-8">
        Receive real-time notifications when events occur. Webhooks are signed with HMAC-SHA256, automatically retried on failure, and moved to a dead-letter queue after 3 failed attempts.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="POST" path="/webhooks/register" desc="Register a webhook URL" />
        <Endpoint method="GET" path="/webhooks/registrations" desc="List registered webhooks" />
        <Endpoint method="GET" path="/webhooks/deliveries" desc="Delivery history" />
        <Endpoint method="GET" path="/webhooks/dlq" desc="Dead-letter queue" />
        <Endpoint method="POST" path="/webhooks/dlq/:id/retry" desc="Retry a failed webhook" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Register a Webhook</h2>
      <CodeBlock
        title="POST /webhooks/register"
        tabs={[
          {
            lang: "node",
            code: `await fetch("http://localhost:3000/webhooks/register", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_sandbox_...",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    url: "https://your-app.com/webhooks/payorch",
    events: ["payment.completed", "payment.failed"]
  })
});`,
          },
          {
            lang: "python",
            code: `requests.post(
    "http://localhost:3000/webhooks/register",
    headers={
        "Authorization": "Bearer sk_sandbox_...",
        "Content-Type": "application/json"
    },
    json={
        "url": "https://your-app.com/webhooks/payorch",
        "events": ["payment.completed", "payment.failed"]
    }
)`,
          },
          {
            lang: "curl",
            code: `curl -X POST http://localhost:3000/webhooks/register \\
  -H "Authorization: Bearer sk_sandbox_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-app.com/webhooks/payorch",
    "events": ["payment.completed", "payment.failed"]
  }'`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Webhook Events</h2>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Event</th>
              <th className="text-left py-3 text-muted font-medium">Triggered When</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["payment.completed", "Payment saga completed successfully"],
              ["payment.failed", "Payment saga failed (compensation may follow)"],
              ["payment.refunded", "Compensation refund issued"],
              ["fraud.blocked", "Payment blocked by fraud engine"],
              ["subscription.created", "New subscription started"],
              ["subscription.canceled", "Subscription was canceled"],
              ["dispute.created", "New dispute opened"],
              ["dispute.resolved", "Dispute resolved (won or lost)"],
            ].map(([event, desc]) => (
              <tr key={event} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{event}</InlineCode></td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Signature Verification</h2>
      <p className="text-muted leading-relaxed mb-4">
        Every webhook includes a <InlineCode>X-Webhook-Signature</InlineCode> header containing an HMAC-SHA256 signature. Always verify this signature before processing the payload.
      </p>
      <CodeBlock
        title="Verify signature"
        tabs={[
          {
            lang: "node",
            code: `const crypto = require("crypto");

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your Express handler:
app.post("/webhooks/payorch", (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const isValid = verifyWebhook(
    JSON.stringify(req.body),
    signature,
    process.env.WEBHOOK_SECRET
  );

  if (!isValid) return res.status(401).send("Invalid signature");
  // Process the event...
  res.status(200).send("OK");
});`,
          },
          {
            lang: "python",
            code: `import hmac
import hashlib

def verify_webhook(payload: str, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

# In your Flask handler:
@app.route("/webhooks/payorch", methods=["POST"])
def handle_webhook():
    signature = request.headers.get("X-Webhook-Signature")
    is_valid = verify_webhook(
        request.get_data(as_text=True),
        signature,
        os.environ["WEBHOOK_SECRET"]
    )
    if not is_valid:
        return "Invalid signature", 401
    # Process the event...
    return "OK", 200`,
          },
          {
            lang: "curl",
            code: `# Verify a signature manually:
echo -n '{"event":"payment.completed","data":{}}' | \\
  openssl dgst -sha256 -hmac "your-webhook-secret"

# Compare the output with the X-Webhook-Signature header`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Retry Behavior</h2>
      <Callout type="info">
        Webhooks that receive a non-2xx response are retried up to 3 times with exponential backoff. After 3 failures, the webhook is moved to the dead-letter queue where it can be manually retried.
      </Callout>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Attempt</th>
              <th className="text-left py-3 text-muted font-medium">Delay</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["1st retry", "~5 seconds"],
              ["2nd retry", "~25 seconds"],
              ["3rd retry", "~125 seconds"],
              ["After 3rd failure", "Moved to DLQ"],
            ].map(([attempt, delay]) => (
              <tr key={attempt} className="border-b border-card-border">
                <td className="py-3 pr-4">{attempt}</td>
                <td className="py-3 text-muted">{delay}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
