-- CreateTable: ledger_accounts
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_system_account" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ledger_transactions
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ledger_entries
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effective_at" TIMESTAMP(3) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: settlements
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'calculating',
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "total_fees" INTEGER NOT NULL DEFAULT 0,
    "total_refunds" INTEGER NOT NULL DEFAULT 0,
    "total_chargebacks" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payout_method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "scheduled_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "ledger_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_tenant_id_name_key" ON "ledger_accounts"("tenant_id", "name");
CREATE INDEX "ledger_accounts_tenant_id_idx" ON "ledger_accounts"("tenant_id");

CREATE UNIQUE INDEX "ledger_transactions_tenant_id_idempotency_key_key" ON "ledger_transactions"("tenant_id", "idempotency_key");
CREATE INDEX "ledger_transactions_tenant_id_type_idx" ON "ledger_transactions"("tenant_id", "type");
CREATE INDEX "ledger_transactions_tenant_id_status_idx" ON "ledger_transactions"("tenant_id", "status");

CREATE INDEX "ledger_entries_tenant_id_account_id_effective_at_idx" ON "ledger_entries"("tenant_id", "account_id", "effective_at");
CREATE INDEX "ledger_entries_tenant_id_transaction_id_idx" ON "ledger_entries"("tenant_id", "transaction_id");

CREATE INDEX "settlements_tenant_id_merchant_account_id_idx" ON "settlements"("tenant_id", "merchant_account_id");
CREATE INDEX "settlements_tenant_id_status_idx" ON "settlements"("tenant_id", "status");
