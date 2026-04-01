export type DeclineCategory = "hard" | "soft" | "retriable";

export interface DeclineCodeDef {
  code: string;
  category: DeclineCategory;
  description: string;
  retryable: boolean;
  suggestedAction: "block" | "retry_alternate" | "retry_same" | "retry_later";
  maxRetries: number;
}

const DECLINE_CODES: DeclineCodeDef[] = [
  // Hard declines — never retry
  { code: "fraud_suspected", category: "hard", description: "Suspected fraud", retryable: false, suggestedAction: "block", maxRetries: 0 },
  { code: "stolen_card", category: "hard", description: "Card reported stolen", retryable: false, suggestedAction: "block", maxRetries: 0 },
  { code: "card_blocked", category: "hard", description: "Card permanently blocked", retryable: false, suggestedAction: "block", maxRetries: 0 },
  { code: "invalid_account", category: "hard", description: "Account number invalid", retryable: false, suggestedAction: "block", maxRetries: 0 },

  // Soft declines — retry on alternate provider
  { code: "processor_unavailable", category: "soft", description: "Processor temporarily unavailable", retryable: true, suggestedAction: "retry_alternate", maxRetries: 3 },
  { code: "timeout", category: "soft", description: "Request timed out", retryable: true, suggestedAction: "retry_alternate", maxRetries: 3 },
  { code: "rate_limited", category: "soft", description: "Provider rate limit exceeded", retryable: true, suggestedAction: "retry_alternate", maxRetries: 3 },
  { code: "do_not_honor", category: "soft", description: "Issuer declined without reason", retryable: true, suggestedAction: "retry_alternate", maxRetries: 2 },

  // Retriable declines — retry same provider later
  { code: "insufficient_funds", category: "retriable", description: "Insufficient funds", retryable: true, suggestedAction: "retry_later", maxRetries: 2 },
  { code: "expired_card", category: "retriable", description: "Card expired", retryable: true, suggestedAction: "retry_later", maxRetries: 1 },
  { code: "temporary_hold", category: "retriable", description: "Temporary hold on account", retryable: true, suggestedAction: "retry_later", maxRetries: 2 },
];

const CODE_MAP = new Map(DECLINE_CODES.map((d) => [d.code, d]));

export function getDeclineCode(code: string): DeclineCodeDef | undefined {
  return CODE_MAP.get(code);
}

export function getAllDeclineCodes(): DeclineCodeDef[] {
  return [...DECLINE_CODES];
}

export function classifyDecline(code: string): DeclineCategory {
  return CODE_MAP.get(code)?.category ?? "soft";
}

export function isHardDecline(code: string): boolean {
  return classifyDecline(code) === "hard";
}

export function randomDeclineCode(): string {
  const codes = DECLINE_CODES;
  return codes[Math.floor(Math.random() * codes.length)]!.code;
}
