-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "merchant_account_id" TEXT NOT NULL DEFAULT 'default',
    "external_dispute_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'chargeback',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_response',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "evidence_due_by" TIMESTAMP(3) NOT NULL,
    "filed_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "outcome" TEXT,
    "network_reason_code" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_tenant_id_payment_id_idx" ON "disputes"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "disputes_tenant_id_status_idx" ON "disputes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "disputes_tenant_id_merchant_account_id_idx" ON "disputes"("tenant_id", "merchant_account_id");

-- CreateIndex
CREATE INDEX "dispute_evidence_tenant_id_dispute_id_idx" ON "dispute_evidence"("tenant_id", "dispute_id");
