import { jsonBody, jsonResponse, pathParam, problemResponse } from "./helpers.js";

export function buildFraudPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/fraud/rules": {
      get: {
        tags: ["Fraud"],
        operationId: "listFraudRules",
        summary: "List all fraud rules",
        responses: {
          "200": jsonResponse("Fraud rules", {
            type: "object",
            properties: {
              rules: { type: "array", items: { $ref: "#/components/schemas/FraudRule" } },
            },
          }),
        },
      },
      post: {
        tags: ["Fraud"],
        operationId: "createFraudRule",
        summary: "Create a new fraud rule",
        requestBody: jsonBody({ $ref: "#/components/schemas/FraudRuleInput" }),
        responses: {
          "201": jsonResponse("Created rule", { $ref: "#/components/schemas/FraudRule" }),
        },
      },
    },
    "/admin/fraud/rules/{id}": {
      put: {
        tags: ["Fraud"],
        operationId: "updateFraudRule",
        summary: "Update a fraud rule",
        parameters: [pathParam("id", "Rule ID")],
        requestBody: jsonBody({ $ref: "#/components/schemas/FraudRuleInput" }),
        responses: {
          "200": jsonResponse("Updated rule", { $ref: "#/components/schemas/FraudRule" }),
        },
      },
      delete: {
        tags: ["Fraud"],
        operationId: "deleteFraudRule",
        summary: "Delete a fraud rule",
        parameters: [pathParam("id", "Rule ID")],
        responses: {
          "200": jsonResponse("Deleted", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
          "404": problemResponse("Rule not found"),
        },
      },
    },
    "/payments/{id}/fraud": {
      get: {
        tags: ["Fraud"],
        operationId: "getPaymentFraud",
        summary: "Get fraud evaluation for a payment",
        parameters: [pathParam("id", "Payment ID")],
        responses: {
          "200": jsonResponse("Fraud evaluation", { $ref: "#/components/schemas/FraudEvaluation" }),
          "404": problemResponse("No evaluation found"),
        },
      },
    },
    "/admin/fraud/simulate": {
      post: {
        tags: ["Fraud"],
        operationId: "simulateFraud",
        summary: "Simulate fraud scoring",
        requestBody: jsonBody({
          type: "object",
          properties: {
            amount: { type: "integer" },
            currency: { type: "string" },
            customerId: { type: "string" },
            region: { type: "string" },
            customerPaymentCount: { type: "integer" },
            customerAvgAmount: { type: "integer" },
          },
        }),
        responses: {
          "200": jsonResponse("Simulation result", { $ref: "#/components/schemas/FraudEvaluation" }),
        },
      },
    },
  };
}

export function buildFraudSchemas(): Record<string, unknown> {
  return {
    FraudRule: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        ruleType: { type: "string" },
        config: { type: "object" },
        weight: { type: "integer" },
        enabled: { type: "boolean" },
      },
    },
    FraudRuleInput: {
      type: "object",
      required: ["name", "ruleType"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        ruleType: { type: "string" },
        config: { type: "object" },
        weight: { type: "integer" },
        enabled: { type: "boolean" },
      },
    },
    FraudEvaluation: {
      type: "object",
      properties: {
        paymentId: { type: "string" },
        score: { type: "number" },
        action: { type: "string", enum: ["allow", "review", "block"] },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
  };
}
