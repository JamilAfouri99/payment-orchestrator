"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  register,
  setToken,
  submitKyb,
  getKybStatus,
  configureOnboarding,
  goLive,
  type KybApplication,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const STEPS = [
  "Create Account",
  "Business Verification",
  "Payment Configuration",
  "Go Live",
];

const COUNTRIES = [
  "US", "GB", "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK",
  "AU", "CA", "SG", "JP", "AE", "JO",
];

const BUSINESS_TYPES = [
  { value: "sole_proprietor", label: "Sole Proprietor" },
  { value: "partnership", label: "Partnership" },
  { value: "llc", label: "LLC" },
  { value: "corporation", label: "Corporation" },
];

const FRAUD_SENSITIVITY_OPTIONS = [
  {
    value: "low",
    label: "Low",
    description: "Fewer declines, higher fraud risk. Best for low-risk merchants.",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced approach. Recommended for most businesses.",
  },
  {
    value: "high",
    label: "High",
    description: "Aggressive blocking. Best for high-risk or regulated industries.",
  },
];

const CURRENCIES = ["USD", "EUR", "GBP"];
const PAYOUT_SCHEDULES = ["daily", "weekly", "monthly"];

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-accent">Payment</span> Orchestrator
          </h1>
          <p className="text-muted text-sm mt-1">
            Get started in a few simple steps
          </p>
        </div>

        <ProgressBar current={step} total={STEPS.length} labels={STEPS} />

        <div className="mt-8">
          {step === 0 && (
            <StepCreateAccount onSuccess={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepBusinessVerification onSuccess={() => setStep(2)} />
          )}
          {step === 2 && (
            <StepPaymentConfig onSuccess={() => setStep(3)} />
          )}
          {step === 3 && (
            <StepGoLive
              onSuccess={async () => {
                await refresh();
                router.replace("/");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: string[];
}) {
  return (
    <div className="flex items-start gap-0">
      {labels.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center">
          <div className="flex items-center w-full">
            {i > 0 && (
              <div
                className={`flex-1 h-0.5 ${
                  i <= current ? "bg-accent" : "bg-card-border"
                }`}
              />
            )}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                i < current
                  ? "bg-accent border-accent text-white"
                  : i === current
                  ? "bg-background border-accent text-accent"
                  : "bg-background border-card-border text-muted"
              }`}
            >
              {i < current ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            {i < total - 1 && (
              <div
                className={`flex-1 h-0.5 ${
                  i < current ? "bg-accent" : "bg-card-border"
                }`}
              />
            )}
          </div>
          <span
            className={`text-xs mt-2 text-center ${
              i === current ? "text-foreground font-medium" : "text-muted"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Create Account ───────────────────────────────────────────────────

function StepCreateAccount({ onSuccess }: { onSuccess: () => void }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [country, setCountry] = useState("US");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from company name
  useEffect(() => {
    setSlug(
      companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    );
  }, [companyName]);

  function validate(): string | null {
    if (!name.trim()) return "Full name is required";
    if (!email.trim()) return "Email is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (!companyName.trim()) return "Company name is required";
    if (!slug.trim()) return "URL slug is required";
    if (!/^[a-z0-9-]+$/.test(slug))
      return "Slug must contain only lowercase letters, numbers, and hyphens";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await register(
        email.trim(),
        password,
        name.trim(),
        companyName.trim(),
        slug.trim(),
        country,
      );
      setToken(res.token);
      await refresh();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepCard title="Create your account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.com"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field label="Password (min 8 characters)">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Company name">
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="URL slug">
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-corp"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Country">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={INPUT_CLASS}
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorMessage message={error} />

        <button
          type="submit"
          disabled={loading}
          className={PRIMARY_BTN}
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </StepCard>
  );
}

// ─── Step 2: Business Verification ───────────────────────────────────────────

function StepBusinessVerification({ onSuccess }: { onSuccess: () => void }) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("llc");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxId, setTaxId] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("US");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [repName, setRepName] = useState("");
  const [repDob, setRepDob] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [kybStatus, setKybStatus] = useState<KybApplication | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) {
      setError("Business name is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const app = await submitKyb({
        businessName: businessName.trim(),
        businessType,
        registrationNumber: registrationNumber.trim() || undefined,
        taxId: taxId.trim() || undefined,
        website: website.trim() || undefined,
        country,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        representativeName: repName.trim() || undefined,
        representativeDob: repDob || undefined,
      });
      setKybStatus(app);
      setSubmitted(true);

      // Poll every 3s for status changes
      pollRef.current = setInterval(async () => {
        try {
          const status = await getKybStatus();
          if (status) setKybStatus(status);
          if (status?.status === "approved") stopPolling();
        } catch {
          // Ignore poll errors
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <StepCard title="Business Verification">
        {kybStatus?.status === "approved" ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/15 border border-success/30 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-success">Verification Approved</p>
              <p className="text-sm text-muted mt-1">
                Your business has been verified successfully.
              </p>
            </div>
            <button onClick={onSuccess} className={PRIMARY_BTN}>
              Continue
            </button>
          </div>
        ) : (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-warning/15 border border-warning/30 flex items-center justify-center mx-auto">
              <div className="w-4 h-4 rounded-full bg-warning animate-pulse" />
            </div>
            <div>
              <p className="font-semibold text-warning">Under Review</p>
              <p className="text-sm text-muted mt-1">
                We&apos;re reviewing your submission. This usually takes a few
                moments in test mode.
              </p>
            </div>
            <p className="text-xs text-muted font-mono">
              Application ID: {kybStatus?.id}
            </p>
          </div>
        )}
      </StepCard>
    );
  }

  return (
    <StepCard title="Business Verification">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business name *">
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Acme Corp Ltd"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Business type">
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className={INPUT_CLASS}
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Registration number (optional)">
            <input
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="12345678"
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Tax ID (optional)">
            <input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="XX-XXXXXXX"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field label="Website (optional)">
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://acme.com"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Country">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={INPUT_CLASS}
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone (optional)">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field label="Business address (optional)">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, New York, NY 10001"
            className={INPUT_CLASS}
          />
        </Field>

        <div className="border-t border-card-border pt-4">
          <p className="text-xs text-muted mb-3 uppercase tracking-wider">
            Representative
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name (optional)">
              <input
                type="text"
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder="Jane Smith"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Date of birth (optional)">
              <input
                type="date"
                value={repDob}
                onChange={(e) => setRepDob(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </div>

        <ErrorMessage message={error} />

        <button type="submit" disabled={loading} className={PRIMARY_BTN}>
          {loading ? "Submitting..." : "Submit for Verification"}
        </button>
      </form>
    </StepCard>
  );
}

// ─── Step 3: Payment Configuration ───────────────────────────────────────────

function StepPaymentConfig({ onSuccess }: { onSuccess: () => void }) {
  const [fraudSensitivity, setFraudSensitivity] = useState("medium");
  const [settlementCurrency, setSettlementCurrency] = useState("USD");
  const [payoutSchedule, setPayoutSchedule] = useState("weekly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await configureOnboarding({
        fraudSensitivity,
        settlementCurrency,
        payoutSchedule,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Configuration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepCard title="Payment Configuration">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-xs text-muted mb-3 uppercase tracking-wider">
            Fraud sensitivity
          </label>
          <div className="space-y-3">
            {FRAUD_SENSITIVITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  fraudSensitivity === opt.value
                    ? "border-accent bg-accent/5"
                    : "border-card-border hover:border-accent/50"
                }`}
              >
                <input
                  type="radio"
                  name="fraudSensitivity"
                  value={opt.value}
                  checked={fraudSensitivity === opt.value}
                  onChange={(e) => setFraudSensitivity(e.target.value)}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Settlement currency">
            <select
              value={settlementCurrency}
              onChange={(e) => setSettlementCurrency(e.target.value)}
              className={INPUT_CLASS}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payout schedule">
            <select
              value={payoutSchedule}
              onChange={(e) => setPayoutSchedule(e.target.value)}
              className={INPUT_CLASS}
            >
              {PAYOUT_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorMessage message={error} />

        <button type="submit" disabled={loading} className={PRIMARY_BTN}>
          {loading ? "Saving..." : "Save Configuration"}
        </button>
      </form>
    </StepCard>
  );
}

// ─── Step 4: Go Live ──────────────────────────────────────────────────────────

function StepGoLive({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productionKey, setProductionKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGoLive() {
    setLoading(true);
    setError(null);
    try {
      const res = await goLive();
      setProductionKey(res.apiKey.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to go live");
    } finally {
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!productionKey) return;
    await navigator.clipboard.writeText(productionKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const curlExample = productionKey
    ? `curl -X POST https://api.paymentorchestrator.com/payments \\
  -H "Authorization: Bearer ${productionKey}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customerId": "cust_123",
    "orderId": "order_456",
    "items": [{"productId": "prod_1","quantity": 1,"pricePerUnit": 5000}]
  }'`
    : "";

  return (
    <StepCard title="Go Live">
      {!productionKey ? (
        <div className="space-y-6">
          <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 text-sm text-muted">
            You&apos;re ready to generate your production API keys and start
            accepting live payments. This step is irreversible.
          </div>

          <ErrorMessage message={error} />

          <button
            onClick={handleGoLive}
            disabled={loading}
            className={PRIMARY_BTN}
          >
            {loading ? "Generating keys..." : "Generate Production Keys"}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 text-sm text-warning flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>
              This key will only be shown <strong>once</strong>. Copy it now and
              store it securely.
            </span>
          </div>

          <div>
            <p className="text-xs text-muted mb-2">Production API Key</p>
            <div className="flex items-center gap-2 bg-background border border-accent/40 rounded-lg px-4 py-3">
              <span className="flex-1 font-mono text-xs text-accent break-all">
                {productionKey}
              </span>
              <button
                onClick={copyKey}
                className="shrink-0 text-muted hover:text-foreground transition-colors"
                title="Copy key"
              >
                {copied ? (
                  <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted mb-2 uppercase tracking-wider">
              Quickstart
            </p>
            <pre className="bg-background border border-card-border rounded-lg px-4 py-3 text-xs font-mono text-muted overflow-x-auto whitespace-pre-wrap">
              {curlExample}
            </pre>
          </div>

          <button onClick={onSuccess} className={PRIMARY_BTN}>
            Go to Dashboard
          </button>
        </div>
      )}
    </StepCard>
  );
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

const INPUT_CLASS =
  "w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors";

const PRIMARY_BTN =
  "w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function StepCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-8">
      <h2 className="text-lg font-semibold mb-6">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}
