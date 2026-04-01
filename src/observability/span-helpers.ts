import { getTracer, withSpan } from "./tracing.js";

const tracer = getTracer("payment-orchestrator");

/**
 * Wraps a saga step execution in a trace span.
 */
export async function traceSagaStep<T>(
  stepName: string,
  paymentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(tracer, `saga.step.${stepName}`, {
    "saga.step": stepName,
    "payment.id": paymentId,
  }, async (span) => {
    const result = await fn();
    span.setAttribute("saga.step.result", "completed");
    return result;
  });
}

/**
 * Wraps a routing decision in a trace span.
 */
export async function traceRouting<T>(
  paymentId: string,
  currency: string,
  amount: number,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(tracer, "routing.select_provider", {
    "payment.id": paymentId,
    "payment.currency": currency,
    "payment.amount": amount,
  }, async (span) => {
    const result = await fn();
    span.setAttribute("routing.result", "selected");
    return result;
  });
}

/**
 * Wraps a fraud evaluation in a trace span.
 */
export async function traceFraudCheck<T>(
  paymentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(tracer, "fraud.evaluate", {
    "payment.id": paymentId,
  }, async (span) => {
    const result = await fn();
    span.setAttribute("fraud.result", "evaluated");
    return result;
  });
}
