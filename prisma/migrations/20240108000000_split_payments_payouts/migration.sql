-- Split Payments
CREATE TABLE "payment_splits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "split_type" TEXT NOT NULL DEFAULT 'fixed',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ledger_tx_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_splits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_splits_tenant_id_payment_id_idx" ON "payment_splits"("tenant_id", "payment_id");
CREATE INDEX "payment_splits_tenant_id_recipient_id_idx" ON "payment_splits"("tenant_id", "recipient_id");

-- Payout Accounts
CREATE TABLE "payout_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'bank_account',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "account_number_masked" TEXT NOT NULL DEFAULT '',
    "routing_number" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "country" TEXT NOT NULL DEFAULT 'US',
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payout_accounts_tenant_id_merchant_account_id_idx" ON "payout_accounts"("tenant_id", "merchant_account_id");
CREATE INDEX "payout_accounts_tenant_id_status_idx" ON "payout_accounts"("tenant_id", "status");

-- Payouts
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT NOT NULL,
    "payout_account_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fees" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMP(3),
    "initiated_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "settlement_ids" JSONB NOT NULL DEFAULT '[]',
    "ledger_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payouts_tenant_id_merchant_account_id_idx" ON "payouts"("tenant_id", "merchant_account_id");
CREATE INDEX "payouts_tenant_id_status_idx" ON "payouts"("tenant_id", "status");
CREATE INDEX "payouts_tenant_id_payout_account_id_idx" ON "payouts"("tenant_id", "payout_account_id");
