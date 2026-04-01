import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import { createHash } from "crypto";

export interface TokenizedCard {
  token: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  customerId: string;
  status: "active" | "expired" | "revoked";
  usageCount: number;
  createdAt: string;
}

export interface CardInput {
  pan: string;
  expiryMonth: number;
  expiryYear: number;
  brand: string;
  customerId: string;
}

export class TokenError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "EXPIRED" | "REVOKED" | "VAULT_FAILURE",
  ) {
    super(message);
    this.name = "TokenError";
  }
}

export interface TokenVault {
  tokenize(card: CardInput): Promise<Result<TokenizedCard, TokenError>>;
  getToken(token: string): Promise<Result<TokenizedCard, TokenError>>;
  useToken(token: string): Promise<Result<TokenizedCard, TokenError>>;
  revokeToken(token: string): Promise<Result<void, TokenError>>;
  listByCustomer(customerId: string): Promise<Result<TokenizedCard[], TokenError>>;
  expireStale(): Promise<Result<number, TokenError>>;
}

export function createTokenVault(prisma: PrismaClient): TokenVault {
  function simulateEncrypt(pan: string): string {
    return createHash("sha256").update(`vault:${pan}`).digest("hex");
  }

  function toTokenizedCard(record: {
    token: string;
    last4: string;
    brand: string;
    expiryMonth: number;
    expiryYear: number;
    customerId: string;
    status: string;
    usageCount: number;
    createdAt: Date;
  }): TokenizedCard {
    return {
      token: record.token,
      last4: record.last4,
      brand: record.brand,
      expiryMonth: record.expiryMonth,
      expiryYear: record.expiryYear,
      customerId: record.customerId,
      status: record.status as "active" | "expired" | "revoked",
      usageCount: record.usageCount,
      createdAt: record.createdAt.toISOString(),
    };
  }

  return {
    async tokenize(card) {
      try {
        const token = `tok_${uuid().replace(/-/g, "").slice(0, 24)}`;
        const last4 = card.pan.slice(-4);
        const encrypted = simulateEncrypt(card.pan);

        const record = await prisma.paymentToken.create({
          data: {
            id: uuid(),
            token,
            customerId: card.customerId,
            last4,
            brand: card.brand,
            expiryMonth: card.expiryMonth,
            expiryYear: card.expiryYear,
            encryptedPan: encrypted,
          },
        });

        return ok(toTokenizedCard(record));
      } catch (error) {
        return err(new TokenError(
          `Tokenization failed: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },

    async getToken(token) {
      try {
        const record = await prisma.paymentToken.findUnique({ where: { token } });
        if (!record) return err(new TokenError(`Token not found: ${token}`, "NOT_FOUND"));
        return ok(toTokenizedCard(record));
      } catch (error) {
        return err(new TokenError(
          `Failed to get token: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },

    async useToken(token) {
      try {
        const record = await prisma.paymentToken.findUnique({ where: { token } });
        if (!record) return err(new TokenError(`Token not found: ${token}`, "NOT_FOUND"));
        if (record.status === "revoked") return err(new TokenError(`Token revoked: ${token}`, "REVOKED"));
        if (record.status === "expired") return err(new TokenError(`Token expired: ${token}`, "EXPIRED"));

        const updated = await prisma.paymentToken.update({
          where: { token },
          data: { usageCount: { increment: 1 } },
        });

        return ok(toTokenizedCard(updated));
      } catch (error) {
        return err(new TokenError(
          `Failed to use token: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },

    async revokeToken(token) {
      try {
        const record = await prisma.paymentToken.findUnique({ where: { token } });
        if (!record) return err(new TokenError(`Token not found: ${token}`, "NOT_FOUND"));

        await prisma.paymentToken.update({
          where: { token },
          data: { status: "revoked" },
        });

        return ok(undefined);
      } catch (error) {
        return err(new TokenError(
          `Failed to revoke token: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },

    async listByCustomer(customerId) {
      try {
        const records = await prisma.paymentToken.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
        });
        return ok(records.map(toTokenizedCard));
      } catch (error) {
        return err(new TokenError(
          `Failed to list tokens: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },

    async expireStale() {
      try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const result = await prisma.paymentToken.updateMany({
          where: {
            status: "active",
            OR: [
              { expiryYear: { lt: currentYear } },
              { expiryYear: currentYear, expiryMonth: { lt: currentMonth } },
            ],
          },
          data: { status: "expired" },
        });

        return ok(result.count);
      } catch (error) {
        return err(new TokenError(
          `Failed to expire tokens: ${error instanceof Error ? error.message : String(error)}`,
          "VAULT_FAILURE",
        ));
      }
    },
  };
}
