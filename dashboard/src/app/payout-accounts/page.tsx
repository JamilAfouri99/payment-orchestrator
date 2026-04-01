"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchPayoutAccounts,
  createPayoutAccount,
  verifyPayoutAccount,
  disablePayoutAccount,
  setDefaultPayoutAccount,
  type PayoutAccountRecord,
} from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  pending_verification: "bg-warning/15 text-warning",
  verified: "bg-success/15 text-success",
  disabled: "bg-muted/15 text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  pending_verification: "Pending Verification",
  verified: "Verified",
  disabled: "Disabled",
};

export default function PayoutAccountsPage() {
  const [accounts, setAccounts] = useState<PayoutAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formMerchant, setFormMerchant] = useState("default");
  const [formBankName, setFormBankName] = useState("");
  const [formLast4, setFormLast4] = useState("");
  const [formRouting, setFormRouting] = useState("");
  const [formType, setFormType] = useState<"bank_account" | "wallet">("bank_account");
  const [formCountry, setFormCountry] = useState("US");
  const [formCurrency, setFormCurrency] = useState("USD");

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchPayoutAccounts();
      setAccounts(data);
    } catch {
      setError("Failed to load payout accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleCreate = async () => {
    setError("");
    try {
      await createPayoutAccount({
        merchantAccountId: formMerchant,
        type: formType,
        bankName: formBankName,
        accountNumberLast4: formLast4,
        routingNumber: formRouting,
        currency: formCurrency,
        country: formCountry,
      });
      setShowForm(false);
      setFormBankName("");
      setFormLast4("");
      setFormRouting("");
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create account");
    }
  };

  const handleVerify = async (id: string) => {
    setError("");
    try {
      await verifyPayoutAccount(id);
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify");
    }
  };

  const handleDisable = async (id: string) => {
    setError("");
    try {
      await disablePayoutAccount(id);
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disable");
    }
  };

  const handleSetDefault = async (id: string) => {
    setError("");
    try {
      await setDefaultPayoutAccount(id);
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set default");
    }
  };

  // Group by merchant
  const grouped = accounts.reduce<Record<string, PayoutAccountRecord[]>>((acc, a) => {
    const key = a.merchantAccountId;
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Payout Accounts</h2>
          <p className="text-sm text-muted mt-1">Manage bank accounts and wallets for merchant payouts</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/90 transition-colors"
        >
          Add Account
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Total Accounts</p>
          <p className="text-2xl font-bold mt-1">{accounts.length}</p>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Verified</p>
          <p className="text-2xl font-bold mt-1 text-success">
            {accounts.filter((a) => a.status === "verified").length}
          </p>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Pending Verification</p>
          <p className="text-2xl font-bold mt-1 text-warning">
            {accounts.filter((a) => a.status === "pending_verification").length}
          </p>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Add Payout Account</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Merchant Account ID</label>
              <input
                value={formMerchant}
                onChange={(e) => setFormMerchant(e.target.value)}
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Account Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as "bank_account" | "wallet")}
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              >
                <option value="bank_account">Bank Account</option>
                <option value="wallet">Wallet</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Bank Name</label>
              <input
                value={formBankName}
                onChange={(e) => setFormBankName(e.target.value)}
                placeholder="Chase Bank"
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Account Number (Last 4)</label>
              <input
                value={formLast4}
                onChange={(e) => setFormLast4(e.target.value)}
                maxLength={4}
                placeholder="4567"
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Routing Number</label>
              <input
                value={formRouting}
                onChange={(e) => setFormRouting(e.target.value)}
                placeholder="021000021"
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Country</label>
                <input
                  value={formCountry}
                  onChange={(e) => setFormCountry(e.target.value)}
                  className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Currency</label>
                <input
                  value={formCurrency}
                  onChange={(e) => setFormCurrency(e.target.value)}
                  className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent/90"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-card-border text-sm rounded hover:bg-card-border/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Account List */}
      {loading ? (
        <div className="text-center text-muted py-12 animate-pulse">Loading accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-8 text-center text-muted">
          No payout accounts configured. Add one to get started.
        </div>
      ) : (
        Object.entries(grouped).map(([merchantId, merchantAccounts]) => (
          <div key={merchantId} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted">
              Merchant: <span className="text-foreground font-mono">{merchantId}</span>
            </h3>
            <div className="space-y-2">
              {merchantAccounts.map((account) => (
                <div
                  key={account.id}
                  className="bg-card border border-card-border rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        {account.type === "bank_account" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                        )}
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{account.bankName}</p>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[account.status] ?? ""}`}>
                          {STATUS_LABELS[account.status] ?? account.status}
                        </span>
                        {account.isDefault && (
                          <span className="text-xs px-2 py-0.5 rounded bg-accent/15 text-accent font-medium">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted mt-1">
                        <span>{account.type === "bank_account" ? "Bank Account" : "Wallet"}</span>
                        <span>{account.accountNumberMasked}</span>
                        {account.routingNumber && <span>Routing: {account.routingNumber}</span>}
                        <span>{account.country} / {account.currency}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {account.status === "pending_verification" && (
                      <button
                        onClick={() => handleVerify(account.id)}
                        className="px-3 py-1.5 bg-success/10 text-success text-xs rounded hover:bg-success/20 transition-colors"
                      >
                        Verify
                      </button>
                    )}
                    {account.status === "verified" && !account.isDefault && (
                      <button
                        onClick={() => handleSetDefault(account.id)}
                        className="px-3 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20 transition-colors"
                      >
                        Set Default
                      </button>
                    )}
                    {account.status !== "disabled" && (
                      <button
                        onClick={() => handleDisable(account.id)}
                        className="px-3 py-1.5 bg-danger/10 text-danger text-xs rounded hover:bg-danger/20 transition-colors"
                      >
                        Disable
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
