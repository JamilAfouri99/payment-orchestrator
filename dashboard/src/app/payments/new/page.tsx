"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LineItem {
  productId: string;
  quantity: number;
  pricePerUnit: number;
}

export default function NewPaymentPage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("cust_123");
  const [orderId, setOrderId] = useState(`ord_${Date.now()}`);
  const [currency, setCurrency] = useState("USD");
  const [items, setItems] = useState<LineItem[]>([
    { productId: "prod_1", quantity: 2, pricePerUnit: 2500 },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.pricePerUnit, 0);

  function addItem() {
    setItems([...items, { productId: "", quantity: 1, pricePerUnit: 0 }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof LineItem, value: string | number) {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const key = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          amount: totalAmount,
          currency,
          customerId,
          orderId,
          items,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Payment failed");
      router.push(`/payments/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Create Payment</h2>
        <p className="text-muted text-sm mt-1">
          This triggers the full saga: validate &rarr; reserve inventory &rarr; charge &rarr; notify
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted">Customer Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer ID" value={customerId} onChange={setCustomerId} />
            <Field label="Order ID" value={orderId} onChange={setOrderId} />
          </div>
          <div className="w-32">
            <Field label="Currency" value={currency} onChange={setCurrency} />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted">Line Items</h3>
            <button
              type="button"
              onClick={addItem}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              + Add Item
            </button>
          </div>

          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-4">
                <label className="block text-xs text-muted mb-1">Product ID</label>
                <input
                  value={item.productId}
                  onChange={(e) => updateItem(i, "productId", e.target.value)}
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-muted mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(i, "quantity", parseInt(e.target.value) || 0)}
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-muted mb-1">Price (cents)</label>
                <input
                  type="number"
                  min={0}
                  value={item.pricePerUnit}
                  onChange={(e) => updateItem(i, "pricePerUnit", parseInt(e.target.value) || 0)}
                  className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div className="col-span-2 text-right text-sm font-mono">
                ${((item.quantity * item.pricePerUnit) / 100).toFixed(2)}
              </div>
              <div className="col-span-1">
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="text-danger/60 hover:text-danger text-sm transition-colors"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="border-t border-card-border pt-4 flex justify-end">
            <div className="text-right">
              <p className="text-xs text-muted">Total Amount</p>
              <p className="text-2xl font-bold">${(totalAmount / 100).toFixed(2)} <span className="text-sm text-muted">{currency}</span></p>
              <p className="text-xs text-muted font-mono">{totalAmount} cents</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={loading || totalAmount <= 0}
            className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Running Saga..." : "Create Payment"}
          </button>
          <p className="text-xs text-muted">
            A unique Idempotency-Key is generated automatically per submission.
          </p>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
      />
    </div>
  );
}
