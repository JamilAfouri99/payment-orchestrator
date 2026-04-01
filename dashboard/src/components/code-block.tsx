"use client";

import { useState, useCallback } from "react";

const TAB_LABELS: Record<string, string> = {
  node: "Node.js",
  python: "Python",
  curl: "cURL",
};

interface CodeTab {
  lang: string;
  code: string;
}

export function CodeBlock({ tabs, title }: { tabs: CodeTab[]; title?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    const code = tabs[active]?.code ?? "";
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [active, tabs]);

  return (
    <div className="rounded-xl border border-card-border overflow-hidden my-6">
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-card-border">
        <div className="flex items-center gap-1">
          {tabs.map((tab, i) => (
            <button
              key={tab.lang}
              onClick={() => setActive(i)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                i === active ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              {TAB_LABELS[tab.lang] ?? tab.lang}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {title && <span className="text-xs text-muted hidden sm:inline">{title}</span>}
          <button onClick={copy} className="text-muted hover:text-foreground transition-colors" title="Copy code">
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
      </div>
      <pre className="p-5 bg-[#0d1117] overflow-x-auto text-sm leading-7 font-code">
        <code className="text-[#e6edf3]">{tabs[active]?.code ?? ""}</code>
      </pre>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-sm font-code">
      {children}
    </code>
  );
}

export function Endpoint({ method, path, desc }: { method: string; path: string; desc?: string }) {
  const colors: Record<string, string> = {
    GET: "bg-success/15 text-success",
    POST: "bg-accent/15 text-accent",
    PUT: "bg-warning/15 text-warning",
    DELETE: "bg-danger/15 text-danger",
    PATCH: "bg-purple-500/15 text-purple-400",
  };
  const color = colors[method] ?? "bg-muted/15 text-muted";

  return (
    <div className="flex items-start gap-3 py-3 border-b border-card-border last:border-0">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold shrink-0 ${color}`}>
        {method}
      </span>
      <div>
        <code className="text-sm font-code text-foreground">{path}</code>
        {desc && <p className="text-xs text-muted mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

export function Callout({ type = "info", children }: { type?: "info" | "warning" | "tip"; children: React.ReactNode }) {
  const styles = {
    info: { bg: "bg-accent/5 border-accent/30", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-accent" },
    warning: { bg: "bg-warning/5 border-warning/30", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z", color: "text-warning" },
    tip: { bg: "bg-success/5 border-success/30", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z", color: "text-success" },
  };
  const s = styles[type];

  return (
    <div className={`flex gap-3 p-4 rounded-lg border ${s.bg} my-4`}>
      <svg className={`w-5 h-5 ${s.color} shrink-0 mt-0.5`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
      </svg>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
