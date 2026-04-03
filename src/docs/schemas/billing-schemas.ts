import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function subscriptionPlanPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/subscriptions/plans": {
      get: {
        tags: ["Subscriptions"],
        operationId: "listPlans",
        summary: "List subscription plans",
        responses: {
          "200": jsonResponse("Plans", { type: "object", properties: { plans: { type: "array" } } }),
        },
      },
      post: {
        tags: ["Subscriptions"],
        operationId: "createPlan",
        summary: "Create a subscription plan",
        requestBody: jsonBody({
          type: "object",
          required: ["name", "amount", "currency", "interval"],
          properties: {
            name: { type: "string" },
            amount: { type: "integer", description: "Amount in cents" },
            currency: { type: "string" },
            interval: { type: "string", enum: ["monthly", "yearly"] },
            trialDays: { type: "integer" },
          },
        }),
        responses: { "201": jsonResponse("Plan created", { type: "object" }) },
      },
    },
    "/admin/subscriptions/plans/{id}": {
      get: {
        tags: ["Subscriptions"],
        operationId: "getPlan",
        summary: "Get plan details",
        parameters: [pathParam("id", "Plan ID")],
        responses: {
          "200": jsonResponse("Plan", { type: "object" }),
          "404": problemResponse("Plan not found"),
        },
      },
      delete: {
        tags: ["Subscriptions"],
        operationId: "deletePlan",
        summary: "Delete a subscription plan",
        parameters: [pathParam("id", "Plan ID")],
        responses: {
          "200": jsonResponse("Deleted", { type: "object", properties: { success: { type: "boolean" } } }),
        },
      },
    },
  };
}

function subscriptionCrudPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/subscriptions": {
      get: {
        tags: ["Subscriptions"],
        operationId: "listSubscriptions",
        summary: "List subscriptions",
        parameters: [queryParam("status", "Filter by status")],
        responses: {
          "200": jsonResponse("Subscriptions", {
            type: "object",
            properties: { subscriptions: { type: "array" } },
          }),
        },
      },
      post: {
        tags: ["Subscriptions"],
        operationId: "createSubscription",
        summary: "Create a subscription",
        requestBody: jsonBody({
          type: "object",
          required: ["customerId", "planId"],
          properties: {
            customerId: { type: "string" },
            planId: { type: "string" },
            trialDays: { type: "integer" },
          },
        }),
        responses: { "201": jsonResponse("Subscription created", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}": {
      get: {
        tags: ["Subscriptions"],
        operationId: "getSubscription",
        summary: "Get subscription details",
        parameters: [pathParam("id", "Subscription ID")],
        responses: { "200": jsonResponse("Subscription", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/cancel": {
      post: {
        tags: ["Subscriptions"],
        operationId: "cancelSubscription",
        summary: "Cancel a subscription",
        parameters: [pathParam("id", "Subscription ID")],
        requestBody: jsonBody({
          type: "object",
          properties: { reason: { type: "string" }, immediate: { type: "boolean" } },
        }),
        responses: { "200": jsonResponse("Canceled", { type: "object" }) },
      },
    },
  };
}

function subscriptionLifecyclePaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/subscriptions/{id}/upgrade": {
      post: {
        tags: ["Subscriptions"],
        operationId: "upgradeSubscription",
        summary: "Upgrade to a higher plan",
        parameters: [pathParam("id", "Subscription ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["newPlanId"],
          properties: { newPlanId: { type: "string" } },
        }),
        responses: { "200": jsonResponse("Upgraded", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/downgrade": {
      post: {
        tags: ["Subscriptions"],
        operationId: "downgradeSubscription",
        summary: "Downgrade to a lower plan",
        parameters: [pathParam("id", "Subscription ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["newPlanId"],
          properties: { newPlanId: { type: "string" } },
        }),
        responses: { "200": jsonResponse("Downgraded", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/pause": {
      post: {
        tags: ["Subscriptions"],
        operationId: "pauseSubscription",
        summary: "Pause a subscription",
        parameters: [pathParam("id", "Subscription ID")],
        responses: { "200": jsonResponse("Paused", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/resume": {
      post: {
        tags: ["Subscriptions"],
        operationId: "resumeSubscription",
        summary: "Resume a paused subscription",
        parameters: [pathParam("id", "Subscription ID")],
        responses: { "200": jsonResponse("Resumed", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/upcoming-invoice": {
      get: {
        tags: ["Subscriptions"],
        operationId: "getUpcomingInvoice",
        summary: "Preview the next invoice for a subscription",
        parameters: [pathParam("id", "Subscription ID")],
        responses: { "200": jsonResponse("Upcoming invoice", { type: "object" }) },
      },
    },
    "/admin/subscriptions/{id}/events": {
      get: {
        tags: ["Subscriptions"],
        operationId: "getSubscriptionEvents",
        summary: "Get subscription event history",
        parameters: [pathParam("id", "Subscription ID")],
        responses: { "200": jsonResponse("Events", { type: "array", items: { type: "object" } }) },
      },
    },
  };
}

function subscriptionPaths(): Record<string, Record<string, unknown>> {
  return { ...subscriptionCrudPaths(), ...subscriptionLifecyclePaths() };
}

function invoicePaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/invoices": {
      get: {
        tags: ["Invoices"],
        operationId: "listInvoices",
        summary: "List invoices",
        parameters: [
          queryParam("status", "Filter by status"),
          queryParam("subscriptionId", "Filter by subscription"),
        ],
        responses: {
          "200": jsonResponse("Invoices", { type: "object", properties: { invoices: { type: "array" } } }),
        },
      },
    },
    "/admin/invoices/{id}": {
      get: {
        tags: ["Invoices"],
        operationId: "getInvoice",
        summary: "Get invoice details",
        parameters: [pathParam("id", "Invoice ID")],
        responses: {
          "200": jsonResponse("Invoice", { type: "object" }),
          "404": problemResponse("Invoice not found"),
        },
      },
    },
    "/admin/invoices/{id}/pay": {
      post: {
        tags: ["Invoices"],
        operationId: "payInvoice",
        summary: "Pay an invoice",
        parameters: [pathParam("id", "Invoice ID")],
        responses: { "200": jsonResponse("Paid invoice", { type: "object" }) },
      },
    },
    "/admin/invoices/{id}/void": {
      post: {
        tags: ["Invoices"],
        operationId: "voidInvoice",
        summary: "Void an invoice",
        parameters: [pathParam("id", "Invoice ID")],
        responses: { "200": jsonResponse("Voided invoice", { type: "object" }) },
      },
    },
  };
}

function dunningPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/billing/process": {
      post: {
        tags: ["Billing"],
        operationId: "processDueSubscriptions",
        summary: "Process all due subscription billings",
        responses: {
          "200": jsonResponse("Processing result", {
            type: "object",
            properties: { processed: { type: "integer" } },
          }),
        },
      },
    },
    "/admin/dunning/config": {
      get: {
        tags: ["Dunning"],
        operationId: "getDunningConfig",
        summary: "Get dunning configuration",
        responses: { "200": jsonResponse("Dunning config", { type: "object" }) },
      },
      put: {
        tags: ["Dunning"],
        operationId: "updateDunningConfig",
        summary: "Update dunning configuration",
        requestBody: jsonBody({
          type: "object",
          properties: {
            maxRetries: { type: "integer" },
            retryIntervalDays: { type: "array", items: { type: "integer" } },
            cancelAfterMaxRetries: { type: "boolean" },
          },
        }),
        responses: { "200": jsonResponse("Updated config", { type: "object" }) },
      },
    },
    "/admin/dunning/active": {
      get: {
        tags: ["Dunning"],
        operationId: "getActiveDunning",
        summary: "List active dunning flows",
        responses: {
          "200": jsonResponse("Active flows", {
            type: "object",
            properties: { flows: { type: "array" } },
          }),
        },
      },
    },
    "/admin/dunning/process": {
      post: {
        tags: ["Dunning"],
        operationId: "processDunning",
        summary: "Process pending dunning retries",
        responses: {
          "200": jsonResponse("Processing result", {
            type: "object",
            properties: { processed: { type: "integer" } },
          }),
        },
      },
    },
    "/admin/dunning/analytics": {
      get: {
        tags: ["Dunning"],
        operationId: "getDunningAnalytics",
        summary: "Get dunning analytics",
        responses: { "200": jsonResponse("Analytics", { type: "object" }) },
      },
    },
  };
}

function checkoutPaths(): Record<string, Record<string, unknown>> {
  return {
    "/checkout/sessions": {
      get: {
        tags: ["Checkout"],
        operationId: "listCheckoutSessions",
        summary: "List checkout sessions",
        parameters: [queryParam("status", "Filter by status"), queryParam("limit", "Max results", "integer", 20)],
        responses: { "200": jsonResponse("Sessions", { type: "array", items: { type: "object" } }) },
      },
      post: {
        tags: ["Checkout"],
        operationId: "createCheckoutSession",
        summary: "Create a checkout session",
        requestBody: jsonBody({
          type: "object",
          required: ["amount", "currency"],
          properties: {
            amount: { type: "integer" },
            currency: { type: "string" },
            description: { type: "string" },
            successUrl: { type: "string" },
            cancelUrl: { type: "string" },
            customer: { type: "object", properties: { email: { type: "string" }, name: { type: "string" } } },
            lineItems: { type: "array", items: { type: "object" } },
            allowedPaymentMethods: { type: "array", items: { type: "string" } },
            expiresInMinutes: { type: "integer", default: 30 },
          },
        }),
        responses: { "201": jsonResponse("Session created", { type: "object" }) },
      },
    },
    "/checkout/sessions/{id}": {
      get: {
        tags: ["Checkout"],
        operationId: "getCheckoutSession",
        summary: "Get checkout session details",
        parameters: [pathParam("id", "Session ID")],
        responses: {
          "200": jsonResponse("Session", { type: "object" }),
          "404": problemResponse("Not found"),
        },
      },
    },
    "/checkout/sessions/{id}/complete": {
      post: {
        tags: ["Checkout"],
        operationId: "completeCheckoutSession",
        summary: "Complete a checkout session",
        parameters: [pathParam("id", "Session ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["paymentId"],
          properties: { paymentId: { type: "string" }, paymentMethodType: { type: "string" } },
        }),
        responses: { "200": jsonResponse("Completed", { type: "object" }) },
      },
    },
    "/checkout/sessions/{id}/expire": {
      post: {
        tags: ["Checkout"],
        operationId: "expireCheckoutSession",
        summary: "Expire a checkout session",
        parameters: [pathParam("id", "Session ID")],
        responses: { "200": jsonResponse("Expired", { type: "object" }) },
      },
    },
    "/checkout/analytics": {
      get: {
        tags: ["Checkout"],
        operationId: "getCheckoutAnalytics",
        summary: "Get checkout conversion analytics",
        responses: { "200": jsonResponse("Analytics", { type: "object" }) },
      },
    },
  };
}

export function buildBillingPaths(): Record<string, Record<string, unknown>> {
  return {
    ...subscriptionPlanPaths(),
    ...subscriptionPaths(),
    ...invoicePaths(),
    ...dunningPaths(),
    ...checkoutPaths(),
  };
}
