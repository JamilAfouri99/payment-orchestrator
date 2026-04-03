import { type Result, ok, err } from "../core/result.js";
import type { PaymentState, DomainEvent } from "../core/types.js";
import { fullPaymentReducer, initialPaymentState } from "../events/payment-projection.js";
import { SNAPSHOT_THRESHOLD } from "../events/snapshot-store.js";
import { PaymentServiceError, type PaymentListResult } from "./payment-service.js";
import type { TenantServices } from "./tenant-services.js";

export interface QueryDeps {
  getTenantServices(tenantId: string): TenantServices;
  deriveState(tenantId: string, paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
}

export async function getPayment(
  tenantId: string,
  paymentId: string,
  deps: QueryDeps,
): Promise<Result<PaymentState, PaymentServiceError>> {
  const result = await deps.deriveState(tenantId, paymentId);
  if (!result.ok) return result;
  if (result.value.amount === 0 && result.value.status === "pending") {
    return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
  }
  return ok(result.value);
}

export async function getPaymentAt(
  tenantId: string,
  paymentId: string,
  at: Date,
  deps: QueryDeps,
): Promise<Result<PaymentState, PaymentServiceError>> {
  const { eventStore } = deps.getTenantServices(tenantId);
  const result = await eventStore.replayAt(
    paymentId,
    at,
    fullPaymentReducer,
    initialPaymentState(paymentId),
  );
  if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
  if (result.value.amount === 0 && result.value.status === "pending") {
    return err(new PaymentServiceError(
      `No events found for payment ${paymentId} at ${at.toISOString()}`,
      "NOT_FOUND",
    ));
  }
  return ok(result.value);
}

export async function replayPayment(
  tenantId: string,
  paymentId: string,
  deps: QueryDeps,
): Promise<Result<PaymentState, PaymentServiceError>> {
  const { eventStore, snapshotStore } = deps.getTenantServices(tenantId);
  const result = await eventStore.replay(
    paymentId,
    fullPaymentReducer,
    initialPaymentState(paymentId),
  );
  if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
  if (result.value.amount === 0 && result.value.status === "pending") {
    return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
  }

  const events = await eventStore.getByAggregateId(paymentId);
  if (events.ok && events.value.length >= SNAPSHOT_THRESHOLD) {
    await snapshotStore.save(paymentId, "Payment", events.value.length, result.value);
  }

  return ok(result.value);
}

export async function listPayments(
  tenantId: string,
  limit: number,
  offset: number,
  deps: QueryDeps,
): Promise<Result<PaymentListResult, PaymentServiceError>> {
  const { eventStore } = deps.getTenantServices(tenantId);
  const countResult = await eventStore.countAggregates();
  if (!countResult.ok) return err(new PaymentServiceError(countResult.error.message, "INTERNAL"));

  const idsResult = await eventStore.listAggregates(limit, offset);
  if (!idsResult.ok) return err(new PaymentServiceError(idsResult.error.message, "INTERNAL"));

  const payments: PaymentState[] = [];
  for (const id of idsResult.value) {
    const stateResult = await deps.deriveState(tenantId, id);
    if (stateResult.ok) {
      payments.push(stateResult.value);
    }
  }

  return ok({ payments, total: countResult.value });
}

export async function getPaymentEvents(
  tenantId: string,
  paymentId: string,
  deps: QueryDeps,
): Promise<Result<DomainEvent[], PaymentServiceError>> {
  const { eventStore } = deps.getTenantServices(tenantId);
  const result = await eventStore.getByAggregateId(paymentId);
  if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
  if (result.value.length === 0) {
    return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
  }
  return ok(result.value);
}
