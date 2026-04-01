import type { PaymentService } from "../api/payment-service.js";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { getAllDeclineCodes } from "../retry/decline-codes.js";
import type { createPubSub } from "./subscriptions.js";

export interface ResolverDeps {
  paymentService: PaymentService;
  chaos: ChaosController;
  metrics: MetricsCollector;
  pubsub: ReturnType<typeof createPubSub>;
}

export function createResolvers(deps: ResolverDeps) {
  const { paymentService, chaos, metrics, pubsub } = deps;

  return {
    Query: {
      async payment(_: unknown, args: { id: string }) {
        const result = await paymentService.getPayment(args.id);
        if (!result.ok) return null;
        return result.value;
      },

      async payments(_: unknown, args: { first?: number; after?: string; status?: string }) {
        const limit = args.first ?? 20;
        const offset = args.after ? parseInt(args.after, 10) : 0;

        const result = await paymentService.listPayments(limit, offset);
        if (!result.ok) return { edges: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: 0 };

        const edges = result.value.payments.map((p, i) => ({
          node: p,
          cursor: String(offset + i),
        }));

        return {
          edges,
          pageInfo: {
            hasNextPage: offset + limit < result.value.total,
            endCursor: edges.length > 0 ? edges[edges.length - 1]!.cursor : null,
          },
          totalCount: result.value.total,
        };
      },

      async paymentEvents(_: unknown, args: { paymentId: string }) {
        const result = await paymentService.getPaymentEvents(args.paymentId);
        if (!result.ok) return [];
        return result.value.map((e) => ({
          ...e,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
        }));
      },

      providers() {
        const registry = paymentService.getProviderRegistry();
        const cbRegistry = paymentService.getCircuitBreakerRegistry();
        const breakers = cbRegistry.getAll();

        return registry.getAllConfigs().map((c) => ({
          ...c,
          circuitBreakerState: breakers.find((b) => b.name === c.name)?.state ?? "unknown",
        }));
      },

      async fraudRules() {
        const result = await paymentService.getFraudEngine().getRules();
        return result.ok ? result.value : [];
      },

      fxRates() {
        return paymentService.getFxService().getAllRates();
      },

      declineCodes() {
        return getAllDeclineCodes();
      },

      metrics() {
        return metrics.snapshot();
      },
    },

    Mutation: {
      async createPayment(_: unknown, args: { input: { amount: number; currency: string; customerId: string; orderId: string; region?: string; token?: string; items: { productId: string; quantity: number; pricePerUnit: number }[] } }) {
        const result = await paymentService.initiatePayment({
          amount: args.input.amount,
          currency: args.input.currency,
          customerId: args.input.customerId,
          orderId: args.input.orderId,
          items: args.input.items,
          region: args.input.region,
          token: args.input.token,
        });

        if (!result.ok) throw new Error(result.error.message);

        pubsub.publish({
          paymentId: result.value.id,
          status: result.value.status,
          timestamp: new Date().toISOString(),
        });

        return result.value;
      },

      async registerWebhook(_: unknown, args: { url: string; events?: string[] }) {
        const service = paymentService.getWebhookService();
        const result = await service.register(args.url, args.events);
        if (!result.ok) throw new Error(result.error.message);
        return { id: result.value, url: args.url, events: args.events ?? ["*"] };
      },

      async upsertFraudRule(_: unknown, args: { input: { id?: string; name: string; description: string; ruleType: string; config?: unknown; weight: number; enabled: boolean } }) {
        const engine = paymentService.getFraudEngine();
        const result = await engine.upsertRule({
          id: args.input.id,
          name: args.input.name,
          description: args.input.description,
          ruleType: args.input.ruleType,
          config: (args.input.config as Record<string, unknown>) ?? {},
          weight: args.input.weight,
          enabled: args.input.enabled,
        });
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      },

      async deleteFraudRule(_: unknown, args: { id: string }) {
        const engine = paymentService.getFraudEngine();
        const result = await engine.deleteRule(args.id);
        return result.ok;
      },

      updateChaos(_: unknown, args: { service: string; failureRate?: number; latencyMs?: number; enabled?: boolean }) {
        chaos.setConfig(args.service, {
          ...(args.failureRate !== undefined ? { failureRate: args.failureRate } : {}),
          ...(args.latencyMs !== undefined ? { latencyMs: args.latencyMs } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        });
        return { services: chaos.getAll() };
      },

      async revokeToken(_: unknown, args: { token: string }) {
        const vault = paymentService.getTokenVault();
        const result = await vault.revokeToken(args.token);
        return result.ok;
      },

      updateFxRate(_: unknown, args: { from: string; to: string; rate: number; spreadBps: number }) {
        const fxService = paymentService.getFxService();
        fxService.setRate(args.from, args.to, args.rate, args.spreadBps);
        const rateResult = fxService.getRate(args.from, args.to);
        if (!rateResult.ok) throw new Error(rateResult.error.message);
        return rateResult.value;
      },
    },

    Subscription: {
      paymentStatusChanged: {
        subscribe: (_: unknown, args: { paymentId?: string }) => {
          return pubsub.subscribe(args.paymentId);
        },
      },
    },

    Payment: {
      async events(parent: { id: string }) {
        const result = await paymentService.getPaymentEvents(parent.id);
        if (!result.ok) return [];
        return result.value.map((e) => ({
          ...e,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
        }));
      },
    },
  };
}
