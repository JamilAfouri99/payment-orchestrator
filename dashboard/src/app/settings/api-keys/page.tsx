"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyRecord,
} from "@/lib/api";

const ENVIRONMENTS = ["sandbox", "production"];

const ALL_PERMISSIONS = [
  "payments:read",
  "payments:write",
  "webhooks:read",
  "webhooks:write",
  "tokens:read",
  "tokens:write",
  "admin:read",
];

const ENV_BADGE: Record<string, string> = {
  sandbox: "bg-warning/15 text-warning border-warning/30",
  production: "bg-success/15 text-success border-success/30",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  revoked: "bg-danger/15 text-danger border-danger/30",
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [formEnv, setFormEnv] = useState("sandbox");
  const [formName, setFormName] = useState("");
  const [formPerms, setFormPerms] = useState<string[]>([
    "payments:read",
    "payments:write",
  ]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listApiKeys();
      setKeys(data.keys);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (formPerms.length === 0) {
      setCreateError("Select at least one permission");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createApiKey({
        environment: formEnv,
        name: formName.trim() || undefined,
        permissions: formPerms,
      });
      setKeys((prev) => [res.record, ...prev]);
      setNewKey(res.key);
      setShowForm(false);
      resetForm();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create key",
      );
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setFormEnv("sandbox");
    setFormName("");
    setFormPerms(["payments:read", "payments:write"]);
    setCreateError(null);
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    setConfirmRevoke(null);
    try {
      await revokeApiKey(id);
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, status: "revoked" } : k)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevoking(null);
    }
  }

  function togglePerm(perm: string) {
    setFormPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  }

  async function copyNewKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">API Keys</h2>
          <p className="text-muted text-sm mt-1">
            Manage authentication keys for the payment API
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setNewKey(null);
          }}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          {showForm ? "Cancel" : "+ Create API Key"}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New key reveal banner */}
      {newKey && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-success">
              API key created successfully
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-muted hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-2 text-xs text-warning">
            This key won&apos;t be shown again. Copy it now.
          </div>
          <div className="flex items-center gap-2 bg-background border border-card-border rounded-lg px-4 py-3">
            <span className="flex-1 font-mono text-xs text-foreground break-all">
              {newKey}
            </span>
            <button
              onClick={copyNewKey}
              className="shrink-0 text-muted hover:text-foreground transition-colors"
              title="Copy"
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
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-card border border-card-border rounded-xl p-6 space-y-5"
        >
          <h3 className="font-semibold">New API Key</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">
                Environment
              </label>
              <select
                value={formEnv}
                onChange={(e) => setFormEnv(e.target.value)}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              >
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env.charAt(0).toUpperCase() + env.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">
                Name (optional)
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. CI/CD Pipeline"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-2">
              Permissions
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_PERMISSIONS.map((perm) => (
                <label
                  key={perm}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={formPerms.includes(perm)}
                    onChange={() => togglePerm(perm)}
                    className="accent-blue-500"
                  />
                  <span className="font-mono text-xs text-muted">{perm}</span>
                </label>
              ))}
            </div>
          </div>

          {createError && (
            <p className="text-sm text-danger">{createError}</p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Key"}
          </button>
        </form>
      )}

      {/* Keys table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-card-border">
          <h3 className="font-semibold">API Keys</h3>
          <p className="text-xs text-muted mt-0.5">
            {loading ? "Loading..." : `${keys.length} key${keys.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted text-sm animate-pulse">
            Loading...
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            No API keys yet. Create one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-card-border">
                  <th className="px-5 py-3 font-medium">Prefix</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Environment</th>
                  <th className="px-5 py-3 font-medium">Permissions</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last used</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs text-muted">
                        {k.keyPrefix}...
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-sm">{k.name || "—"}</span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        label={k.environment}
                        style={ENV_BADGE[k.environment] ?? "bg-muted/15 text-muted border-muted/30"}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-muted font-mono">
                        {k.permissions.join(", ")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        label={k.status}
                        style={STATUS_BADGE[k.status] ?? "bg-muted/15 text-muted border-muted/30"}
                      />
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {k.status === "active" && (
                        <>
                          {confirmRevoke === k.id ? (
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-muted">
                                Confirm?
                              </span>
                              <button
                                onClick={() => handleRevoke(k.id)}
                                disabled={revoking === k.id}
                                className="px-2 py-1 rounded bg-danger text-white text-xs font-medium hover:bg-danger/80 transition-colors disabled:opacity-50"
                              >
                                {revoking === k.id ? "..." : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmRevoke(null)}
                                className="px-2 py-1 rounded bg-card-border text-muted text-xs hover:text-foreground transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRevoke(k.id)}
                              className="px-3 py-1 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium hover:bg-danger/20 transition-colors"
                            >
                              Revoke
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {label}
    </span>
  );
}
