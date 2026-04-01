"use client";

import { CodeBlock, InlineCode, Callout, Endpoint } from "@/components/code-block";

export default function AuthenticationPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight mb-3">Authentication</h1>
      <p className="text-muted leading-relaxed mb-8">
        All API requests require a valid API key passed in the <InlineCode>Authorization</InlineCode> header using the Bearer scheme.
      </p>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">API Key Types</h2>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Prefix</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Environment</th>
              <th className="text-left py-3 text-muted font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-card-border">
              <td className="py-3 pr-4"><InlineCode>sk_sandbox_</InlineCode></td>
              <td className="py-3 pr-4">Sandbox</td>
              <td className="py-3 text-muted">Test environment — no real charges</td>
            </tr>
            <tr className="border-b border-card-border">
              <td className="py-3 pr-4"><InlineCode>sk_live_</InlineCode></td>
              <td className="py-3 pr-4">Production</td>
              <td className="py-3 text-muted">Live environment — real charges</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Making Authenticated Requests</h2>
      <CodeBlock
        title="Authorization header"
        tabs={[
          {
            lang: "node",
            code: `const response = await fetch("http://localhost:3000/payments", {
  headers: {
    "Authorization": "Bearer sk_sandbox_your_key",
    "Content-Type": "application/json"
  }
});`,
          },
          {
            lang: "python",
            code: `import requests

response = requests.get(
    "http://localhost:3000/payments",
    headers={
        "Authorization": "Bearer sk_sandbox_your_key",
        "Content-Type": "application/json"
    }
)`,
          },
          {
            lang: "curl",
            code: `curl http://localhost:3000/payments \\
  -H "Authorization: Bearer sk_sandbox_your_key"`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Permission Scopes</h2>
      <p className="text-muted leading-relaxed mb-4">
        API keys are created with specific permission scopes that control what operations they can perform.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Scope</th>
              <th className="text-left py-3 text-muted font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["*", "Full access to all resources"],
              ["payments:*", "Read and write payments"],
              ["payments:read", "Read-only access to payments"],
              ["payments:write", "Create and modify payments"],
              ["webhooks:*", "Manage webhook registrations"],
              ["fraud:*", "Configure fraud rules"],
              ["admin:*", "Administrative operations"],
            ].map(([scope, desc]) => (
              <tr key={scope} className="border-b border-card-border">
                <td className="py-3 pr-4"><InlineCode>{scope}</InlineCode></td>
                <td className="py-3 text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Rate Limits</h2>
      <p className="text-muted leading-relaxed mb-4">
        API requests are rate limited per API key. The current limits are returned in response headers.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left py-3 pr-4 text-muted font-medium">Plan</th>
              <th className="text-left py-3 pr-4 text-muted font-medium">Requests/min</th>
              <th className="text-left py-3 text-muted font-medium">Burst</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Free", "60", "10"],
              ["Starter", "300", "50"],
              ["Growth", "1,000", "100"],
              ["Enterprise", "Custom", "Custom"],
            ].map(([plan, rpm, burst]) => (
              <tr key={plan} className="border-b border-card-border">
                <td className="py-3 pr-4">{plan}</td>
                <td className="py-3 pr-4 text-muted">{rpm}</td>
                <td className="py-3 text-muted">{burst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Callout type="info">
        Rate limit headers: <InlineCode>X-RateLimit-Limit</InlineCode>, <InlineCode>X-RateLimit-Remaining</InlineCode>, <InlineCode>X-RateLimit-Reset</InlineCode>
      </Callout>

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Error Responses</h2>
      <p className="text-muted leading-relaxed mb-4">
        Authentication errors return RFC 7807 Problem Details responses:
      </p>
      <CodeBlock
        title="401 Unauthorized"
        tabs={[
          {
            lang: "node",
            code: `{
  "type": "https://payment-orchestrator.dev/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid API key"
}`,
          },
        ]}
      />

      <h2 className="font-display text-xl font-semibold mt-10 mb-4">Auth Endpoints</h2>
      <div className="border border-card-border rounded-lg px-4 mb-4">
        <Endpoint method="POST" path="/api/auth/register" desc="Create a new tenant and user account" />
        <Endpoint method="POST" path="/api/auth/login" desc="Authenticate with email and password" />
        <Endpoint method="GET" path="/api/auth/me" desc="Get current user and tenant details" />
      </div>
    </div>
  );
}
