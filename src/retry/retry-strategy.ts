import { getDeclineCode, isHardDecline, type DeclineCategory } from "./decline-codes.js";

export interface RetryAction {
  action: "fail" | "retry_alternate" | "retry_later";
  reason: string;
  delayMs?: number | undefined;
  maxRetries: number;
}

export interface RetrySchedule {
  attempt: number;
  delayMs: number;
  provider: "same" | "alternate";
}

export interface RetryStrategy {
  analyze(declineCode: string): RetryAction;
  getSchedule(declineCode: string, attempt: number): RetrySchedule;
  shouldRetry(declineCode: string, currentAttempt: number): boolean;
}

export function createRetryStrategy(): RetryStrategy {
  return {
    analyze(declineCode) {
      if (isHardDecline(declineCode)) {
        const def = getDeclineCode(declineCode);
        return {
          action: "fail",
          reason: def?.description ?? `Hard decline: ${declineCode}`,
          maxRetries: 0,
        };
      }

      const def = getDeclineCode(declineCode);
      if (!def) {
        return {
          action: "retry_alternate",
          reason: `Unknown decline code: ${declineCode}`,
          maxRetries: 2,
        };
      }

      if (def.suggestedAction === "retry_later") {
        return {
          action: "retry_later",
          reason: def.description,
          delayMs: computeBackoff(1),
          maxRetries: def.maxRetries,
        };
      }

      return {
        action: "retry_alternate",
        reason: def.description,
        maxRetries: def.maxRetries,
      };
    },

    getSchedule(declineCode, attempt) {
      const def = getDeclineCode(declineCode);
      const category: DeclineCategory = def?.category ?? "soft";

      return {
        attempt,
        delayMs: computeBackoff(attempt),
        provider: category === "retriable" ? "same" : "alternate",
      };
    },

    shouldRetry(declineCode, currentAttempt) {
      if (isHardDecline(declineCode)) return false;
      const def = getDeclineCode(declineCode);
      const maxRetries = def?.maxRetries ?? 2;
      return currentAttempt < maxRetries;
    },
  };
}

function computeBackoff(attempt: number): number {
  const base = 2000;
  const exponential = base * Math.pow(2, Math.min(attempt - 1, 4));
  const jitter = exponential * 0.1 * Math.random();
  return Math.round(exponential + jitter);
}
