import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTokenVault, type CardInput } from "./token-vault.js";

function makeCard(overrides: Partial<CardInput> = {}): CardInput {
  return {
    pan: "4111111111111234",
    expiryMonth: 12,
    expiryYear: 2030,
    brand: "visa",
    customerId: "cust_1",
    ...overrides,
  };
}

type TokenRecord = {
  id: string;
  token: string;
  customerId: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  encryptedPan: string;
  status: string;
  usageCount: number;
  createdAt: Date;
};

function createMockPrisma() {
  const store = new Map<string, TokenRecord>();

  return {
    _store: store,
    paymentToken: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Omit<TokenRecord, "status" | "usageCount" | "createdAt"> }) => {
        const record: TokenRecord = {
          ...data,
          status: "active",
          usageCount: 0,
          createdAt: new Date(),
        };
        store.set(data.token, record);
        return record;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { token: string } }) => {
        return store.get(where.token) ?? null;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { token: string }; data: Record<string, unknown> }) => {
        const record = store.get(where.token);
        if (!record) throw new Error("Record not found");

        if (data["usageCount"] && typeof data["usageCount"] === "object" && "increment" in data["usageCount"]) {
          record.usageCount += (data["usageCount"] as { increment: number }).increment;
        }
        if (typeof data["status"] === "string") {
          record.status = data["status"];
        }

        store.set(where.token, record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { customerId: string } }) => {
        return [...store.values()]
          .filter((r) => r.customerId === where.customerId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as import("@prisma/client").PrismaClient & { _store: Map<string, TokenRecord> };
}

describe("TokenVault — tokenize", () => {
  it("returns a TokenizedCard with the correct last4 digits", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.tokenize(makeCard({ pan: "4111111111111234" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.last4).toBe("1234");
  });

  it("returns a token string prefixed with tok_", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.tokenize(makeCard());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token).toMatch(/^tok_/);
  });

  it("returns status active and usageCount 0 on creation", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.tokenize(makeCard());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("active");
    expect(result.value.usageCount).toBe(0);
  });

  it("returns the correct brand, expiryMonth, and expiryYear", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.tokenize(makeCard({ brand: "mastercard", expiryMonth: 6, expiryYear: 2027 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brand).toBe("mastercard");
    expect(result.value.expiryMonth).toBe(6);
    expect(result.value.expiryYear).toBe(2027);
  });

  it("generates unique tokens for different calls with the same PAN", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const r1 = await vault.tokenize(makeCard());
    const r2 = await vault.tokenize(makeCard());

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.token).not.toBe(r2.value.token);
  });

  it("returns VAULT_FAILURE when the database throws", async () => {
    const prisma = createMockPrisma();
    (prisma.paymentToken.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const vault = createTokenVault(prisma);

    const result = await vault.tokenize(makeCard());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VAULT_FAILURE");
  });
});

describe("TokenVault — useToken", () => {
  it("increments usageCount by 1 on each use", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const tokenResult = await vault.tokenize(makeCard());
    expect(tokenResult.ok).toBe(true);
    if (!tokenResult.ok) return;

    const use1 = await vault.useToken(tokenResult.value.token);
    expect(use1.ok).toBe(true);
    if (!use1.ok) return;
    expect(use1.value.usageCount).toBe(1);

    const use2 = await vault.useToken(tokenResult.value.token);
    expect(use2.ok).toBe(true);
    if (!use2.ok) return;
    expect(use2.value.usageCount).toBe(2);
  });

  it("returns NOT_FOUND when the token does not exist", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.useToken("tok_doesnotexist");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns REVOKED when the token has been revoked", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const tokenResult = await vault.tokenize(makeCard());
    expect(tokenResult.ok).toBe(true);
    if (!tokenResult.ok) return;

    await vault.revokeToken(tokenResult.value.token);
    const result = await vault.useToken(tokenResult.value.token);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REVOKED");
  });

  it("returns EXPIRED when the token status is expired", async () => {
    const prisma = createMockPrisma();
    // Seed a token with expired status directly in the store
    const expiredRecord: TokenRecord = {
      id: "id_expired",
      token: "tok_expired",
      customerId: "cust_1",
      last4: "1234",
      brand: "visa",
      expiryMonth: 1,
      expiryYear: 2020,
      encryptedPan: "hash",
      status: "expired",
      usageCount: 0,
      createdAt: new Date(),
    };
    (prisma as unknown as { _store: Map<string, TokenRecord> })._store.set("tok_expired", expiredRecord);

    const vault = createTokenVault(prisma);
    const result = await vault.useToken("tok_expired");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXPIRED");
  });
});

describe("TokenVault — revokeToken", () => {
  it("returns ok(undefined) on successful revocation", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const tokenResult = await vault.tokenize(makeCard());
    expect(tokenResult.ok).toBe(true);
    if (!tokenResult.ok) return;

    const result = await vault.revokeToken(tokenResult.value.token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeUndefined();
  });

  it("returns NOT_FOUND when revoking a non-existent token", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.revokeToken("tok_ghost");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("TokenVault — listByCustomer", () => {
  it("returns all tokens for the given customer", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    await vault.tokenize(makeCard({ customerId: "cust_1", pan: "4111111111111111" }));
    await vault.tokenize(makeCard({ customerId: "cust_1", pan: "4111111111119999" }));
    await vault.tokenize(makeCard({ customerId: "cust_2", pan: "4111111111118888" }));

    const result = await vault.listByCustomer("cust_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.every((t) => t.customerId === "cust_1")).toBe(true);
  });

  it("returns an empty array when the customer has no tokens", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    const result = await vault.listByCustomer("cust_nobody");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("does not include tokens belonging to other customers", async () => {
    const prisma = createMockPrisma();
    const vault = createTokenVault(prisma);

    await vault.tokenize(makeCard({ customerId: "cust_other" }));

    const result = await vault.listByCustomer("cust_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
