import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { EventStore } from "../events/event-store.js";
import type { WebhookDeliveryService } from "../webhooks/webhook-delivery.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type DisputeType = "chargeback" | "inquiry" | "retrieval" | "pre_arbitration";

export type DisputeReason =
  | "fraudulent"
  | "product_not_received"
  | "product_unacceptable"
  | "duplicate"
  | "subscription_canceled"
  | "credit_not_processed"
  | "general";

export type DisputeStatus = "needs_response" | "under_review" | "won" | "lost" | "accepted";

export type DisputeOutcome = "won" | "lost";

export type EvidenceType =
  | "receipt"
  | "shipping_proof"
  | "customer_communication"
  | "refund_policy"
  | "service_documentation"
  | "other";

export interface Dispute {
  id: string;
  tenantId: string;
  paymentId: string;
  merchantAccountId: string;
  externalDisputeId: string;
  type: DisputeType;
  reason: DisputeReason;
  status: DisputeStatus;
  amount: number;
  currency: string;
  evidenceDueBy: string;
  filedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  outcome: DisputeOutcome | null;
  networkReasonCode: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  evidence: DisputeEvidenceRecord[];
}

export interface DisputeEvidenceRecord {
  id: string;
  disputeId: string;
  type: EvidenceType;
  description: string;
  content: string;
  submittedAt: string;
}

export interface EvidenceInput {
  type: EvidenceType;
  description: string;
  content: string;
}

export interface ChargebackRate {
  merchantAccountId: string;
  windowDays: number;
  disputeCount: number;
  transactionCount: number;
  rate: number;
  ratePercent: string;
  threshold: "normal" | "warning" | "excessive" | "critical";
  blocked: boolean;
}

export interface DisputeListFilters {
  status?: DisputeStatus | undefined;
  paymentId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class DisputeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "EVIDENCE_DEADLINE_PASSED"
      | "VALIDATION"
      | "DISPUTE_FAILURE",
  ) {
    super(message);
    this.name = "DisputeError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_DISPUTE_TYPES: DisputeType[] = ["chargeback", "inquiry", "retrieval", "pre_arbitration"];

const VALID_REASONS: DisputeReason[] = [
  "fraudulent", "product_not_received", "product_unacceptable",
  "duplicate", "subscription_canceled", "credit_not_processed", "general",
];

const VALID_EVIDENCE_TYPES: EvidenceType[] = [
  "receipt", "shipping_proof", "customer_communication",
  "refund_policy", "service_documentation", "other",
];

const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  needs_response: ["under_review", "accepted", "lost"],
  under_review: ["won", "lost"],
  won: [],
  lost: [],
  accepted: [],
};

/** Simulated Visa/Mastercard reason codes by dispute reason */
const NETWORK_REASON_CODES: Record<DisputeReason, string[]> = {
  fraudulent: ["10.4", "4863"],
  product_not_received: ["13.1"],
  product_unacceptable: ["13.3", "4853"],
  duplicate: ["12.6"],
  subscription_canceled: ["13.6"],
  credit_not_processed: ["13.6"],
  general: ["4837"],
};

/** Evidence deadline in days from filing */
const EVIDENCE_DEADLINE_DAYS = 21;

/** Rolling window for chargeback rate calculation */
const CHARGEBACK_RATE_WINDOW_DAYS = 120;

/** Visa threshold percentages */
const THRESHOLD_WARNING = 0.0065;
const THRESHOLD_EXCESSIVE = 0.009;
const THRESHOLD_CRITICAL = 0.01;

// ── Service Interface ────────────────────────────────────────────────────────

export interface DisputeService {
  receiveDispute(
    paymentId: string,
    reason: DisputeReason,
    amount: number,
    type?: DisputeType | undefined,
    merchantAccountId?: string | undefined,
  ): Promise<Result<Dispute, DisputeError>>;

  submitEvidence(
    disputeId: string,
    evidence: EvidenceInput[],
  ): Promise<Result<Dispute, DisputeError>>;

  resolveDispute(
    disputeId: string,
    outcome: DisputeOutcome,
  ): Promise<Result<Dispute, DisputeError>>;

  acceptDispute(disputeId: string): Promise<Result<Dispute, DisputeError>>;

  getDispute(disputeId: string): Promise<Result<Dispute, DisputeError>>;

  listDisputes(
    filters?: DisputeListFilters | undefined,
  ): Promise<Result<{ disputes: Dispute[]; total: number }, DisputeError>>;

  getChargebackRate(
    merchantAccountId?: string | undefined,
  ): Promise<Result<ChargebackRate, DisputeError>>;

  shouldBlockPayments(
    merchantAccountId?: string | undefined,
  ): Promise<Result<boolean, DisputeError>>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createDisputeService(
  prisma: PrismaClient,
  tenantId: string,
  ledgerService: LedgerService,
  eventStore: EventStore,
  webhookService: WebhookDeliveryService,
): DisputeService {

  function toDispute(record: {
    id: string;
    tenantId: string;
    paymentId: string;
    merchantAccountId: string;
    externalDisputeId: string;
    type: string;
    reason: string;
    status: string;
    amount: number;
    currency: string;
    evidenceDueBy: Date;
    filedAt: Date;
    respondedAt: Date | null;
    resolvedAt: Date | null;
    outcome: string | null;
    networkReasonCode: string;
    metadata: unknown;
    createdAt: Date;
  }, evidence: DisputeEvidenceRecord[] = []): Dispute {
    return {
      id: record.id,
      tenantId: record.tenantId,
      paymentId: record.paymentId,
      merchantAccountId: record.merchantAccountId,
      externalDisputeId: record.externalDisputeId,
      type: record.type as DisputeType,
      reason: record.reason as DisputeReason,
      status: record.status as DisputeStatus,
      amount: record.amount,
      currency: record.currency,
      evidenceDueBy: record.evidenceDueBy.toISOString(),
      filedAt: record.filedAt.toISOString(),
      respondedAt: record.respondedAt?.toISOString() ?? null,
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      outcome: (record.outcome as DisputeOutcome | null) ?? null,
      networkReasonCode: record.networkReasonCode,
      metadata: (record.metadata ?? {}) as Record<string, unknown>,
      createdAt: record.createdAt.toISOString(),
      evidence,
    };
  }

  function toEvidenceRecord(record: {
    id: string;
    disputeId: string;
    type: string;
    description: string;
    content: string;
    submittedAt: Date;
  }): DisputeEvidenceRecord {
    return {
      id: record.id,
      disputeId: record.disputeId,
      type: record.type as EvidenceType,
      description: record.description,
      content: record.content,
      submittedAt: record.submittedAt.toISOString(),
    };
  }

  function pickReasonCode(reason: DisputeReason): string {
    const codes = NETWORK_REASON_CODES[reason] ?? ["4837"];
    return codes[Math.floor(Math.random() * codes.length)]!;
  }

  async function loadDisputeWithEvidence(disputeId: string): Promise<Result<Dispute, DisputeError>> {
    try {
      const record = await prisma.dispute.findFirst({
        where: { tenantId, id: disputeId },
      });
      if (!record) return err(new DisputeError(`Dispute not found: ${disputeId}`, "NOT_FOUND"));

      const evidenceRecords = await prisma.disputeEvidence.findMany({
        where: { tenantId, disputeId },
        orderBy: { submittedAt: "asc" },
      });

      return ok(toDispute(record, evidenceRecords.map(toEvidenceRecord)));
    } catch (error) {
      return err(new DisputeError(
        `Failed to load dispute: ${error instanceof Error ? error.message : String(error)}`,
        "DISPUTE_FAILURE",
      ));
    }
  }

  function classifyThreshold(rate: number): ChargebackRate["threshold"] {
    if (rate >= THRESHOLD_CRITICAL) return "critical";
    if (rate >= THRESHOLD_EXCESSIVE) return "excessive";
    if (rate >= THRESHOLD_WARNING) return "warning";
    return "normal";
  }

  return {
    async receiveDispute(paymentId, reason, amount, type, merchantAccountId) {
      // Validate inputs
      const disputeType = type ?? "chargeback";
      if (!VALID_DISPUTE_TYPES.includes(disputeType)) {
        return err(new DisputeError(`Invalid dispute type: ${disputeType}`, "VALIDATION"));
      }
      if (!VALID_REASONS.includes(reason)) {
        return err(new DisputeError(`Invalid dispute reason: ${reason}`, "VALIDATION"));
      }
      if (amount <= 0) {
        return err(new DisputeError("Dispute amount must be positive", "VALIDATION"));
      }

      try {
        const disputeId = uuid();
        const externalDisputeId = `dp_${uuid().replace(/-/g, "").slice(0, 16)}`;
        const now = new Date();
        const evidenceDueBy = new Date(now.getTime() + EVIDENCE_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
        const networkReasonCode = pickReasonCode(reason);

        const record = await prisma.dispute.create({
          data: {
            id: disputeId,
            tenantId,
            paymentId,
            merchantAccountId: merchantAccountId ?? "default",
            externalDisputeId,
            type: disputeType,
            reason,
            status: "needs_response",
            amount,
            currency: "USD",
            evidenceDueBy,
            filedAt: now,
            networkReasonCode,
          },
        });

        // Ledger: hold disputed amount (DEBIT merchant_balance, CREDIT dispute_holds)
        await ledgerService.postTransactionByName(
          "chargeback",
          `dispute-hold:${disputeId}`,
          [
            { accountName: "merchant_balance", direction: "debit", amount, currency: "USD" },
            { accountName: "dispute_holds", direction: "credit", amount, currency: "USD" },
          ],
          `Dispute hold for payment ${paymentId} — ${reason}`,
        );

        // Event store
        const eventVersion = await getNextEventVersion(disputeId);
        await eventStore.append({
          aggregateId: disputeId,
          aggregateType: "Dispute",
          eventType: "DisputeReceived",
          version: eventVersion,
          payload: {
            paymentId,
            reason,
            amount,
            type: disputeType,
            externalDisputeId,
            networkReasonCode,
            merchantAccountId: merchantAccountId ?? "default",
          },
          metadata: { tenantId },
        });

        // Webhook
        await webhookService.dispatch("dispute.created", {
          disputeId,
          paymentId,
          reason,
          amount,
          type: disputeType,
          externalDisputeId,
          networkReasonCode,
          evidenceDueBy: evidenceDueBy.toISOString(),
        });

        return ok(toDispute(record));
      } catch (error) {
        return err(new DisputeError(
          `Failed to receive dispute: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async submitEvidence(disputeId, evidence) {
      try {
        const record = await prisma.dispute.findFirst({
          where: { tenantId, id: disputeId },
        });
        if (!record) return err(new DisputeError(`Dispute not found: ${disputeId}`, "NOT_FOUND"));

        if (record.status !== "needs_response") {
          return err(new DisputeError(
            `Cannot submit evidence for dispute in status "${record.status}" — must be "needs_response"`,
            "INVALID_STATUS",
          ));
        }

        // Check evidence deadline
        if (new Date() > record.evidenceDueBy) {
          return err(new DisputeError(
            "Evidence deadline has passed",
            "EVIDENCE_DEADLINE_PASSED",
          ));
        }

        // Validate evidence inputs
        for (const e of evidence) {
          if (!VALID_EVIDENCE_TYPES.includes(e.type)) {
            return err(new DisputeError(`Invalid evidence type: ${e.type}`, "VALIDATION"));
          }
        }

        // Create evidence records
        const evidenceRecords: DisputeEvidenceRecord[] = [];
        for (const e of evidence) {
          const evidenceId = uuid();
          const created = await prisma.disputeEvidence.create({
            data: {
              id: evidenceId,
              tenantId,
              disputeId,
              type: e.type,
              description: e.description,
              content: e.content,
            },
          });
          evidenceRecords.push(toEvidenceRecord(created));
        }

        // Transition to under_review
        const now = new Date();
        const updated = await prisma.dispute.update({
          where: { id: disputeId },
          data: {
            status: "under_review",
            respondedAt: now,
          },
        });

        // Event store
        const eventVersion = await getNextEventVersion(disputeId);
        await eventStore.append({
          aggregateId: disputeId,
          aggregateType: "Dispute",
          eventType: "DisputeEvidenceSubmitted",
          version: eventVersion,
          payload: {
            evidenceCount: evidence.length,
            evidenceTypes: evidence.map((e) => e.type),
          },
          metadata: { tenantId },
        });

        // Webhook
        await webhookService.dispatch("dispute.evidence_submitted", {
          disputeId,
          evidenceCount: evidence.length,
        });

        // Load all evidence for the response
        const allEvidence = await prisma.disputeEvidence.findMany({
          where: { tenantId, disputeId },
          orderBy: { submittedAt: "asc" },
        });

        return ok(toDispute(updated, allEvidence.map(toEvidenceRecord)));
      } catch (error) {
        return err(new DisputeError(
          `Failed to submit evidence: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async resolveDispute(disputeId, outcome) {
      try {
        const record = await prisma.dispute.findFirst({
          where: { tenantId, id: disputeId },
        });
        if (!record) return err(new DisputeError(`Dispute not found: ${disputeId}`, "NOT_FOUND"));

        const allowed = VALID_TRANSITIONS[record.status as DisputeStatus] ?? [];
        if (!allowed.includes(outcome)) {
          return err(new DisputeError(
            `Cannot resolve dispute in status "${record.status}" to "${outcome}"`,
            "INVALID_STATUS",
          ));
        }

        const now = new Date();
        await prisma.dispute.update({
          where: { id: disputeId },
          data: {
            status: outcome,
            outcome,
            resolvedAt: now,
          },
        });

        if (outcome === "won") {
          // Reverse the hold: DEBIT dispute_holds, CREDIT merchant_balance
          await ledgerService.postTransactionByName(
            "chargeback",
            `dispute-won:${disputeId}`,
            [
              { accountName: "dispute_holds", direction: "debit", amount: record.amount, currency: record.currency },
              { accountName: "merchant_balance", direction: "credit", amount: record.amount, currency: record.currency },
            ],
            `Dispute won — reversed hold for ${disputeId}`,
          );
        } else {
          // Finalize: DEBIT dispute_holds, CREDIT provider_settlement
          await ledgerService.postTransactionByName(
            "chargeback",
            `dispute-lost:${disputeId}`,
            [
              { accountName: "dispute_holds", direction: "debit", amount: record.amount, currency: record.currency },
              { accountName: "provider_settlement", direction: "credit", amount: record.amount, currency: record.currency },
            ],
            `Dispute lost — funds returned to network for ${disputeId}`,
          );
        }

        // Event store
        const eventType = outcome === "won" ? "DisputeWon" as const : "DisputeLost" as const;
        const eventVersion = await getNextEventVersion(disputeId);
        await eventStore.append({
          aggregateId: disputeId,
          aggregateType: "Dispute",
          eventType,
          version: eventVersion,
          payload: { outcome },
          metadata: { tenantId },
        });

        // Webhook
        const webhookEvent = outcome === "won" ? "dispute.won" : "dispute.lost";
        await webhookService.dispatch(webhookEvent, {
          disputeId,
          outcome,
          amount: record.amount,
          paymentId: record.paymentId,
        });

        return await loadDisputeWithEvidence(disputeId);
      } catch (error) {
        return err(new DisputeError(
          `Failed to resolve dispute: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async acceptDispute(disputeId) {
      try {
        const record = await prisma.dispute.findFirst({
          where: { tenantId, id: disputeId },
        });
        if (!record) return err(new DisputeError(`Dispute not found: ${disputeId}`, "NOT_FOUND"));

        const allowed = VALID_TRANSITIONS[record.status as DisputeStatus] ?? [];
        if (!allowed.includes("accepted")) {
          return err(new DisputeError(
            `Cannot accept dispute in status "${record.status}" — must be "needs_response"`,
            "INVALID_STATUS",
          ));
        }

        const now = new Date();
        await prisma.dispute.update({
          where: { id: disputeId },
          data: {
            status: "accepted",
            outcome: "lost",
            resolvedAt: now,
          },
        });

        // Finalize ledger: same as lost
        await ledgerService.postTransactionByName(
          "chargeback",
          `dispute-accepted:${disputeId}`,
          [
            { accountName: "dispute_holds", direction: "debit", amount: record.amount, currency: record.currency },
            { accountName: "provider_settlement", direction: "credit", amount: record.amount, currency: record.currency },
          ],
          `Dispute accepted — funds returned to network for ${disputeId}`,
        );

        // Event store
        const eventVersion = await getNextEventVersion(disputeId);
        await eventStore.append({
          aggregateId: disputeId,
          aggregateType: "Dispute",
          eventType: "DisputeAccepted",
          version: eventVersion,
          payload: { outcome: "lost" },
          metadata: { tenantId },
        });

        // Webhook
        await webhookService.dispatch("dispute.accepted", {
          disputeId,
          amount: record.amount,
          paymentId: record.paymentId,
        });

        return await loadDisputeWithEvidence(disputeId);
      } catch (error) {
        return err(new DisputeError(
          `Failed to accept dispute: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async getDispute(disputeId) {
      return loadDisputeWithEvidence(disputeId);
    },

    async listDisputes(filters) {
      try {
        const where: Record<string, unknown> = { tenantId };
        if (filters?.status) where["status"] = filters.status;
        if (filters?.paymentId) where["paymentId"] = filters.paymentId;

        const limit = filters?.limit ?? 50;
        const offset = filters?.offset ?? 0;

        const [records, total] = await Promise.all([
          prisma.dispute.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
          }),
          prisma.dispute.count({ where }),
        ]);

        const disputes = records.map((r) => toDispute(r));
        return ok({ disputes, total });
      } catch (error) {
        return err(new DisputeError(
          `Failed to list disputes: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async getChargebackRate(merchantAccountId) {
      try {
        const windowStart = new Date(Date.now() - CHARGEBACK_RATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const acctId = merchantAccountId ?? "default";

        // Count disputes in window
        const disputeWhere: Record<string, unknown> = {
          tenantId,
          filedAt: { gte: windowStart },
        };
        if (merchantAccountId) disputeWhere["merchantAccountId"] = merchantAccountId;

        const disputeCount = await prisma.dispute.count({ where: disputeWhere });

        // Count total transactions in window (PaymentInitiated events)
        const transactionCount = await prisma.eventStore.count({
          where: {
            tenantId,
            eventType: "PaymentInitiated",
            createdAt: { gte: windowStart },
          },
        });

        const rate = transactionCount > 0 ? disputeCount / transactionCount : 0;
        const threshold = classifyThreshold(rate);

        return ok({
          merchantAccountId: acctId,
          windowDays: CHARGEBACK_RATE_WINDOW_DAYS,
          disputeCount,
          transactionCount,
          rate,
          ratePercent: `${(rate * 100).toFixed(3)}%`,
          threshold,
          blocked: rate >= THRESHOLD_CRITICAL,
        });
      } catch (error) {
        return err(new DisputeError(
          `Failed to calculate chargeback rate: ${error instanceof Error ? error.message : String(error)}`,
          "DISPUTE_FAILURE",
        ));
      }
    },

    async shouldBlockPayments(merchantAccountId) {
      const rateResult = await this.getChargebackRate(merchantAccountId);
      if (!rateResult.ok) return rateResult;
      return ok(rateResult.value.blocked);
    },
  };

  async function getNextEventVersion(aggregateId: string): Promise<number> {
    const existing = await eventStore.getByAggregateId(aggregateId);
    if (!existing.ok) return 1;
    return existing.value.length + 1;
  }
}
