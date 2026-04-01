"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

/* ---------- dark / light toggle ---------- */
function useTheme() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("landing-theme");
    if (stored === "light") setDark(false);
    else if (stored === "dark") setDark(true);
    else if (window.matchMedia("(prefers-color-scheme: light)").matches) setDark(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.remove("light");
    } else {
      root.classList.add("light");
    }
    localStorage.setItem("landing-theme", dark ? "dark" : "light");
    return () => { root.classList.remove("light"); };
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

/* ---------- intersection observer for fade-in ---------- */
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) { el.classList.add("visible"); io.unobserve(el); } },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}

function Section({ children, className = "", stagger = false }: { children: React.ReactNode; className?: string; stagger?: boolean }) {
  const ref = useFadeIn();
  return (
    <div ref={ref} className={`${stagger ? "stagger-children" : "fade-in-section"} ${className}`}>
      {children}
    </div>
  );
}

/* ---------- constants ---------- */
const FEATURES = [
  {
    title: "Multi-Provider Routing",
    desc: "Automatically route payments to the best provider based on cost, success rate, and region. Failover in milliseconds when a provider goes down.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    title: "Fraud Scoring",
    desc: "Rule-based fraud engine evaluates velocity, amount anomalies, geo mismatches, and customer risk before any charge is attempted.",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    title: "Smart Retries",
    desc: "Decline code analysis classifies failures as hard, soft, or retriable. Automatic retry with exponential backoff routes to alternate providers.",
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  },
  {
    title: "Subscription Billing",
    desc: "Plan-based recurring billing with dunning management, grace periods, automatic retries, and configurable retry schedules.",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    title: "Split Payments",
    desc: "Marketplace-ready payment splitting with configurable payout schedules, hold periods, and automatic settlement calculations.",
    icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  },
  {
    title: "Real-time Analytics",
    desc: "Live dashboards with provider performance, transaction volume, success rates, latency percentiles, and queue depth monitoring.",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
];

const STEPS = [
  { num: "01", title: "Integrate", desc: "Add a single API call to start processing payments. Get your API key and make your first test charge in under 5 minutes." },
  { num: "02", title: "Configure", desc: "Set up routing rules, fraud thresholds, webhook endpoints, and retry strategies through the dashboard or API." },
  { num: "03", title: "Optimize", desc: "Monitor real-time analytics, tune provider weights, adjust fraud sensitivity, and maximize your approval rate." },
];

const PRICING = [
  { name: "Free", price: "$0", period: "/mo", desc: "For prototyping and testing", txn: "100 transactions/mo", features: ["Sandbox environment", "1 API key", "Community support", "Basic analytics"] },
  { name: "Starter", price: "$49", period: "/mo", desc: "For early-stage businesses", txn: "1,000 transactions/mo", features: ["Production environment", "5 API keys", "Email support", "Fraud scoring", "Webhook delivery"], popular: false },
  { name: "Growth", price: "$199", period: "/mo", desc: "For scaling companies", txn: "10,000 transactions/mo", features: ["Multi-provider routing", "Unlimited API keys", "Priority support", "Advanced analytics", "Custom fraud rules", "Split payments"], popular: true },
  { name: "Enterprise", price: "Custom", period: "", desc: "For large-scale operations", txn: "Unlimited transactions", features: ["Dedicated support", "SLA guarantee", "Custom integrations", "On-premise option", "Compliance audit", "Volume discounts"] },
];

const LOGOS = [
  { name: "Acme Corp", w: 120 },
  { name: "Globex", w: 100 },
  { name: "Initech", w: 110 },
  { name: "Umbrella", w: 115 },
  { name: "Stark", w: 90 },
  { name: "Wayne", w: 105 },
];

/* ---------- sub-components ---------- */

function Navbar({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/80 backdrop-blur-xl border-b border-card-border" : ""}`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/landing" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="font-display font-bold text-lg tracking-tight">PayOrch</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-muted hover:text-foreground transition-colors">Features</a>
          <a href="#pricing" className="text-sm text-muted hover:text-foreground transition-colors">Pricing</a>
          <Link href="/docs" className="text-sm text-muted hover:text-foreground transition-colors">Docs</Link>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className="w-9 h-9 rounded-lg border border-card-border flex items-center justify-center text-muted hover:text-foreground hover:border-foreground/20 transition-colors"
            aria-label="Toggle theme"
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>
          <Link href="/login" className="hidden sm:inline-flex text-sm text-muted hover:text-foreground transition-colors px-3 py-2">
            Sign In
          </Link>
          <Link href="/onboarding" className="inline-flex items-center px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors">
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}

function FeatureCard({ title, desc, icon }: { title: string; desc: string; icon: string }) {
  return (
    <div className="group p-6 rounded-xl border border-card-border bg-card/50 hover:border-accent/30 hover:bg-card transition-all duration-200">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
        <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <h3 className="font-display font-semibold text-base mb-2">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{desc}</p>
    </div>
  );
}

function PricingCard({ name, price, period, desc, txn, features, popular }: (typeof PRICING)[number]) {
  return (
    <div className={`pricing-card relative p-6 rounded-xl border ${popular ? "border-accent bg-accent/5" : "border-card-border bg-card/50"}`}>
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-accent text-white text-xs font-medium">
          Most Popular
        </div>
      )}
      <div className="mb-4">
        <h3 className="font-display font-semibold text-lg">{name}</h3>
        <p className="text-sm text-muted mt-1">{desc}</p>
      </div>
      <div className="mb-4">
        <span className="font-display text-3xl font-bold">{price}</span>
        <span className="text-muted text-sm">{period}</span>
      </div>
      <p className="text-sm text-accent font-medium mb-5">{txn}</p>
      <ul className="space-y-2.5 mb-6">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-muted">
            <svg className="w-4 h-4 text-success mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <Link
        href={name === "Enterprise" ? "/docs" : "/onboarding"}
        className={`block text-center py-2.5 rounded-lg text-sm font-medium transition-colors ${popular ? "bg-accent text-white hover:bg-accent-hover" : "border border-card-border text-foreground hover:bg-card-border/50"}`}
      >
        {name === "Enterprise" ? "Contact Sales" : "Start Free Trial"}
      </Link>
    </div>
  );
}

function CodeExample({ dark }: { dark: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(() => {
    const raw = `curl -X POST https://api.payorch.dev/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "amount": 4999,
    "currency": "USD",
    "customer": "cus_abc123",
    "description": "Pro plan subscription",
    "metadata": { "plan": "growth" }
  }'`;
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="browser-frame border border-card-border">
      <div className={`flex items-center gap-2 px-4 py-3 ${dark ? "bg-[#0d1117]" : "bg-gray-100"} border-b border-card-border`}>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center text-xs text-muted">POST /v1/payments</div>
        <button onClick={copyCode} className="text-muted hover:text-foreground transition-colors" title="Copy">
          {copied ? (
            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
          )}
        </button>
      </div>
      <div className={`p-5 ${dark ? "bg-[#0d1117]" : "bg-white"} overflow-x-auto`}>
        <pre className="code-block text-sm leading-7">
          <code>
            <span className="comment">{"// Create a payment with automatic provider routing"}</span>{"\n"}
            <span className="keyword">const</span> <span className="property">response</span> <span className="punctuation">=</span> <span className="keyword">await</span> <span className="method">fetch</span><span className="punctuation">(</span><span className="string">&quot;https://api.payorch.dev/v1/payments&quot;</span><span className="punctuation">,</span> <span className="punctuation">{"{"}</span>{"\n"}
            {"  "}<span className="property">method</span><span className="punctuation">:</span> <span className="string">&quot;POST&quot;</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="property">headers</span><span className="punctuation">:</span> <span className="punctuation">{"{"}</span>{"\n"}
            {"    "}<span className="string">&quot;Authorization&quot;</span><span className="punctuation">:</span> <span className="string">&quot;Bearer sk_live_...&quot;</span><span className="punctuation">,</span>{"\n"}
            {"    "}<span className="string">&quot;Content-Type&quot;</span><span className="punctuation">:</span> <span className="string">&quot;application/json&quot;</span><span className="punctuation">,</span>{"\n"}
            {"    "}<span className="string">&quot;Idempotency-Key&quot;</span><span className="punctuation">:</span> <span className="string">&quot;pay_req_a1b2c3&quot;</span>{"\n"}
            {"  "}<span className="punctuation">{"}"}</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="property">body</span><span className="punctuation">:</span> <span className="method">JSON.stringify</span><span className="punctuation">({"{"}</span>{"\n"}
            {"    "}<span className="property">amount</span><span className="punctuation">:</span> <span className="number">4999</span><span className="punctuation">,</span>           <span className="comment">{"// $49.99 in cents"}</span>{"\n"}
            {"    "}<span className="property">currency</span><span className="punctuation">:</span> <span className="string">&quot;USD&quot;</span><span className="punctuation">,</span>{"\n"}
            {"    "}<span className="property">customer</span><span className="punctuation">:</span> <span className="string">&quot;cus_abc123&quot;</span><span className="punctuation">,</span>{"\n"}
            {"    "}<span className="property">description</span><span className="punctuation">:</span> <span className="string">&quot;Pro plan subscription&quot;</span><span className="punctuation">,</span>{"\n"}
            {"    "}<span className="property">metadata</span><span className="punctuation">:</span> <span className="punctuation">{"{"}</span> <span className="property">plan</span><span className="punctuation">:</span> <span className="string">&quot;growth&quot;</span> <span className="punctuation">{"}"}</span>{"\n"}
            {"  "}<span className="punctuation">{"})"}</span>{"\n"}
            <span className="punctuation">{"})"}</span><span className="punctuation">;</span>{"\n\n"}
            <span className="comment">{"// Response"}</span>{"\n"}
            <span className="punctuation">{"{"}</span>{"\n"}
            {"  "}<span className="string">&quot;id&quot;</span><span className="punctuation">:</span> <span className="string">&quot;pay_7f3a2b1c&quot;</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;status&quot;</span><span className="punctuation">:</span> <span className="string">&quot;completed&quot;</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;amount&quot;</span><span className="punctuation">:</span> <span className="number">4999</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;currency&quot;</span><span className="punctuation">:</span> <span className="string">&quot;USD&quot;</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;provider&quot;</span><span className="punctuation">:</span> <span className="string">&quot;stripe&quot;</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;fraud_score&quot;</span><span className="punctuation">:</span> <span className="number">12</span><span className="punctuation">,</span>{"\n"}
            {"  "}<span className="string">&quot;created_at&quot;</span><span className="punctuation">:</span> <span className="string">&quot;2025-01-15T10:30:00Z&quot;</span>{"\n"}
            <span className="punctuation">{"}"}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

function LogoBar() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-40">
      {LOGOS.map((logo) => (
        <div key={logo.name} className="flex items-center gap-2 text-muted">
          <div className="w-6 h-6 rounded bg-muted/20" />
          <span className="text-sm font-medium tracking-wide">{logo.name}</span>
        </div>
      ))}
    </div>
  );
}

function DashboardPreview({ dark }: { dark: boolean }) {
  const screenshots = [
    { label: "Dashboard Overview", file: "01-dashboard-overview.png" },
    { label: "Payment Detail", file: "03-payment-detail.png" },
    { label: "Provider Performance", file: "04-providers.png" },
  ];
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setActive((a) => (a + 1) % screenshots.length), 4000);
    return () => clearInterval(timer);
  }, [screenshots.length]);

  return (
    <div>
      <div className="browser-frame border border-card-border mb-6">
        <div className={`flex items-center gap-2 px-4 py-3 ${dark ? "bg-[#0d1117]" : "bg-gray-100"} border-b border-card-border`}>
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 text-center text-xs text-muted">dashboard.payorch.dev</div>
        </div>
        <div className={`aspect-video ${dark ? "bg-[#0b1120]" : "bg-gray-50"} flex items-center justify-center relative overflow-hidden`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={screenshots[active]?.file}
            src={`/screenshots/${screenshots[active]?.file}`}
            alt={screenshots[active]?.label ?? "Dashboard"}
            className="w-full h-full object-cover object-top"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className={`absolute inset-0 flex items-center justify-center ${dark ? "bg-[#0b1120]/60" : "bg-white/60"}`} style={{ display: "none" }}>
            <p className="text-muted text-sm">{screenshots[active]?.label}</p>
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-2">
        {screenshots.map((s, i) => (
          <button
            key={s.file}
            onClick={() => setActive(i)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${i === active ? "bg-accent text-white" : "text-muted hover:text-foreground border border-card-border"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- main landing page ---------- */

export default function LandingPage() {
  const { dark, toggle } = useTheme();

  return (
    <div className="min-h-screen">
      <Navbar dark={dark} onToggle={toggle} />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern pointer-events-none" />
        <div className="hero-glow absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-card-border text-xs text-muted mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Now processing in sandbox
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            Payment Orchestration{" "}
            <span className="text-gradient">for Modern Businesses</span>
          </h1>

          <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Route payments across multiple providers, prevent fraud before it happens,
            and recover failed charges automatically. One API, every payment method.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/onboarding"
              className="inline-flex items-center px-6 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition-colors text-sm"
            >
              Get Started Free
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center px-6 py-3 rounded-lg border border-card-border text-sm font-medium hover:bg-card-border/50 transition-colors"
            >
              View Documentation
            </Link>
          </div>
        </div>
      </section>

      {/* Logos */}
      <Section className="py-16 px-6 border-t border-card-border">
        <p className="text-center text-xs uppercase tracking-widest text-muted mb-8">Trusted by leading companies</p>
        <LogoBar />
      </Section>

      {/* Features */}
      <section id="features" className="py-20 px-6">
        <Section className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Everything you need to{" "}
              <span className="text-gradient">process payments</span>
            </h2>
            <p className="text-muted max-w-xl mx-auto">
              Built-in fraud prevention, intelligent routing, automatic retries, and real-time observability. No more stitching together point solutions.
            </p>
          </div>
        </Section>
        <Section className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" stagger>
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </Section>
      </section>

      {/* How it works */}
      <section className="py-20 px-6 border-t border-card-border">
        <Section className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Up and running in{" "}
              <span className="text-gradient">three steps</span>
            </h2>
          </div>
        </Section>
        <Section className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8" stagger>
          {STEPS.map((step) => (
            <div key={step.num} className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border-2 border-accent text-accent font-display font-bold text-lg mb-4">
                {step.num}
              </div>
              <h3 className="font-display font-semibold text-xl mb-2">{step.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </Section>
      </section>

      {/* Code example */}
      <section className="py-20 px-6 border-t border-card-border">
        <Section className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              One API call.{" "}
              <span className="text-gradient">Infinite possibilities.</span>
            </h2>
            <p className="text-muted max-w-xl mx-auto">
              Create a payment with a single request. The orchestrator handles provider selection, fraud checks, retries, and webhook notifications automatically.
            </p>
          </div>
          <CodeExample dark={dark} />
        </Section>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 border-t border-card-border">
        <Section className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Simple,{" "}
              <span className="text-gradient">transparent pricing</span>
            </h2>
            <p className="text-muted">No hidden fees. Scale as you grow.</p>
          </div>
        </Section>
        <Section className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" stagger>
          {PRICING.map((p) => (
            <PricingCard key={p.name} {...p} />
          ))}
        </Section>
      </section>

      {/* Dashboard preview */}
      <section className="py-20 px-6 border-t border-card-border">
        <Section className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              See everything{" "}
              <span className="text-gradient">in real time</span>
            </h2>
            <p className="text-muted max-w-xl mx-auto">
              Monitor every payment, provider, and queue from a single dashboard. Drill into individual transactions to see the full saga flow.
            </p>
          </div>
          <DashboardPreview dark={dark} />
        </Section>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-card-border">
        <Section className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Ready to start{" "}
            <span className="text-gradient">processing payments?</span>
          </h2>
          <p className="text-muted mb-8 max-w-lg mx-auto">
            Create a free account and make your first test payment in under 5 minutes. No credit card required.
          </p>
          <Link
            href="/onboarding"
            className="inline-flex items-center px-8 py-3.5 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
          >
            Get Started Free
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </Section>
      </section>

      {/* Footer */}
      <footer className="border-t border-card-border py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="font-display font-semibold text-sm mb-4">Product</h4>
              <ul className="space-y-2.5">
                <li><a href="#features" className="text-sm text-muted hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="text-sm text-muted hover:text-foreground transition-colors">Pricing</a></li>
                <li><Link href="/docs" className="text-sm text-muted hover:text-foreground transition-colors">Documentation</Link></li>
                <li><Link href="/docs/api-reference" className="text-sm text-muted hover:text-foreground transition-colors">API Reference</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-display font-semibold text-sm mb-4">Developers</h4>
              <ul className="space-y-2.5">
                <li><Link href="/docs" className="text-sm text-muted hover:text-foreground transition-colors">Quick Start</Link></li>
                <li><Link href="/docs/authentication" className="text-sm text-muted hover:text-foreground transition-colors">Authentication</Link></li>
                <li><Link href="/docs/webhooks" className="text-sm text-muted hover:text-foreground transition-colors">Webhooks</Link></li>
                <li><Link href="/docs/testing" className="text-sm text-muted hover:text-foreground transition-colors">Testing</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-display font-semibold text-sm mb-4">Company</h4>
              <ul className="space-y-2.5">
                <li><span className="text-sm text-muted">About</span></li>
                <li><span className="text-sm text-muted">Blog</span></li>
                <li><span className="text-sm text-muted">Careers</span></li>
                <li><span className="text-sm text-muted">Contact</span></li>
              </ul>
            </div>
            <div>
              <h4 className="font-display font-semibold text-sm mb-4">Legal</h4>
              <ul className="space-y-2.5">
                <li><span className="text-sm text-muted">Privacy Policy</span></li>
                <li><span className="text-sm text-muted">Terms of Service</span></li>
                <li><span className="text-sm text-muted">DPA</span></li>
                <li><span className="text-sm text-muted">Security</span></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-card-border">
            <div className="flex items-center gap-2 mb-4 sm:mb-0">
              <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="font-display font-semibold text-sm">PayOrch</span>
            </div>
            <p className="text-xs text-muted">&copy; {new Date().getFullYear()} Payment Orchestrator. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
