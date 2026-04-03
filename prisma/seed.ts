import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;
const DEMO_EMAIL = "demo@acme.com";
const DEMO_PASSWORD = "demo1234";
const DEMO_TENANT_NAME = "Acme Corp";
const DEMO_SLUG = "acme-corp";

function toBase62(buf: Buffer): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let n = BigInt("0x" + buf.toString("hex"));
  let result = "";
  const base = BigInt(62);
  while (n > 0n) {
    result = chars[Number(n % base)] + result;
    n /= base;
  }
  return result || "0";
}

async function main() {
  console.log("🌱 Seeding database...\n");

  // Check if demo user already exists
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log("  Demo user already exists — skipping.\n");
    return;
  }

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenantId = uuid();
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      name: DEMO_TENANT_NAME,
      slug: DEMO_SLUG,
      status: "active",
      plan: "growth",
      defaultCurrency: "USD",
      timezone: "America/New_York",
      webhookSecret: randomBytes(32).toString("hex"),
    },
  });
  console.log(`  ✓ Tenant created: ${tenant.name} (${tenant.id})`);

  // ── Merchant accounts ─────────────────────────────────────────────────────
  const sandboxMerchantId = uuid();
  await prisma.merchantAccount.create({
    data: {
      id: sandboxMerchantId,
      tenantId,
      name: "Sandbox",
      environment: "sandbox",
      status: "active",
      settlementCurrency: "USD",
      payoutSchedule: "weekly",
    },
  });

  const prodMerchantId = uuid();
  await prisma.merchantAccount.create({
    data: {
      id: prodMerchantId,
      tenantId,
      name: "Production",
      environment: "production",
      status: "active",
      settlementCurrency: "USD",
      payoutSchedule: "daily",
    },
  });
  console.log("  ✓ Merchant accounts created (sandbox + production)");

  // ── User ───────────────────────────────────────────────────────────────────
  const userId = uuid();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: DEMO_EMAIL,
      passwordHash,
      name: "Demo User",
      role: "owner",
      status: "active",
      emailVerified: true,
    },
  });
  console.log(`  ✓ User created: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  // ── Team member ────────────────────────────────────────────────────────────
  await prisma.teamMember.create({
    data: { id: uuid(), tenantId, userId, role: "owner", status: "active" },
  });

  // ── API keys ───────────────────────────────────────────────────────────────
  const sandboxKey = "pk_test_" + toBase62(randomBytes(32));
  const sandboxKeyHash = await bcrypt.hash(sandboxKey, SALT_ROUNDS);
  await prisma.apiKey.create({
    data: {
      id: uuid(),
      tenantId,
      merchantAccountId: sandboxMerchantId,
      keyPrefix: sandboxKey.slice(0, 12),
      keyHash: sandboxKeyHash,
      environment: "sandbox",
      permissions: ["payments:read", "payments:write", "webhooks:read", "webhooks:write"],
      name: "Default Sandbox Key",
      createdBy: userId,
    },
  });

  const prodKey = "pk_live_" + toBase62(randomBytes(32));
  const prodKeyHash = await bcrypt.hash(prodKey, SALT_ROUNDS);
  await prisma.apiKey.create({
    data: {
      id: uuid(),
      tenantId,
      merchantAccountId: prodMerchantId,
      keyPrefix: prodKey.slice(0, 12),
      keyHash: prodKeyHash,
      environment: "production",
      permissions: ["payments:read", "payments:write", "webhooks:read", "webhooks:write"],
      name: "Default Production Key",
      createdBy: userId,
    },
  });
  console.log("  ✓ API keys created");

  // ── KYB application (approved) ─────────────────────────────────────────────
  await prisma.kybApplication.create({
    data: {
      id: uuid(),
      tenantId,
      businessName: "Acme Corp Ltd",
      businessType: "corporation",
      country: "US",
      status: "approved",
      reviewedAt: new Date(),
    },
  });
  console.log("  ✓ KYB application (approved)");

  // ── Fraud rules ────────────────────────────────────────────────────────────
  const fraudRules = [
    { name: "Velocity Check", description: "Flag if customer exceeds payment count in time window", ruleType: "velocity", config: { maxPayments: 5, windowMinutes: 10 }, weight: 30 },
    { name: "Amount Anomaly", description: "Flag if amount exceeds 3x customer average", ruleType: "amount_anomaly", config: { multiplier: 3 }, weight: 25 },
    { name: "High Value Transaction", description: "Flag transactions over $1000", ruleType: "high_value", config: { thresholdCents: 100_000 }, weight: 15 },
    { name: "Geographic Mismatch", description: "Flag if payment region differs from customer usual region", ruleType: "geo_mismatch", config: {}, weight: 20 },
    { name: "New Customer", description: "Flag first-time customers", ruleType: "new_customer", config: {}, weight: 10 },
  ];
  for (const rule of fraudRules) {
    await prisma.fraudRule.create({
      data: { id: uuid(), tenantId, ...rule, enabled: true },
    });
  }
  console.log(`  ✓ Fraud rules seeded (${fraudRules.length})`);

  // ── Dunning config ─────────────────────────────────────────────────────────
  await prisma.dunningConfig.create({
    data: {
      id: uuid(),
      tenantId,
      maxRetryAttempts: 4,
      retryScheduleDays: [1, 3, 7, 14],
      gracePeriodDays: 3,
      onFinalFailure: "cancel_subscription",
    },
  });
  console.log("  ✓ Dunning config created");

  // ── Subscription plans ─────────────────────────────────────────────────────
  const plans = [
    { name: "Starter", amount: 999, billingInterval: "monthly", trialDays: 14 },
    { name: "Pro", amount: 4999, billingInterval: "monthly", trialDays: 14 },
    { name: "Team", amount: 14999, billingInterval: "monthly", trialDays: 7 },
    { name: "Enterprise", amount: 49999, billingInterval: "monthly", trialDays: 30 },
  ];
  const planIds: string[] = [];
  for (const plan of plans) {
    const id = uuid();
    planIds.push(id);
    await prisma.plan.create({
      data: {
        id,
        tenantId,
        name: plan.name,
        amount: plan.amount,
        currency: "USD",
        billingInterval: plan.billingInterval,
        trialDays: plan.trialDays,
        status: "active",
      },
    });
  }
  console.log(`  ✓ Subscription plans created (${plans.length})`);

  // ── Ledger accounts ────────────────────────────────────────────────────────
  const ledgerAccounts = [
    { name: "Platform Revenue", type: "revenue", currency: "USD" },
    { name: "Merchant Payable - Acme", type: "liability", currency: "USD" },
    { name: "Processing Fees", type: "expense", currency: "USD" },
    { name: "Stripe Settlement", type: "asset", currency: "USD" },
    { name: "Adyen Settlement", type: "asset", currency: "EUR" },
  ];
  for (const acct of ledgerAccounts) {
    await prisma.ledgerAccount.create({
      data: { id: uuid(), tenantId, ...acct },
    });
  }
  console.log(`  ✓ Ledger accounts created (${ledgerAccounts.length})`);

  // ── Payout account ─────────────────────────────────────────────────────────
  await prisma.payoutAccount.create({
    data: {
      id: uuid(),
      tenantId,
      merchantAccountId: prodMerchantId,
      bankName: "Chase",
      accountNumberMasked: "••••4567",
      routingNumber: "••••0021",
      currency: "USD",
      country: "US",
      status: "verified",
    },
  });
  console.log("  ✓ Payout account created");

  // ── Print summary ──────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────");
  console.log("  Demo credentials:");
  console.log(`    Email:    ${DEMO_EMAIL}`);
  console.log(`    Password: ${DEMO_PASSWORD}`);
  console.log(`    Sandbox:  ${sandboxKey}`);
  console.log(`    Live:     ${prodKey}`);
  console.log("──────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
