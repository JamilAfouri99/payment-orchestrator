"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchTokens,
  revokeToken,
  type TokenRecord,
} from "@/lib/api";

const TOKEN_STATUS_STYLES: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  expired: "bg-warning/15 text-warning border-warning/30",
  revoked: "bg-danger/15 text-danger border-danger/30",
};

const BRAND_COLORS: Record<string, string> = {
  visa: "bg-blue-500/10 text-blue-400",
  mastercard: "bg-orange-500/10 text-orange-400",
  amex: "bg-green-500/10 text-green-400",
  discover: "bg-yellow-500/10 text-yellow-400",
  unionpay: "bg-red-500/10 text-red-400",
};

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchTokens(customerFilter || undefined);
      setTokens(data.tokens);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, [customerFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleRevoke(token: string) {
    setRevoking(token);
    try {
      await revokeToken(token);
      // Update local state immediately — avoids a full re-fetch
      setTokens((prev) =>
        prev.map((t) => (t.token === token ? { ...t, status: "revoked" } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevoking(null);
    }
  }

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCustomerFilter(filterInput.trim());
  }

  function formatToken(token: string): string {
    // Show first 8 chars and last 4, mask the middle
    if (token.length <= 16) return token;
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }

  function formatExpiry(month: number, year: number): string {
    return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
  }

  const activeCount = tokens.filter((t) => t.status === "active").length;
  const expiredCount = tokens.filter((t) => t.status === "expired").length;
  const revokedCount = tokens.filter((t) => t.status === "revoked").length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Token Vault</h2>
        <p className="text-muted text-sm mt-1">
          Manage tokenized payment instruments — no raw card data stored
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Active" count={activeCount} color="text-success" />
        <StatCard label="Expired" count={expiredCount} color="text-warning" />
        <StatCard label="Revoked" count={revokedCount} color="text-danger" />
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => { setError(null); load(); }}
            className="text-xs underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Customer filter */}
      <form onSubmit={handleFilterSubmit} className="flex gap-3">
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="Filter by customer ID..."
          className="flex-1 max-w-xs bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-card border border-card-border text-sm text-muted hover:text-foreground transition-colors"
        >
          Filter
        </button>
        {customerFilter && (
          <button
            type="button"
            onClick={() => { setFilterInput(""); setCustomerFilter(""); }}
            className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {customerFilter && (
        <p className="text-xs text-muted -mt-4">
          Showing tokens for customer: <span className="font-mono text-foreground">{customerFilter}</span>
        </p>
      )}

      {/* Tokens table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-card-border">
          <h3 className="font-semibold">Tokens</h3>
          <p className="text-xs text-muted mt-0.5">
            {loading ? "Loading..." : `${tokens.length} token${tokens.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted text-sm animate-pulse">
            Loading tokens...
          </div>
        ) : tokens.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No tokens found{customerFilter ? " for this customer" : ""}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-card-border">
                  <th className="px-5 py-3 font-medium">Token</th>
                  <th className="px-5 py-3 font-medium">Card</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Uses</th>
                  <th className="px-5 py-3 font-medium">Expires</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr
                    key={token.token}
                    className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs text-muted">
                        {formatToken(token.token)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            BRAND_COLORS[token.brand.toLowerCase()] ??
                            "bg-muted/10 text-muted"
                          }`}
                        >
                          {token.brand.toUpperCase()}
                        </span>
                        <span className="font-mono text-xs text-muted">
                          •••• {token.last4}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs">{token.customerId}</span>
                    </td>
                    <td className="px-5 py-3">
                      <TokenStatusBadge status={token.status} />
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs text-muted">
                      {token.usageCount}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs text-muted">
                        {formatExpiry(token.expiryMonth, token.expiryYear)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-muted">
                        {new Date(token.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {token.status === "active" && (
                        <button
                          onClick={() => handleRevoke(token.token)}
                          disabled={revoking === token.token}
                          className="px-3 py-1 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {revoking === token.token ? "Revoking..." : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PCI compliance note */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-accent mb-2">PCI DSS Tokenization</h3>
        <p className="text-sm text-muted leading-relaxed">
          Raw card numbers are never stored. Each card is replaced with an opaque token at the point
          of capture. Tokens can be used for recurring charges without re-entering card details.
          Revoking a token immediately prevents any future charges, including scheduled ones.
        </p>
      </div>
    </div>
  );
}

function TokenStatusBadge({ status }: { status: string }) {
  const style =
    TOKEN_STATUS_STYLES[status.toLowerCase()] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-xs text-muted uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
    </div>
  );
}
