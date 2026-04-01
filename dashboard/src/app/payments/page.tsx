"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchPayments, type PaymentState } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";

const PAGE_SIZE = 20;

export default function PaymentsListPage() {
  const [payments, setPayments] = useState<PaymentState[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (currentOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPayments(PAGE_SIZE, currentOffset);
      setPayments(data.payments);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(offset);
  }, [offset, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Payments</h2>
          <p className="text-muted text-sm mt-1">
            {total} total payment{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/payments/new"
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          New Payment
        </Link>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Currency</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Order</th>
              <th className="px-5 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-muted animate-pulse">
                  Loading payments...
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-muted">
                  No payments found. Create one to get started.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id} className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors">
                  <td className="px-5 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/payments/${p.id}`}
                      className="font-mono text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      {p.id.slice(0, 12)}...
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right font-mono">
                    ${(p.amount / 100).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-muted">{p.currency}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.customerId}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.orderId}</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-4 py-2 rounded-lg bg-card border border-card-border text-sm text-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-4 py-2 rounded-lg bg-card border border-card-border text-sm text-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
