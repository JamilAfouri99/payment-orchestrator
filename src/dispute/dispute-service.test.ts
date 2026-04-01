import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDisputeService, type EvidenceInput } from "./dispute-service.js";

function createMockPrisma() {
  const disputes: Array<Record<string, unknown>> = [];
  const evidence: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  return {
    _disputes: disputes,
    _evidence: evidence,
    _events: events,
    dispute: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, createdAt: new Date(), updatedAt: new Date() };
        disputes.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return disputes.find((d) => d.tenantId === where.tenantId && d.id === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take, skip }: {
        where: Record<string, unknown>;
        take?: number;
        skip?: number;
        orderBy?: unknown;
      }) => {
        let result = disputes.filter((d) => {
          if (d.tenantId !== where.tenantId) return false;
          if (where.status && d.status !== where.status) return false;
          if (where.paymentId && d.paymentId !== where.paymentId) return false;
          return true;
        });
        if (skip) result = result.slice(skip);
        if (take) result = result.slice(0, take);
        return result;
      }),
      count: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return disputes.filter((d) => {
          if (d.tenantId !== where.tenantId) return false;
          if (where.status && d.status !== where.status) return false;
          if (where.paymentId && d.paymentId !== where.paymentId) return false;
          if (where.filedAt) {
            const filed = d.filedAt as Date;
            const gte = (where.filedAt as Record<string, Date>).gte;
            if (gte && filed < gte) return false;
          }
          return true;
        }).length;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const dispute = disputes.find((d) => d.id === where.id);
        if (!dispute) throw new Error("Not found");
        Object.assign(dispute, data, { updatedAt: new Date() });
        return dispute;
      }),
    },
    disputeEvidence: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, submittedAt: data.submittedAt ?? new Date() };
        evidence.push(record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: {
        where: Record<string, unknown>;
        orderBy?: unknown;
      }) => {
        return evidence.filter((e) => e.tenantId === where.tenantId && e.disputeId === where.disputeId);
      }),
    },
    eventStore: {
      count: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return events.filter((e) => {
          if (e.tenantId !== where.tenantId) return false;
          if (where.eventType && e.eventType !== where.eventType) return false;
          if (where.createdAt) {
            const created = e.createdAt as Date;
            const gte = (where.createdAt as Record<string, Date>).gte;
            if (gte && created < gte) return false;
          }
          return true;
        }).length;
      }),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

function createMockEventStore() {
  const events: Array<Record<string, unknown>> = [];
  return {
    _events: events,
    append: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      const record = { id: `evt_${events.length + 1}`, ...event, createdAt: new Date() };
      events.push(record);
      return { ok: true, value: record };
    }),
    getByAggregateId: vi.fn().mockImplementation(async (aggregateId: string) => {
      return { ok: true, value: events.filter((e) => e.aggregateId === aggregateId) };
    }),
    getByAggregateIdAt: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getAfterVersion: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    replay: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    replayAt: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listAggregates: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    countAggregates: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  } as unknown as import("../events/event-store.js").EventStore & {
    _events: typeof events;
  };
}

function createMockLedgerService() {
  const transactions: Array<Record<string, unknown>> = [];
  return {
    _transactions: transactions,
    postTransactionByName: vi.fn().mockImplementation(async (
      _type: string,
      idempotencyKey: string,
      _entries: unknown[],
      _description: string,
    ) => {
      const tx = { id: `tx_${transactions.length + 1}`, idempotencyKey, entries: [], createdAt: new Date().toISOString() };
      transactions.push(tx);
      return { ok: true, value: tx };
    }),
    ensureSystemAccounts: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    getAccount: vi.fn().mockResolvedValue({ ok: true, value: { id: "acct_1" } }),
    listAccounts: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    postTransaction: vi.fn().mockResolvedValue({ ok: true, value: { id: "tx_1" } }),
    getBalance: vi.fn().mockResolvedValue({ ok: true, value: { balance: 0 } }),
    getStatement: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getTransaction: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listTransactions: vi.fn().mockResolvedValue({ ok: true, value: { transactions: [], total: 0 } }),
    reconcile: vi.fn().mockResolvedValue({ ok: true, value: { passed: true } }),
    postPaymentCaptured: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postRefund: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  } as unknown as import("../ledger/ledger-service.js").LedgerService & {
    _transactions: typeof transactions;
  };
}

function createMockWebhookService() {
  const dispatched: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  return {
    _dispatched: dispatched,
    dispatch: vi.fn().mockImplementation(async (eventType: string, payload: Record<string, unknown>) => {
      dispatched.push({ eventType, payload });
      return { ok: true, value: undefined };
    }),
    register: vi.fn().mockResolvedValue({ ok: true, value: "reg_1" }),
    processRetries: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  } as unknown as import("../webhooks/webhook-delivery.js").WebhookDeliveryService & {
    _dispatched: typeof dispatched;
  };
}

describe("DisputeService", () => {
  const tenantId = "test-tenant";
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let webhookService: ReturnType<typeof createMockWebhookService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    ledgerService = createMockLedgerService();
    webhookService = createMockWebhookService();
  });

  function createService() {
    return createDisputeService(prisma, tenantId, ledgerService, eventStore, webhookService);
  }

  describe("receiveDispute", () => {
    it("creates a dispute with ledger hold, event, and webhook", async () => {
      const service = createService();
      const result = await service.receiveDispute("pay_123", "fraudulent", 5000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.paymentId).toBe("pay_123");
        expect(result.value.reason).toBe("fraudulent");
        expect(result.value.amount).toBe(5000);
        expect(result.value.status).toBe("needs_response");
        expect(result.value.type).toBe("chargeback");
        expect(result.value.externalDisputeId).toMatch(/^dp_/);
        expect(result.value.networkReasonCode).toBeTruthy();
      }

      // Ledger hold posted
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "chargeback",
        expect.stringContaining("dispute-hold:"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "merchant_balance", direction: "debit", amount: 5000 }),
          expect.objectContaining({ accountName: "dispute_holds", direction: "credit", amount: 5000 }),
        ]),
        expect.stringContaining("Dispute hold"),
      );

      // Event appended
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: "Dispute",
          eventType: "DisputeReceived",
        }),
      );

      // Webhook dispatched
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "dispute.created",
        expect.objectContaining({ paymentId: "pay_123", reason: "fraudulent", amount: 5000 }),
      );
    });

    it("accepts optional type and merchantAccountId", async () => {
      const service = createService();
      const result = await service.receiveDispute("pay_456", "duplicate", 3000, "inquiry", "merch_1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("inquiry");
        expect(result.value.merchantAccountId).toBe("merch_1");
      }
    });

    it("rejects invalid reason", async () => {
      const service = createService();
      const result = await service.receiveDispute("pay_789", "invalid_reason" as never, 1000);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
      }
    });

    it("rejects zero amount", async () => {
      const service = createService();
      const result = await service.receiveDispute("pay_001", "fraudulent", 0);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
      }
    });
  });

  describe("submitEvidence", () => {
    it("submits evidence and transitions to under_review", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_100", "product_not_received", 2500);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const evidence: EvidenceInput[] = [
        { type: "shipping_proof", description: "Tracking number", content: "TRACK123456" },
        { type: "receipt", description: "Order receipt", content: "Receipt data" },
      ];

      const result = await service.submitEvidence(created.value.id, evidence);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("under_review");
        expect(result.value.respondedAt).toBeTruthy();
        expect(result.value.evidence).toHaveLength(2);
      }

      // Webhook fired
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "dispute.evidence_submitted",
        expect.objectContaining({ evidenceCount: 2 }),
      );
    });

    it("rejects evidence for non-existent dispute", async () => {
      const service = createService();
      const result = await service.submitEvidence("non-existent", []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("rejects evidence after deadline", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_200", "fraudulent", 1000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Manually set evidence deadline to past
      const dispute = prisma._disputes.find((d) => d.id === created.value.id)!;
      dispute.evidenceDueBy = new Date(Date.now() - 86_400_000);

      const result = await service.submitEvidence(created.value.id, [
        { type: "receipt", description: "Late evidence", content: "data" },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("EVIDENCE_DEADLINE_PASSED");
      }
    });

    it("rejects evidence for already resolved dispute", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_300", "general", 500);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Accept the dispute first
      await service.acceptDispute(created.value.id);

      const result = await service.submitEvidence(created.value.id, [
        { type: "other", description: "Too late", content: "data" },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_STATUS");
      }
    });
  });

  describe("resolveDispute", () => {
    it("resolves as won — reverses ledger hold", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_400", "product_unacceptable", 7500);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Submit evidence first to move to under_review
      await service.submitEvidence(created.value.id, [
        { type: "service_documentation", description: "Service records", content: "data" },
      ]);

      const result = await service.resolveDispute(created.value.id, "won");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("won");
        expect(result.value.outcome).toBe("won");
        expect(result.value.resolvedAt).toBeTruthy();
      }

      // Ledger reversal: dispute_holds debit, merchant_balance credit
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "chargeback",
        expect.stringContaining("dispute-won:"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "dispute_holds", direction: "debit" }),
          expect.objectContaining({ accountName: "merchant_balance", direction: "credit" }),
        ]),
        expect.stringContaining("Dispute won"),
      );

      // Webhook
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "dispute.won",
        expect.objectContaining({ outcome: "won" }),
      );
    });

    it("resolves as lost — finalizes debit", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_500", "fraudulent", 10000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.submitEvidence(created.value.id, [
        { type: "customer_communication", description: "Chat logs", content: "data" },
      ]);

      const result = await service.resolveDispute(created.value.id, "lost");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("lost");
        expect(result.value.outcome).toBe("lost");
      }

      // Ledger finalization: dispute_holds debit, provider_settlement credit
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "chargeback",
        expect.stringContaining("dispute-lost:"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "dispute_holds", direction: "debit" }),
          expect.objectContaining({ accountName: "provider_settlement", direction: "credit" }),
        ]),
        expect.stringContaining("Dispute lost"),
      );

      // Webhook
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "dispute.lost",
        expect.objectContaining({ outcome: "lost" }),
      );
    });

    it("rejects invalid transition (needs_response → won)", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_600", "duplicate", 2000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Try to resolve directly without evidence submission
      const result = await service.resolveDispute(created.value.id, "won");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_STATUS");
      }
    });

    it("rejects resolving a non-existent dispute", async () => {
      const service = createService();
      const result = await service.resolveDispute("non-existent", "won");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("acceptDispute", () => {
    it("accepts dispute — finalizes as lost", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_700", "credit_not_processed", 1500);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.acceptDispute(created.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("accepted");
        expect(result.value.outcome).toBe("lost");
        expect(result.value.resolvedAt).toBeTruthy();
      }

      // Ledger finalization
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "chargeback",
        expect.stringContaining("dispute-accepted:"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "dispute_holds", direction: "debit" }),
          expect.objectContaining({ accountName: "provider_settlement", direction: "credit" }),
        ]),
        expect.any(String),
      );

      // Webhook
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "dispute.accepted",
        expect.objectContaining({ paymentId: "pay_700" }),
      );
    });

    it("rejects accepting already resolved dispute", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_800", "general", 500);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.acceptDispute(created.value.id);

      // Try to accept again
      const result = await service.acceptDispute(created.value.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_STATUS");
      }
    });
  });

  describe("getDispute", () => {
    it("returns dispute with evidence", async () => {
      const service = createService();
      const created = await service.receiveDispute("pay_900", "fraudulent", 4000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.getDispute(created.value.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(created.value.id);
        expect(result.value.evidence).toHaveLength(0);
      }
    });

    it("returns not found for non-existent dispute", async () => {
      const service = createService();
      const result = await service.getDispute("non-existent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("listDisputes", () => {
    it("returns all disputes for tenant", async () => {
      const service = createService();
      await service.receiveDispute("pay_a", "fraudulent", 1000);
      await service.receiveDispute("pay_b", "duplicate", 2000);
      await service.receiveDispute("pay_c", "general", 3000);

      const result = await service.listDisputes();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.disputes).toHaveLength(3);
        expect(result.value.total).toBe(3);
      }
    });

    it("filters by status", async () => {
      const service = createService();
      await service.receiveDispute("pay_d", "fraudulent", 1000);
      const created = await service.receiveDispute("pay_e", "duplicate", 2000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await service.acceptDispute(created.value.id);

      const result = await service.listDisputes({ status: "accepted" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.disputes).toHaveLength(1);
        expect(result.value.disputes[0]!.status).toBe("accepted");
      }
    });
  });

  describe("getChargebackRate", () => {
    it("returns zero rate when no disputes or transactions", async () => {
      const service = createService();
      const result = await service.getChargebackRate();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.rate).toBe(0);
        expect(result.value.threshold).toBe("normal");
        expect(result.value.blocked).toBe(false);
        expect(result.value.windowDays).toBe(120);
      }
    });

    it("calculates rate from disputes and transactions", async () => {
      const service = createService();

      // Create some disputes
      await service.receiveDispute("pay_rate_1", "fraudulent", 1000);
      await service.receiveDispute("pay_rate_2", "duplicate", 2000);

      // Simulate 100 transactions in event store
      const mockPrisma = prisma as unknown as { eventStore: { count: ReturnType<typeof vi.fn> } };
      mockPrisma.eventStore.count.mockResolvedValueOnce(2); // dispute count from first call
      mockPrisma.eventStore.count.mockResolvedValueOnce(100); // transaction count

      // Need to re-mock since we already called receiveDispute
      // The count mock for disputes returns based on _disputes array
      // For transaction count, we override
      const originalCount = mockPrisma.eventStore.count;
      mockPrisma.eventStore.count = vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.eventType === "PaymentInitiated") return 200;
        return 0;
      });

      const result = await service.getChargebackRate();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 2 disputes / 200 transactions = 1% → critical
        expect(result.value.disputeCount).toBe(2);
        expect(result.value.transactionCount).toBe(200);
        expect(result.value.rate).toBe(0.01);
        expect(result.value.threshold).toBe("critical");
        expect(result.value.blocked).toBe(true);
      }

      // Restore
      mockPrisma.eventStore.count = originalCount;
    });
  });

  describe("shouldBlockPayments", () => {
    it("returns false when rate is normal", async () => {
      const service = createService();
      const result = await service.shouldBlockPayments();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe("event recording", () => {
    it("records events for full dispute lifecycle", async () => {
      const service = createService();

      // Receive
      const created = await service.receiveDispute("pay_events", "fraudulent", 5000);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Submit evidence
      await service.submitEvidence(created.value.id, [
        { type: "receipt", description: "Receipt", content: "data" },
      ]);

      // Resolve as won
      await service.resolveDispute(created.value.id, "won");

      // Check events
      const events = eventStore._events;
      const disputeEvents = events.filter((e) => e.aggregateId === created.value.id);

      expect(disputeEvents).toHaveLength(3);
      expect(disputeEvents[0]!.eventType).toBe("DisputeReceived");
      expect(disputeEvents[1]!.eventType).toBe("DisputeEvidenceSubmitted");
      expect(disputeEvents[2]!.eventType).toBe("DisputeWon");
    });
  });
});
