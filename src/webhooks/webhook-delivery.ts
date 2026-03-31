import { createHmac } from "crypto";
import { PrismaClient } from "@prisma/client";
import { type Result, ok, err } from "../core/result.js";

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly code: "DELIVERY_FAILED" | "REGISTRATION_FAILED" | "DLQ_FAILED",
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface WebhookPayload {
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface WebhookDeliveryService {
  /**
   * Registers a URL to receive webhook events.
   * @param url - The callback URL
   * @param events - Event types to subscribe to (default: all)
   * @returns Registration ID or error
   */
  register(url: string, events?: string[]): Promise<Result<string, WebhookError>>;

  /**
   * Dispatches a webhook event to all registered URLs.
   * Failed deliveries are retried up to 3 times with exponential backoff.
   * Permanently failed deliveries go to the dead-letter queue.
   * @param eventType - The event type
   * @param payload - Event data
   * @returns Void on success or error
   */
  dispatch(eventType: string, payload: Record<string, unknown>): Promise<Result<void, WebhookError>>;

  /**
   * Processes pending retries. Called by a periodic job.
   * @returns Number of deliveries processed
   */
  processRetries(): Promise<Result<number, WebhookError>>;
}

/**
 * Creates a webhook delivery service with HMAC-SHA256 signatures and DLQ.
 * @param prisma - PrismaClient instance
 * @param secret - HMAC secret for signing payloads
 * @param fetchFn - Fetch implementation (for testing)
 * @returns WebhookDeliveryService instance
 */
export function createWebhookDeliveryService(
  prisma: PrismaClient,
  secret: string,
  fetchFn: typeof fetch = globalThis.fetch,
): WebhookDeliveryService {
  const MAX_ATTEMPTS = 3;

  return {
    async register(url, events = ["*"]) {
      try {
        const registration = await prisma.webhookRegistration.create({
          data: {
            url,
            events: JSON.parse(JSON.stringify(events)),
          },
        });
        return ok(registration.id);
      } catch (error) {
        return err(
          new WebhookError(
            `Failed to register webhook: ${error instanceof Error ? error.message : String(error)}`,
            "REGISTRATION_FAILED",
          ),
        );
      }
    },

    async dispatch(eventType, payload) {
      try {
        const registrations = await prisma.webhookRegistration.findMany({
          where: { active: true },
        });

        const matchingRegistrations = registrations.filter((reg) => {
          const events = reg.events as string[];
          return events.includes("*") || events.includes(eventType);
        });

        for (const reg of matchingRegistrations) {
          const webhookPayload: WebhookPayload = {
            eventType,
            payload,
            timestamp: new Date().toISOString(),
          };

          const delivery = await prisma.webhookDelivery.create({
            data: {
              registrationId: reg.id,
              eventType,
              payload: JSON.parse(JSON.stringify(webhookPayload)),
              url: reg.url,
              status: "pending",
            },
          });

          await attemptDelivery(prisma, delivery.id, reg.url, webhookPayload, secret, fetchFn, MAX_ATTEMPTS);
        }

        return ok(undefined);
      } catch (error) {
        return err(
          new WebhookError(
            `Failed to dispatch webhook: ${error instanceof Error ? error.message : String(error)}`,
            "DELIVERY_FAILED",
          ),
        );
      }
    },

    async processRetries() {
      try {
        const pending = await prisma.webhookDelivery.findMany({
          where: {
            status: "pending",
            nextRetryAt: { lte: new Date() },
          },
        });

        let processed = 0;
        for (const delivery of pending) {
          const payload = delivery.payload as unknown as WebhookPayload;
          await attemptDelivery(
            prisma,
            delivery.id,
            delivery.url,
            payload,
            secret,
            fetchFn,
            MAX_ATTEMPTS,
          );
          processed++;
        }

        return ok(processed);
      } catch (error) {
        return err(
          new WebhookError(
            `Failed to process retries: ${error instanceof Error ? error.message : String(error)}`,
            "DELIVERY_FAILED",
          ),
        );
      }
    },
  };
}

/**
 * Generates an HMAC-SHA256 signature for a webhook payload.
 * @param payload - The serialized payload
 * @param secret - The HMAC secret
 * @returns Hex-encoded signature
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verifies an HMAC-SHA256 signature.
 * @param payload - The serialized payload
 * @param signature - The signature to verify
 * @param secret - The HMAC secret
 * @returns True if the signature is valid
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  if (expected.length !== signature.length) return false;

  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= (expected.charCodeAt(i) ?? 0) ^ (signature.charCodeAt(i) ?? 0);
  }
  return mismatch === 0;
}

async function attemptDelivery(
  prisma: PrismaClient,
  deliveryId: string,
  url: string,
  payload: WebhookPayload,
  secret: string,
  fetchFn: typeof fetch,
  maxAttempts: number,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": payload.timestamp,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "delivered",
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });
      return;
    }

    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });

    const currentAttempts = (delivery?.attempts ?? 0) + 1;

    if (currentAttempts >= maxAttempts) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "dead_lettered",
          attempts: currentAttempts,
          lastAttemptAt: new Date(),
          lastError: errorMsg,
        },
      });

      await prisma.deadLetterQueue.create({
        data: {
          sourceType: "webhook",
          sourceId: deliveryId,
          payload: JSON.parse(JSON.stringify(payload)),
          error: errorMsg,
          attempts: currentAttempts,
        },
      });
    } else {
      const backoffMs = 1000 * Math.pow(2, currentAttempts - 1);
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: currentAttempts,
          lastAttemptAt: new Date(),
          lastError: errorMsg,
          nextRetryAt: new Date(Date.now() + backoffMs),
        },
      });
    }
  }
}
