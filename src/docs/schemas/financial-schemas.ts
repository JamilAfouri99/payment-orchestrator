import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function ledgerPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/ledger/accounts": {
      get: {
        tags: ["Ledger"],
        operationId: "listLedgerAccounts",
        summary: "List all ledger accounts with balances",
        responses: {
          "200": jsonResponse("Ledger accounts", {
            type: "object",
            properties: {
              accounts: { type: "array", items: { $ref: "#/components/schemas/LedgerAccount" } },
            },
          }),
        },
      },
    },
    "/admin/ledger/accounts/{id}/balance": {
      get: {
        tags: ["Ledger"],
        operationId: "getLedgerBalance",
        summary: "Get balance for a ledger account",
        parameters: [pathParam("id", "Account ID"), queryParam("asOf", "Balance as of date (ISO 8601)")],
        responses: {
          "200": jsonResponse("Account balance", {
            type: "object",
            properties: { balance: { type: "integer" }, currency: { type: "string" } },
          }),
          "404": problemResponse("Account not found"),
        },
      },
    },
    "/admin/ledger/accounts/{id}/statement": {
      get: {
        tags: ["Ledger"],
        operationId: "getLedgerStatement",
        summary: "Get account statement",
        parameters: [pathParam("id", "Account ID"), queryParam("from", "Start date"), queryParam("to", "End date")],
        responses: {
          "200": jsonResponse("Account statement", {
            type: "object",
            properties: { entries: { type: "array" } },
          }),
        },
      },
    },
    "/admin/ledger/transactions": {
      get: {
        tags: ["Ledger"],
        operationId: "listLedgerTransactions",
        summary: "List ledger transactions",
        parameters: [queryParam("limit", "Max results", "integer", 50), queryParam("offset", "Offset", "integer", 0)],
        responses: {
          "200": jsonResponse("Transactions", {
            type: "object",
            properties: { transactions: { type: "array" }, total: { type: "integer" } },
          }),
        },
      },
    },
    "/admin/ledger/transactions/{id}": {
      get: {
        tags: ["Ledger"],
        operationId: "getLedgerTransaction",
        summary: "Get ledger transaction details",
        parameters: [pathParam("id", "Transaction ID")],
        responses: {
          "200": jsonResponse("Transaction details", { type: "object" }),
          "404": problemResponse("Transaction not found"),
        },
      },
    },
    "/admin/ledger/reconcile": {
      post: {
        tags: ["Ledger"],
        operationId: "reconcileLedger",
        summary: "Run ledger reconciliation",
        responses: { "200": jsonResponse("Reconciliation result", { type: "object" }) },
      },
    },
  };
}

function settlementPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/settlements": {
      get: {
        tags: ["Settlements"],
        operationId: "listSettlements",
        summary: "List settlements",
        parameters: [queryParam("limit", "Max results", "integer", 20), queryParam("offset", "Offset", "integer", 0)],
        responses: {
          "200": jsonResponse("Settlement list", {
            type: "object",
            properties: { settlements: { type: "array" }, total: { type: "integer" } },
          }),
        },
      },
      post: {
        tags: ["Settlements"],
        operationId: "createSettlement",
        summary: "Create a new settlement",
        requestBody: jsonBody({
          type: "object",
          required: ["merchantAccountId", "periodStart", "periodEnd"],
          properties: {
            merchantAccountId: { type: "string" },
            periodStart: { type: "string", format: "date-time" },
            periodEnd: { type: "string", format: "date-time" },
          },
        }),
        responses: { "201": jsonResponse("Settlement created", { type: "object" }) },
      },
    },
    "/admin/settlements/{id}": {
      get: {
        tags: ["Settlements"],
        operationId: "getSettlement",
        summary: "Get settlement details",
        parameters: [pathParam("id", "Settlement ID")],
        responses: {
          "200": jsonResponse("Settlement", { type: "object" }),
          "404": problemResponse("Settlement not found"),
        },
      },
    },
    "/admin/settlements/{id}/approve": {
      post: {
        tags: ["Settlements"],
        operationId: "approveSettlement",
        summary: "Approve a settlement",
        parameters: [pathParam("id", "Settlement ID")],
        responses: { "200": jsonResponse("Approved", { type: "object" }) },
      },
    },
    "/admin/settlements/{id}/process": {
      post: {
        tags: ["Settlements"],
        operationId: "processSettlement",
        summary: "Process an approved settlement",
        parameters: [pathParam("id", "Settlement ID")],
        responses: { "200": jsonResponse("Processed", { type: "object" }) },
      },
    },
    "/admin/settlements/{id}/report": {
      get: {
        tags: ["Settlements"],
        operationId: "getSettlementReport",
        summary: "Get settlement report",
        parameters: [pathParam("id", "Settlement ID")],
        responses: { "200": jsonResponse("Report", { type: "object" }) },
      },
    },
    "/admin/settlements/{id}/export": {
      get: {
        tags: ["Settlements"],
        operationId: "exportSettlement",
        summary: "Export settlement as CSV",
        parameters: [pathParam("id", "Settlement ID")],
        responses: { "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } } },
      },
    },
  };
}

function disputeCorePaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/disputes": {
      get: {
        tags: ["Disputes"],
        operationId: "listDisputes",
        summary: "List disputes",
        parameters: [
          queryParam("status", "Filter by status"),
          queryParam("paymentId", "Filter by payment"),
          queryParam("limit", "Max results", "integer", 20),
          queryParam("offset", "Offset", "integer", 0),
        ],
        responses: {
          "200": jsonResponse("Disputes", {
            type: "object",
            properties: { disputes: { type: "array" }, total: { type: "integer" } },
          }),
        },
      },
      post: {
        tags: ["Disputes"],
        operationId: "receiveDispute",
        summary: "Receive a dispute/chargeback",
        requestBody: jsonBody({
          type: "object",
          required: ["paymentId", "reason", "amount"],
          properties: {
            paymentId: { type: "string" },
            reason: { type: "string" },
            amount: { type: "integer" },
            type: { type: "string", enum: ["chargeback", "inquiry", "pre_arbitration"] },
          },
        }),
        responses: { "201": jsonResponse("Dispute created", { type: "object" }) },
      },
    },
    "/admin/disputes/chargeback-rate": {
      get: {
        tags: ["Disputes"],
        operationId: "getChargebackRate",
        summary: "Get chargeback rate",
        parameters: [queryParam("merchantAccountId", "Filter by merchant")],
        responses: { "200": jsonResponse("Chargeback rate", { type: "object" }) },
      },
    },
    "/admin/disputes/{id}": {
      get: {
        tags: ["Disputes"],
        operationId: "getDispute",
        summary: "Get dispute details",
        parameters: [pathParam("id", "Dispute ID")],
        responses: {
          "200": jsonResponse("Dispute", { type: "object" }),
          "404": problemResponse("Dispute not found"),
        },
      },
    },
  };
}

function disputeActionPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/disputes/{id}/evidence": {
      post: {
        tags: ["Disputes"],
        operationId: "submitDisputeEvidence",
        summary: "Submit evidence for a dispute",
        parameters: [pathParam("id", "Dispute ID")],
        requestBody: jsonBody({
          type: "object",
          properties: {
            description: { type: "string" },
            customerCommunication: { type: "string" },
            shippingProof: { type: "string" },
            refundPolicy: { type: "string" },
          },
        }),
        responses: { "200": jsonResponse("Evidence submitted", { type: "object" }) },
      },
    },
    "/admin/disputes/{id}/resolve": {
      post: {
        tags: ["Disputes"],
        operationId: "resolveDispute",
        summary: "Resolve a dispute",
        parameters: [pathParam("id", "Dispute ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["outcome"],
          properties: { outcome: { type: "string", enum: ["won", "lost"] } },
        }),
        responses: { "200": jsonResponse("Resolved", { type: "object" }) },
      },
    },
    "/admin/disputes/{id}/accept": {
      post: {
        tags: ["Disputes"],
        operationId: "acceptDispute",
        summary: "Accept a dispute (concede)",
        parameters: [pathParam("id", "Dispute ID")],
        responses: { "200": jsonResponse("Accepted", { type: "object" }) },
      },
    },
  };
}

function disputePaths(): Record<string, Record<string, unknown>> {
  return { ...disputeCorePaths(), ...disputeActionPaths() };
}

function splitPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/splits": {
      post: {
        tags: ["Split Payments"],
        operationId: "configureSplits",
        summary: "Configure payment splits",
        requestBody: jsonBody({
          type: "object",
          required: ["paymentId", "amount", "splits"],
          properties: {
            paymentId: { type: "string" },
            amount: { type: "integer" },
            splits: {
              type: "array",
              items: {
                type: "object",
                properties: { merchantAccountId: { type: "string" }, amount: { type: "integer" } },
              },
            },
          },
        }),
        responses: { "201": jsonResponse("Splits configured", { type: "object" }) },
      },
    },
    "/admin/splits/{paymentId}/execute": {
      post: {
        tags: ["Split Payments"],
        operationId: "executeSplits",
        summary: "Execute configured splits",
        parameters: [pathParam("paymentId", "Payment ID")],
        responses: { "200": jsonResponse("Splits executed", { type: "object" }) },
      },
    },
    "/admin/splits/{paymentId}": {
      get: {
        tags: ["Split Payments"],
        operationId: "getSplits",
        summary: "Get splits for a payment",
        parameters: [pathParam("paymentId", "Payment ID")],
        responses: { "200": jsonResponse("Payment splits", { type: "array", items: { type: "object" } }) },
      },
    },
  };
}

function payoutPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/payout-accounts": {
      get: {
        tags: ["Payouts"],
        operationId: "listPayoutAccounts",
        summary: "List payout accounts",
        parameters: [queryParam("merchantAccountId", "Filter by merchant")],
        responses: { "200": jsonResponse("Payout accounts", { type: "array", items: { type: "object" } }) },
      },
      post: {
        tags: ["Payouts"],
        operationId: "createPayoutAccount",
        summary: "Add a payout account",
        requestBody: jsonBody({
          type: "object",
          required: ["merchantAccountId", "type", "bankName", "accountNumber", "routingNumber", "country"],
          properties: {
            merchantAccountId: { type: "string" },
            type: { type: "string" },
            bankName: { type: "string" },
            accountNumber: { type: "string" },
            routingNumber: { type: "string" },
            country: { type: "string" },
          },
        }),
        responses: { "201": jsonResponse("Account created", { type: "object" }) },
      },
    },
    "/admin/payout-accounts/{id}": {
      delete: {
        tags: ["Payouts"],
        operationId: "deletePayoutAccount",
        summary: "Remove a payout account",
        parameters: [pathParam("id", "Account ID")],
        responses: { "200": jsonResponse("Deleted", { type: "object" }) },
      },
    },
    "/admin/payout-accounts/{id}/default": {
      post: {
        tags: ["Payouts"],
        operationId: "setDefaultPayoutAccount",
        summary: "Set default payout account",
        parameters: [pathParam("id", "Account ID")],
        responses: { "200": jsonResponse("Updated", { type: "object" }) },
      },
    },
    "/admin/payouts": {
      get: {
        tags: ["Payouts"],
        operationId: "listPayouts",
        summary: "List payouts",
        parameters: [
          queryParam("merchantAccountId", "Filter by merchant"),
          queryParam("status", "Filter by status"),
          queryParam("limit", "Max results", "integer", 20),
          queryParam("offset", "Offset", "integer", 0),
        ],
        responses: {
          "200": jsonResponse("Payouts", {
            type: "object",
            properties: { payouts: { type: "array" }, total: { type: "integer" } },
          }),
        },
      },
      post: {
        tags: ["Payouts"],
        operationId: "createPayout",
        summary: "Initiate a payout",
        requestBody: jsonBody({
          type: "object",
          required: ["merchantAccountId", "amount", "currency"],
          properties: {
            merchantAccountId: { type: "string" },
            amount: { type: "integer" },
            currency: { type: "string" },
          },
        }),
        responses: { "201": jsonResponse("Payout created", { type: "object" }) },
      },
    },
    "/admin/payouts/{id}": {
      get: {
        tags: ["Payouts"],
        operationId: "getPayout",
        summary: "Get payout details",
        parameters: [pathParam("id", "Payout ID")],
        responses: {
          "200": jsonResponse("Payout", { type: "object" }),
          "404": problemResponse("Payout not found"),
        },
      },
    },
  };
}

function threeDSecurePaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/3ds/check": {
      post: {
        tags: ["3D Secure"],
        operationId: "check3dsRequired",
        summary: "Check if 3DS is required",
        requestBody: jsonBody({
          type: "object",
          properties: {
            amount: { type: "integer" },
            currency: { type: "string" },
            region: { type: "string" },
            fraudScore: { type: "number" },
            trustedBeneficiary: { type: "boolean" },
          },
        }),
        responses: {
          "200": jsonResponse("3DS check result", {
            type: "object",
            properties: { required: { type: "boolean" }, reason: { type: "string" } },
          }),
        },
      },
    },
    "/admin/3ds/initiate": {
      post: {
        tags: ["3D Secure"],
        operationId: "initiate3ds",
        summary: "Initiate a 3DS authentication",
        requestBody: jsonBody({
          type: "object",
          required: ["paymentId"],
          properties: {
            paymentId: { type: "string" },
            version: { type: "string", enum: ["3ds1", "3ds2"] },
            amount: { type: "integer" },
            currency: { type: "string" },
            region: { type: "string" },
            fraudScore: { type: "number" },
          },
        }),
        responses: { "201": jsonResponse("3DS initiated", { type: "object" }) },
      },
    },
    "/admin/3ds/{id}/complete": {
      post: {
        tags: ["3D Secure"],
        operationId: "complete3ds",
        summary: "Complete a 3DS authentication",
        parameters: [pathParam("id", "3DS record ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["outcome"],
          properties: { outcome: { type: "string", enum: ["authenticated", "failed"] } },
        }),
        responses: { "200": jsonResponse("3DS completed", { type: "object" }) },
      },
    },
    "/admin/3ds/payment/{paymentId}": {
      get: {
        tags: ["3D Secure"],
        operationId: "get3dsForPayment",
        summary: "Get 3DS record for a payment",
        parameters: [pathParam("paymentId", "Payment ID")],
        responses: { "200": jsonResponse("3DS record", { type: "object" }) },
      },
    },
  };
}

function paymentMethodPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/payment-methods": {
      get: {
        tags: ["Payment Methods"],
        operationId: "listPaymentMethods",
        summary: "List stored payment methods",
        parameters: [queryParam("customerId", "Filter by customer")],
        responses: { "200": jsonResponse("Payment methods", { type: "array", items: { type: "object" } }) },
      },
      post: {
        tags: ["Payment Methods"],
        operationId: "createPaymentMethod",
        summary: "Store a new payment method",
        requestBody: jsonBody({
          type: "object",
          required: ["type", "customerId"],
          properties: {
            type: { type: "string", enum: ["card", "bank_transfer", "wallet", "bnpl", "crypto"] },
            customerId: { type: "string" },
            cardLast4: { type: "string" },
            cardBrand: { type: "string" },
            bankType: { type: "string" },
            walletProvider: { type: "string" },
            bnplProvider: { type: "string" },
            cryptoCurrency: { type: "string" },
          },
        }),
        responses: { "201": jsonResponse("Payment method created", { type: "object" }) },
      },
    },
    "/admin/payment-methods/supported": {
      get: {
        tags: ["Payment Methods"],
        operationId: "getSupportedPaymentMethods",
        summary: "Get supported payment methods by currency/country",
        parameters: [queryParam("currency", "Currency code"), queryParam("country", "Country code")],
        responses: { "200": jsonResponse("Supported methods", { type: "array", items: { type: "object" } }) },
      },
    },
    "/admin/payment-methods/{id}": {
      get: {
        tags: ["Payment Methods"],
        operationId: "getPaymentMethod",
        summary: "Get payment method details",
        parameters: [pathParam("id", "Payment method ID")],
        responses: {
          "200": jsonResponse("Payment method", { type: "object" }),
          "404": problemResponse("Not found"),
        },
      },
    },
    "/admin/payment-methods/{id}/default": {
      post: {
        tags: ["Payment Methods"],
        operationId: "setDefaultPaymentMethod",
        summary: "Set as default payment method",
        parameters: [pathParam("id", "Payment method ID")],
        responses: { "200": jsonResponse("Updated", { type: "object" }) },
      },
    },
    "/admin/payment-methods/{id}/revoke": {
      post: {
        tags: ["Payment Methods"],
        operationId: "revokePaymentMethod",
        summary: "Revoke a payment method",
        parameters: [pathParam("id", "Payment method ID")],
        responses: {
          "200": jsonResponse("Revoked", { type: "object" }),
          "404": problemResponse("Not found"),
        },
      },
    },
  };
}

export function buildFinancialPaths(): Record<string, Record<string, unknown>> {
  return {
    ...ledgerPaths(),
    ...settlementPaths(),
    ...disputePaths(),
    ...splitPaths(),
    ...payoutPaths(),
    ...threeDSecurePaths(),
    ...paymentMethodPaths(),
  };
}

export function buildFinancialSchemas(): Record<string, unknown> {
  return {
    LedgerAccount: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string" },
        currency: { type: "string" },
        balance: { type: "integer" },
      },
    },
  };
}
