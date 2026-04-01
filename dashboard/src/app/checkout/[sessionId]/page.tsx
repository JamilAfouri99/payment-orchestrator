"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  fetchCheckoutSession,
  completeCheckoutSession,
  type CheckoutSessionRecord,
} from "@/lib/api";

// ─── Card validation helpers ─────────────────────────────────────────────────

function luhnCheck(pan: string): boolean {
  const digits = pan.replace(/\s/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function isValidExpiry(month: string, year: string): boolean {
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return false;
  const fullYear = y < 100 ? 2000 + y : y;
  const now = new Date();
  const exp = new Date(fullYear, m);
  return exp > now;
}

function isValidCvv(cvv: string): boolean {
  return /^\d{3,4}$/.test(cvv);
}

function detectCardBrand(pan: string): string {
  const d = pan.replace(/\s/g, "");
  if (/^4/.test(d)) return "visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "mastercard";
  if (/^3[47]/.test(d)) return "amex";
  if (/^6(?:011|5)/.test(d)) return "discover";
  return "unknown";
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

// ─── Types ───────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  card: "Credit / Debit Card",
  bank_transfer: "Bank Transfer",
  wallet: "Digital Wallet",
  bnpl: "Buy Now, Pay Later",
  crypto: "Cryptocurrency",
};

const METHOD_ICONS: Record<string, string> = {
  card: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  bank_transfer: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  wallet: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  bnpl: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  crypto: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
};

export default function HostedCheckoutPage() {
  const params = useParams();
  const sessionId = String(params.sessionId);

  const [session, setSession] = useState<CheckoutSessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  // Payment method selection
  const [selectedMethod, setSelectedMethod] = useState("card");

  // Card form
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpMonth, setCardExpMonth] = useState("");
  const [cardExpYear, setCardExpYear] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  // Processing
  const [processing, setProcessing] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      const data = await fetchCheckoutSession(sessionId);
      setSession(data);
      if (data.status === "complete") setCompleted(true);
      if (data.allowedPaymentMethods.length > 0) {
        setSelectedMethod(data.allowedPaymentMethods[0]!);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  const validateCard = (): boolean => {
    const errors: Record<string, string> = {};
    const pan = cardNumber.replace(/\s/g, "");

    if (!pan) {
      errors["number"] = "Card number is required";
    } else if (!luhnCheck(pan)) {
      errors["number"] = "Invalid card number";
    }

    if (!isValidExpiry(cardExpMonth, cardExpYear)) {
      errors["expiry"] = "Invalid or expired date";
    }

    if (!isValidCvv(cardCvv)) {
      errors["cvv"] = "Invalid CVV";
    }

    if (!cardName.trim()) {
      errors["name"] = "Name is required";
    }

    setCardErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePay = async () => {
    if (!session) return;

    // Validate based on method
    if (selectedMethod === "card" && !validateCard()) return;

    setProcessing(true);
    setError("");

    try {
      // Simulate a 2-second processing delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Generate a simulated payment ID
      const paymentId = `pay_sim_${Date.now().toString(36)}`;

      const result = await completeCheckoutSession(session.id, paymentId, selectedMethod);
      setSession(result);
      setCompleted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted">Loading checkout...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card border border-card-border rounded-xl p-8 max-w-md text-center">
          <div className="text-danger text-4xl mb-4">!</div>
          <h2 className="text-lg font-semibold mb-2">Session Not Found</h2>
          <p className="text-muted text-sm">{error || "This checkout session does not exist."}</p>
        </div>
      </div>
    );
  }

  if (session.status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card border border-card-border rounded-xl p-8 max-w-md text-center">
          <div className="text-warning text-4xl mb-4">&#x23F0;</div>
          <h2 className="text-lg font-semibold mb-2">Session Expired</h2>
          <p className="text-muted text-sm">This checkout session has expired. Please create a new one.</p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card border border-card-border rounded-xl p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Payment Successful</h2>
          <p className="text-muted text-sm mb-1">
            {(session.amount / 100).toFixed(2)} {session.currency} paid
          </p>
          {session.paymentId && (
            <p className="text-xs text-muted font-mono">{session.paymentId}</p>
          )}
          {session.successUrl && (
            <a href={session.successUrl} className="inline-block mt-4 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/90 transition-colors">
              Continue
            </a>
          )}
        </div>
      </div>
    );
  }

  const brand = detectCardBrand(cardNumber);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="bg-card border border-card-border rounded-t-xl p-6">
          <p className="text-xs text-muted uppercase tracking-wider">Pay</p>
          <p className="text-3xl font-bold mt-1">
            {(session.amount / 100).toFixed(2)} <span className="text-lg text-muted">{session.currency}</span>
          </p>
          {session.description && (
            <p className="text-sm text-muted mt-1">{session.description}</p>
          )}
        </div>

        {/* Line Items */}
        {session.lineItems.length > 0 && (
          <div className="bg-card border-x border-card-border px-6 py-3 space-y-1">
            {session.lineItems.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>
                  {item.name} <span className="text-muted">x{item.quantity}</span>
                </span>
                <span className="font-mono">{((item.quantity * item.unitPrice) / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Payment Method Selection */}
        <div className="bg-card border-x border-card-border px-6 py-4">
          {session.allowedPaymentMethods.length > 1 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs text-muted font-semibold">Payment Method</p>
              <div className="grid grid-cols-2 gap-2">
                {session.allowedPaymentMethods.map((method) => (
                  <button
                    key={method}
                    onClick={() => setSelectedMethod(method)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm border transition-all ${
                      selectedMethod === method
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-card-border text-muted hover:border-accent/30"
                    }`}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={METHOD_ICONS[method] ?? METHOD_ICONS["card"]!} />
                    </svg>
                    {METHOD_LABELS[method] ?? method}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Card Form */}
          {selectedMethod === "card" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted">Card Number</label>
                <div className="relative">
                  <input
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    placeholder="4242 4242 4242 4242"
                    maxLength={23}
                    className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-background border text-sm font-mono ${
                      cardErrors["number"] ? "border-danger" : "border-card-border"
                    }`}
                  />
                  {brand !== "unknown" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted uppercase mt-0.5">{brand}</span>
                  )}
                </div>
                {cardErrors["number"] && <p className="text-xs text-danger mt-1">{cardErrors["number"]}</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted">Month</label>
                  <input
                    value={cardExpMonth}
                    onChange={(e) => setCardExpMonth(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="MM"
                    maxLength={2}
                    className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-background border text-sm font-mono ${
                      cardErrors["expiry"] ? "border-danger" : "border-card-border"
                    }`}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted">Year</label>
                  <input
                    value={cardExpYear}
                    onChange={(e) => setCardExpYear(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="YY"
                    maxLength={2}
                    className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-background border text-sm font-mono ${
                      cardErrors["expiry"] ? "border-danger" : "border-card-border"
                    }`}
                  />
                  {cardErrors["expiry"] && <p className="text-xs text-danger mt-1">{cardErrors["expiry"]}</p>}
                </div>
                <div>
                  <label className="text-xs text-muted">CVV</label>
                  <input
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="123"
                    maxLength={4}
                    type="password"
                    className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-background border text-sm font-mono ${
                      cardErrors["cvv"] ? "border-danger" : "border-card-border"
                    }`}
                  />
                  {cardErrors["cvv"] && <p className="text-xs text-danger mt-1">{cardErrors["cvv"]}</p>}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted">Cardholder Name</label>
                <input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="John Doe"
                  className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-background border text-sm ${
                    cardErrors["name"] ? "border-danger" : "border-card-border"
                  }`}
                />
                {cardErrors["name"] && <p className="text-xs text-danger mt-1">{cardErrors["name"]}</p>}
              </div>
            </div>
          )}

          {/* Non-card methods: simplified UI */}
          {selectedMethod === "bank_transfer" && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 text-sm text-center">
              <p className="font-medium">Bank Transfer</p>
              <p className="text-muted text-xs mt-1">You will be redirected to your bank to complete the payment.</p>
            </div>
          )}

          {selectedMethod === "wallet" && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 text-sm text-center">
              <p className="font-medium">Digital Wallet</p>
              <p className="text-muted text-xs mt-1">Pay instantly with Apple Pay, Google Pay, or PayPal.</p>
            </div>
          )}

          {selectedMethod === "bnpl" && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 text-sm text-center">
              <p className="font-medium">Buy Now, Pay Later</p>
              <p className="text-muted text-xs mt-1">
                Split into installments with Klarna, Afterpay, or Affirm.
                {session.amount >= 5000 && session.amount <= 25000 && " 4 installments available."}
                {session.amount > 25000 && session.amount <= 50000 && " 6 installments available."}
                {session.amount > 50000 && session.amount <= 100000 && " 12 installments available."}
              </p>
            </div>
          )}

          {selectedMethod === "crypto" && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 text-sm text-center">
              <p className="font-medium">Cryptocurrency</p>
              <p className="text-muted text-xs mt-1">Pay with BTC, ETH, or USDC from your wallet.</p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-card border-x border-card-border px-6 py-2">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        {/* Pay Button */}
        <div className="bg-card border border-card-border rounded-b-xl px-6 py-4">
          <button
            onClick={handlePay}
            disabled={processing}
            className="w-full py-3 bg-accent text-white rounded-lg font-medium text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {processing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>Pay {(session.amount / 100).toFixed(2)} {session.currency}</>
            )}
          </button>
          {session.cancelUrl && (
            <a
              href={session.cancelUrl}
              className="block text-center text-xs text-muted mt-3 hover:text-foreground transition-colors"
            >
              Cancel
            </a>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted mt-4">
          Secured by Payment Orchestrator
        </p>
      </div>
    </div>
  );
}
