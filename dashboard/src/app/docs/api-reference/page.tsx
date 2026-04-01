"use client";

import { InlineCode, Endpoint, Callout } from "@/components/code-block";
import Link from "next/link";

export default function ApiReferencePage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">API Reference</h1>
      <p className="text-muted leading-relaxed mb-8">
        Complete list of all REST and GraphQL endpoints. All requests require authentication via Bearer token in the <InlineCode>Authorization</InlineCode> header.
      </p>

      <Callout type="tip">
        Interactive GraphQL playground is available at <InlineCode>/graphql</InlineCode> when the API server is running.
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Payments</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/health" desc="Liveness check" />
        <Endpoint method="GET" path="/health/ready" desc="Readiness check with subsystem status" />
        <Endpoint method="GET" path="/health/metrics" desc="Prometheus metrics endpoint" />
        <Endpoint method="POST" path="/payments" desc="Create a payment (requires Idempotency-Key)" />
        <Endpoint method="GET" path="/payments" desc="List payments (paginated)" />
        <Endpoint method="GET" path="/payments/:id" desc="Get payment state" />
        <Endpoint method="GET" path="/payments/:id/events" desc="Event history" />
        <Endpoint method="GET" path="/payments/:id/state?at=" desc="Temporal state query" />
        <Endpoint method="POST" path="/payments/:id/replay" desc="Rebuild state from events" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Webhooks</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="POST" path="/webhooks/register" desc="Register a callback URL" />
        <Endpoint method="GET" path="/webhooks/registrations" desc="List registrations" />
        <Endpoint method="GET" path="/webhooks/deliveries" desc="Delivery history" />
        <Endpoint method="GET" path="/webhooks/dlq" desc="Dead-letter queue" />
        <Endpoint method="POST" path="/webhooks/dlq/:id/retry" desc="Retry DLQ entry" />
        <Endpoint method="POST" path="/webhooks/verify" desc="HMAC signature verification" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Providers</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/providers" desc="All providers with config and CB state" />
        <Endpoint method="GET" path="/admin/providers/:name/metrics" desc="Per-provider performance stats" />
        <Endpoint method="GET" path="/admin/providers/metrics" desc="All provider stats" />
        <Endpoint method="GET" path="/admin/routing/simulate" desc="Simulate routing decision" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Chaos &amp; Resilience</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/chaos" desc="Read chaos configuration" />
        <Endpoint method="POST" path="/admin/chaos" desc="Update chaos configuration" />
        <Endpoint method="POST" path="/admin/chaos/reset" desc="Reset chaos to defaults" />
        <Endpoint method="GET" path="/admin/circuit-breakers" desc="All circuit breaker states" />
        <Endpoint method="POST" path="/admin/circuit-breakers/:name/reset" desc="Reset a breaker" />
        <Endpoint method="GET" path="/admin/bulkheads" desc="Concurrency stats" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Fraud</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/fraud/rules" desc="List fraud rules" />
        <Endpoint method="POST" path="/admin/fraud/rules" desc="Create a rule" />
        <Endpoint method="PUT" path="/admin/fraud/rules/:id" desc="Update a rule" />
        <Endpoint method="DELETE" path="/admin/fraud/rules/:id" desc="Delete a rule" />
        <Endpoint method="POST" path="/admin/fraud/simulate" desc="Simulate fraud scoring" />
        <Endpoint method="GET" path="/payments/:id/fraud" desc="Payment fraud evaluation" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Tokens &amp; FX</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/tokens" desc="List payment tokens" />
        <Endpoint method="GET" path="/tokens/:token" desc="Token details" />
        <Endpoint method="POST" path="/tokens/revoke/:token" desc="Revoke a token" />
        <Endpoint method="GET" path="/admin/fx/rates" desc="Read FX rates" />
        <Endpoint method="POST" path="/admin/fx/rates" desc="Update FX rates" />
        <Endpoint method="GET" path="/admin/decline-codes" desc="List decline codes" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Observability</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/metrics" desc="Counters and histograms" />
        <Endpoint method="POST" path="/admin/metrics/reset" desc="Reset metrics" />
        <Endpoint method="GET" path="/admin/logs" desc="Recent structured logs" />
        <Endpoint method="POST" path="/admin/saga-recovery" desc="Trigger recovery scan" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Admin &mdash; Queues</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="GET" path="/admin/queues" desc="All queue stats" />
        <Endpoint method="GET" path="/admin/queues/:name" desc="Queue detail" />
        <Endpoint method="GET" path="/admin/queues/:name/failed" desc="Failed jobs" />
        <Endpoint method="POST" path="/admin/queues/:name/retry/:jobId" desc="Retry a failed job" />
        <Endpoint method="POST" path="/admin/queues/:name/drain" desc="Drain a queue" />
        <Endpoint method="POST" path="/admin/queues/:name/pause" desc="Pause a queue" />
        <Endpoint method="POST" path="/admin/queues/:name/resume" desc="Resume a queue" />
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">GraphQL</h2>
      <div className="border border-card-border rounded-lg p-4 mb-8">
        <p className="text-sm text-muted mb-3">
          Available at <InlineCode>POST /graphql</InlineCode> (queries/mutations) and <InlineCode>GET /graphql</InlineCode> (GraphiQL playground).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <h4 className="text-xs font-medium text-muted uppercase mb-2">Queries</h4>
            <ul className="text-sm space-y-1">
              {["payment", "payments", "paymentEvents", "providers", "fraudRules", "fxRates", "declineCodes", "metrics"].map((q) => (
                <li key={q}><InlineCode>{q}</InlineCode></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-medium text-muted uppercase mb-2">Mutations</h4>
            <ul className="text-sm space-y-1">
              {["createPayment", "registerWebhook", "upsertFraudRule", "deleteFraudRule", "updateChaos", "revokeToken", "updateFxRate"].map((m) => (
                <li key={m}><InlineCode>{m}</InlineCode></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-medium text-muted uppercase mb-2">Subscriptions</h4>
            <ul className="text-sm space-y-1">
              <li><InlineCode>paymentStatusChanged</InlineCode></li>
            </ul>
          </div>
        </div>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Auth</h2>
      <div className="border border-card-border rounded-lg px-4 mb-8">
        <Endpoint method="POST" path="/api/auth/register" desc="Create tenant and user" />
        <Endpoint method="POST" path="/api/auth/login" desc="Authenticate" />
        <Endpoint method="GET" path="/api/auth/me" desc="Current user and tenant" />
      </div>

      <div className="mt-10 p-6 rounded-xl border border-card-border bg-card/50 text-center">
        <h3 className="font-display font-semibold mb-2">Need help?</h3>
        <p className="text-sm text-muted mb-4">
          Check the <Link href="/docs" className="text-accent hover:text-accent-hover">Quick Start guide</Link> or explore the interactive <Link href="/sandbox" className="text-accent hover:text-accent-hover">Sandbox</Link>.
        </p>
      </div>
    </div>
  );
}
