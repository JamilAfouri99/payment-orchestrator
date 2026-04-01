import { v4 as uuid } from "uuid";

export interface WebhookEventDefinition {
  type: string;
  category: string;
  description: string;
  payloadFields: PayloadFieldDoc[];
  example: Record<string, unknown>;
}

export interface PayloadFieldDoc {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface WebhookEventEnvelope {
  id: string;
  type: string;
  apiVersion: string;
  createdAt: string;
  data: {
    object: Record<string, unknown>;
  };
}

export const API_VERSION = "2024-01-01";

const PAYMENT_FIELDS: PayloadFieldDoc[] = [
  { name: "id", type: "string", description: "Payment ID", required: true },
  { name: "status", type: "string", description: "Current payment status", required: true },
  { name: "amount", type: "integer", description: "Amount in cents", required: true },
  { name: "currency", type: "string", description: "ISO 4217 currency code", required: true },
  { name: "customerId", type: "string", description: "Customer identifier", required: true },
  { name: "orderId", type: "string", description: "Order identifier", required: true },
  { name: "providerId", type: "string", description: "Payment provider used", required: false },
  { name: "createdAt", type: "string", description: "ISO 8601 timestamp", required: true },
  { name: "updatedAt", type: "string", description: "ISO 8601 timestamp", required: true },
];

const SUBSCRIPTION_FIELDS: PayloadFieldDoc[] = [
  { name: "id", type: "string", description: "Subscription ID", required: true },
  { name: "status", type: "string", description: "Current subscription status", required: true },
  { name: "customerId", type: "string", description: "Customer identifier", required: true },
  { name: "planId", type: "string", description: "Subscription plan ID", required: true },
  { name: "currentPeriodStart", type: "string", description: "Current billing period start", required: true },
  { name: "currentPeriodEnd", type: "string", description: "Current billing period end", required: true },
  { name: "cancelAtPeriodEnd", type: "boolean", description: "Whether subscription cancels at period end", required: true },
];

const DISPUTE_FIELDS: PayloadFieldDoc[] = [
  { name: "id", type: "string", description: "Dispute ID", required: true },
  { name: "status", type: "string", description: "Current dispute status", required: true },
  { name: "paymentId", type: "string", description: "Associated payment ID", required: true },
  { name: "reason", type: "string", description: "Dispute reason", required: true },
  { name: "amount", type: "integer", description: "Disputed amount in cents", required: true },
  { name: "type", type: "string", description: "Dispute type (chargeback, inquiry, pre_arbitration)", required: true },
  { name: "evidenceDeadline", type: "string", description: "Deadline for submitting evidence", required: false },
];

const PAYOUT_FIELDS: PayloadFieldDoc[] = [
  { name: "id", type: "string", description: "Payout ID", required: true },
  { name: "status", type: "string", description: "Current payout status", required: true },
  { name: "amount", type: "integer", description: "Payout amount in cents", required: true },
  { name: "currency", type: "string", description: "ISO 4217 currency code", required: true },
  { name: "merchantAccountId", type: "string", description: "Merchant account ID", required: true },
  { name: "payoutAccountId", type: "string", description: "Destination payout account", required: true },
  { name: "arrivalDate", type: "string", description: "Expected arrival date", required: false },
];

const MERCHANT_FIELDS: PayloadFieldDoc[] = [
  { name: "tenantId", type: "string", description: "Tenant ID", required: true },
  { name: "name", type: "string", description: "Merchant name", required: true },
  { name: "status", type: "string", description: "Merchant status", required: true },
  { name: "country", type: "string", description: "Business country", required: true },
];

const EXAMPLE_PAYMENT: Record<string, unknown> = {
  id: "pay_abc123",
  status: "completed",
  amount: 5000,
  currency: "USD",
  customerId: "cus_xyz",
  orderId: "ord_456",
  providerId: "stripe",
  createdAt: "2024-01-15T10:30:00Z",
  updatedAt: "2024-01-15T10:30:05Z",
};

const EXAMPLE_SUBSCRIPTION: Record<string, unknown> = {
  id: "sub_abc123",
  status: "active",
  customerId: "cus_xyz",
  planId: "plan_pro",
  currentPeriodStart: "2024-01-01T00:00:00Z",
  currentPeriodEnd: "2024-02-01T00:00:00Z",
  cancelAtPeriodEnd: false,
};

const EXAMPLE_DISPUTE: Record<string, unknown> = {
  id: "dsp_abc123",
  status: "open",
  paymentId: "pay_abc123",
  reason: "fraudulent",
  amount: 5000,
  type: "chargeback",
  evidenceDeadline: "2024-02-15T23:59:59Z",
};

const EXAMPLE_PAYOUT: Record<string, unknown> = {
  id: "po_abc123",
  status: "paid",
  amount: 450000,
  currency: "USD",
  merchantAccountId: "ma_xyz",
  payoutAccountId: "pa_bank1",
  arrivalDate: "2024-01-20T00:00:00Z",
};

const EXAMPLE_MERCHANT: Record<string, unknown> = {
  tenantId: "tenant_abc123",
  name: "Acme Corp",
  status: "active",
  country: "US",
};

const EVENT_DEFINITIONS: WebhookEventDefinition[] = [
  // Payment events
  {
    type: "payment.created",
    category: "payment",
    description: "A new payment has been initiated. The payment enters the saga orchestration flow.",
    payloadFields: PAYMENT_FIELDS,
    example: { ...EXAMPLE_PAYMENT, status: "pending" },
  },
  {
    type: "payment.authorized",
    category: "payment",
    description: "Payment has been successfully charged by the payment provider. Funds are authorized.",
    payloadFields: PAYMENT_FIELDS,
    example: { ...EXAMPLE_PAYMENT, status: "charging" },
  },
  {
    type: "payment.captured",
    category: "payment",
    description: "Payment has been fully captured and the saga completed successfully.",
    payloadFields: PAYMENT_FIELDS,
    example: EXAMPLE_PAYMENT,
  },
  {
    type: "payment.failed",
    category: "payment",
    description: "Payment has failed. Compensation steps have been executed (inventory released, refund issued if needed).",
    payloadFields: PAYMENT_FIELDS,
    example: { ...EXAMPLE_PAYMENT, status: "failed", error: "Payment provider declined the charge" },
  },
  {
    type: "payment.refunded",
    category: "payment",
    description: "A full refund has been processed for this payment.",
    payloadFields: PAYMENT_FIELDS,
    example: { ...EXAMPLE_PAYMENT, status: "compensated" },
  },
  {
    type: "payment.partially_refunded",
    category: "payment",
    description: "A partial refund has been issued via split payment adjustments.",
    payloadFields: [...PAYMENT_FIELDS, { name: "refundedAmount", type: "integer", description: "Amount refunded in cents", required: true }],
    example: { ...EXAMPLE_PAYMENT, refundedAmount: 2500 },
  },

  // Subscription events
  {
    type: "subscription.created",
    category: "subscription",
    description: "A new subscription has been created. May start with a trial period.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: { ...EXAMPLE_SUBSCRIPTION, status: "created" },
  },
  {
    type: "subscription.activated",
    category: "subscription",
    description: "Subscription is now active. First payment has been processed successfully.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: EXAMPLE_SUBSCRIPTION,
  },
  {
    type: "subscription.trial_ending",
    category: "subscription",
    description: "Subscription trial period ends within 3 days. Send a reminder to the customer.",
    payloadFields: [...SUBSCRIPTION_FIELDS, { name: "trialEnd", type: "string", description: "Trial end date", required: true }],
    example: { ...EXAMPLE_SUBSCRIPTION, status: "trialing", trialEnd: "2024-01-18T00:00:00Z" },
  },
  {
    type: "subscription.renewed",
    category: "subscription",
    description: "Subscription has been successfully renewed for a new billing cycle.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: { ...EXAMPLE_SUBSCRIPTION, currentPeriodStart: "2024-02-01T00:00:00Z", currentPeriodEnd: "2024-03-01T00:00:00Z" },
  },
  {
    type: "subscription.past_due",
    category: "subscription",
    description: "Renewal payment has failed. Subscription enters dunning (automated retry) flow.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: { ...EXAMPLE_SUBSCRIPTION, status: "past_due" },
  },
  {
    type: "subscription.canceled",
    category: "subscription",
    description: "Subscription has been canceled. May happen immediately or at end of billing period.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: { ...EXAMPLE_SUBSCRIPTION, status: "canceled", cancelAtPeriodEnd: true },
  },
  {
    type: "subscription.paused",
    category: "subscription",
    description: "Subscription has been paused. No billing will occur until resumed.",
    payloadFields: SUBSCRIPTION_FIELDS,
    example: { ...EXAMPLE_SUBSCRIPTION, status: "paused" },
  },

  // Dispute events
  {
    type: "dispute.created",
    category: "dispute",
    description: "A new dispute (chargeback, inquiry, or pre-arbitration) has been received.",
    payloadFields: DISPUTE_FIELDS,
    example: EXAMPLE_DISPUTE,
  },
  {
    type: "dispute.evidence_required",
    category: "dispute",
    description: "Evidence submission deadline is approaching. Submit evidence before the deadline.",
    payloadFields: DISPUTE_FIELDS,
    example: EXAMPLE_DISPUTE,
  },
  {
    type: "dispute.won",
    category: "dispute",
    description: "Dispute has been resolved in the merchant's favor. Funds will be returned.",
    payloadFields: DISPUTE_FIELDS,
    example: { ...EXAMPLE_DISPUTE, status: "won" },
  },
  {
    type: "dispute.lost",
    category: "dispute",
    description: "Dispute has been resolved in the cardholder's favor. Funds are permanently debited.",
    payloadFields: DISPUTE_FIELDS,
    example: { ...EXAMPLE_DISPUTE, status: "lost" },
  },

  // Payout events
  {
    type: "payout.created",
    category: "payout",
    description: "A new payout has been initiated for the merchant.",
    payloadFields: PAYOUT_FIELDS,
    example: { ...EXAMPLE_PAYOUT, status: "pending" },
  },
  {
    type: "payout.processing",
    category: "payout",
    description: "Payout is being processed by the banking system.",
    payloadFields: PAYOUT_FIELDS,
    example: { ...EXAMPLE_PAYOUT, status: "processing" },
  },
  {
    type: "payout.paid",
    category: "payout",
    description: "Payout has been delivered to the merchant's bank account.",
    payloadFields: PAYOUT_FIELDS,
    example: EXAMPLE_PAYOUT,
  },
  {
    type: "payout.failed",
    category: "payout",
    description: "Payout has failed due to bank rejection or insufficient balance.",
    payloadFields: PAYOUT_FIELDS,
    example: { ...EXAMPLE_PAYOUT, status: "failed" },
  },

  // Merchant events
  {
    type: "merchant.verified",
    category: "merchant",
    description: "Merchant KYB has been approved and the account is verified for production payments.",
    payloadFields: MERCHANT_FIELDS,
    example: EXAMPLE_MERCHANT,
  },
  {
    type: "merchant.suspended",
    category: "merchant",
    description: "Merchant account has been suspended due to policy violation or excessive chargebacks.",
    payloadFields: MERCHANT_FIELDS,
    example: { ...EXAMPLE_MERCHANT, status: "suspended" },
  },
];

export interface WebhookCatalog {
  getEvents(): WebhookEventDefinition[];
  getEvent(type: string): WebhookEventDefinition | null;
  getEventsByCategory(category: string): WebhookEventDefinition[];
  getCategories(): string[];
  buildEnvelope(type: string, resource: Record<string, unknown>): WebhookEventEnvelope;
}

export function createWebhookCatalog(): WebhookCatalog {
  const eventMap = new Map<string, WebhookEventDefinition>();
  for (const def of EVENT_DEFINITIONS) {
    eventMap.set(def.type, def);
  }

  return {
    getEvents(): WebhookEventDefinition[] {
      return [...EVENT_DEFINITIONS];
    },

    getEvent(type: string): WebhookEventDefinition | null {
      return eventMap.get(type) ?? null;
    },

    getEventsByCategory(category: string): WebhookEventDefinition[] {
      return EVENT_DEFINITIONS.filter((e) => e.category === category);
    },

    getCategories(): string[] {
      const categories = new Set<string>();
      for (const def of EVENT_DEFINITIONS) {
        categories.add(def.category);
      }
      return [...categories];
    },

    buildEnvelope(type: string, resource: Record<string, unknown>): WebhookEventEnvelope {
      return {
        id: `evt_${uuid()}`,
        type,
        apiVersion: API_VERSION,
        createdAt: new Date().toISOString(),
        data: { object: resource },
      };
    },
  };
}
