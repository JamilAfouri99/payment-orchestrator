import type { DomainEvent, PaymentState, PaymentStatus, OrderItem, Cents } from "../core/types.js";

/**
 * Derives PaymentState by replaying a sequence of domain events.
 * This is the sole source of truth for payment state — no mutable columns.
 * @param state - Current accumulated state
 * @param event - Next event to apply
 * @returns Updated state
 */
export function paymentReducer(state: PaymentState, event: DomainEvent): PaymentState {
  const statusMap: Partial<Record<string, PaymentStatus>> = {
    PaymentInitiated: "pending",
    PaymentValidated: "reserving_inventory",
    PaymentValidationFailed: "failed",
    InventoryReserved: "charging",
    InventoryReservationFailed: "failed",
    PaymentCharged: "notifying",
    PaymentChargeFailed: "failed",
    NotificationSent: "completed",
    NotificationFailed: "completed",
    PaymentCompleted: "completed",
    PaymentFailed: "failed",
    CompensationStarted: "compensating",
    CompensationCompleted: "compensated",
    FraudBlocked: "failed",
  };

  const newStatus = statusMap[event.eventType];
  const payload = event.payload;

  let next: PaymentState = {
    ...state,
    status: newStatus ?? state.status,
    error: typeof payload["error"] === "string" ? payload["error"] : state.error,
    updatedAt: event.createdAt.toISOString(),
  };

  if (event.eventType === "ProviderSelected" || event.eventType === "PaymentCharged") {
    if (typeof payload["providerId"] === "string") {
      next = { ...next, providerId: payload["providerId"] };
    }
  }

  if (event.eventType === "PaymentDeclined") {
    if (typeof payload["declineCode"] === "string") {
      next = { ...next, declineCode: payload["declineCode"] };
    }
  }

  if (event.eventType === "FraudCleared" || event.eventType === "FraudReview" || event.eventType === "FraudBlocked") {
    if (typeof payload["score"] === "number") {
      next = { ...next, fraudScore: payload["score"] };
    }
    if (typeof payload["action"] === "string") {
      next = { ...next, fraudAction: payload["action"] };
    }
  }

  if (event.eventType === "CardTokenized" || event.eventType === "TokenUsed") {
    if (typeof payload["tokenId"] === "string") {
      next = { ...next, tokenId: payload["tokenId"] };
    }
  }

  if (event.eventType === "CurrencyConverted") {
    if (typeof payload["rate"] === "number") next = { ...next, fxRate: payload["rate"] };
    if (typeof payload["originalAmount"] === "number") next = { ...next, fxOriginalAmount: payload["originalAmount"] as Cents };
    if (typeof payload["originalCurrency"] === "string") next = { ...next, fxOriginalCurrency: payload["originalCurrency"] };
  }

  return next;
}

/**
 * Creates the initial payment state from a PaymentInitiated event payload.
 * @param paymentId - The aggregate ID
 * @returns Initial PaymentState before any events are applied
 */
export function initialPaymentState(paymentId: string): PaymentState {
  return {
    id: paymentId,
    status: "pending",
    amount: 0,
    currency: "USD",
    customerId: "",
    orderId: "",
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Enriched reducer that also captures initial data from PaymentInitiated.
 * @param state - Current state
 * @param event - Event to apply
 * @returns Updated state with initial data populated
 */
export function fullPaymentReducer(state: PaymentState, event: DomainEvent): PaymentState {
  let next = paymentReducer(state, event);

  if (event.eventType === "PaymentInitiated") {
    const p = event.payload;
    next = {
      ...next,
      amount: typeof p["amount"] === "number" ? p["amount"] : next.amount,
      currency: typeof p["currency"] === "string" ? p["currency"] : next.currency,
      customerId: typeof p["customerId"] === "string" ? p["customerId"] : next.customerId,
      orderId: typeof p["orderId"] === "string" ? p["orderId"] : next.orderId,
      items: Array.isArray(p["items"]) ? (p["items"] as OrderItem[]) : next.items,
      region: typeof p["region"] === "string" ? p["region"] : next.region,
      createdAt: event.createdAt.toISOString(),
    };
  }

  return next;
}
