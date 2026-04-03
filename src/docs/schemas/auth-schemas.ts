import { jsonBody, jsonResponse, pathParam, problemResponse } from "./helpers.js";

function authEndpointPaths(): Record<string, Record<string, unknown>> {
  return {
    "/auth/register": {
      post: {
        tags: ["Authentication"],
        operationId: "register",
        summary: "Register a new merchant account",
        security: [],
        requestBody: jsonBody(
          {
            type: "object",
            required: ["email", "password", "name", "companyName", "slug", "country"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
              name: { type: "string" },
              companyName: { type: "string" },
              slug: { type: "string" },
              country: { type: "string" },
            },
          },
          {
            email: "merchant@example.com",
            password: "securePass123",
            name: "Jane Doe",
            companyName: "Acme Corp",
            slug: "acme",
            country: "US",
          },
        ),
        responses: {
          "201": jsonResponse("Registration successful", { $ref: "#/components/schemas/RegisterResponse" }),
          "400": problemResponse("Missing required fields"),
          "409": problemResponse("Email already taken"),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Authentication"],
        operationId: "login",
        summary: "Login with email and password",
        security: [],
        requestBody: jsonBody({
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        }),
        responses: {
          "200": jsonResponse("Login successful", {
            type: "object",
            properties: {
              token: { type: "string" },
              user: { $ref: "#/components/schemas/User" },
            },
          }),
          "401": problemResponse("Invalid credentials"),
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Authentication"],
        operationId: "getMe",
        summary: "Get current user and tenant",
        responses: {
          "200": jsonResponse("Current user", {
            type: "object",
            properties: {
              user: { $ref: "#/components/schemas/User" },
              tenant: { $ref: "#/components/schemas/Tenant" },
            },
          }),
          "401": problemResponse("Authentication required"),
        },
      },
    },
  };
}

function apiKeyPaths(): Record<string, Record<string, unknown>> {
  return {
    "/api-keys": {
      get: {
        tags: ["API Keys"],
        operationId: "listApiKeys",
        summary: "List API keys for tenant",
        responses: { "200": jsonResponse("API keys", { type: "object" }) },
      },
      post: {
        tags: ["API Keys"],
        operationId: "createApiKey",
        summary: "Generate a new API key",
        requestBody: jsonBody({
          type: "object",
          required: ["environment"],
          properties: {
            environment: { type: "string", enum: ["sandbox", "production"] },
            name: { type: "string" },
            permissions: { type: "array", items: { type: "string" } },
          },
        }),
        responses: {
          "201": jsonResponse("API key created", {
            type: "object",
            properties: {
              key: { type: "string" },
              id: { type: "string" },
              prefix: { type: "string" },
              environment: { type: "string" },
            },
          }),
        },
      },
    },
    "/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        operationId: "revokeApiKey",
        summary: "Revoke an API key",
        parameters: [pathParam("id", "API key ID")],
        responses: {
          "204": { description: "Key revoked" },
          "404": problemResponse("Key not found"),
        },
      },
    },
  };
}

function teamPaths(): Record<string, Record<string, unknown>> {
  return {
    "/team": {
      get: {
        tags: ["Team"],
        operationId: "listTeamMembers",
        summary: "List team members and pending invites",
        responses: { "200": jsonResponse("Team", { type: "object" }) },
      },
    },
    "/team/invite": {
      post: {
        tags: ["Team"],
        operationId: "inviteTeamMember",
        summary: "Invite a new team member",
        requestBody: jsonBody({
          type: "object",
          required: ["email", "role"],
          properties: {
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["admin", "developer", "viewer"] },
          },
        }),
        responses: { "201": jsonResponse("Invite sent", { type: "object" }) },
      },
    },
    "/team/invite/accept": {
      post: {
        tags: ["Team"],
        operationId: "acceptInvite",
        summary: "Accept a team invitation",
        security: [],
        requestBody: jsonBody({
          type: "object",
          required: ["token", "name", "password"],
          properties: {
            token: { type: "string" },
            name: { type: "string" },
            password: { type: "string" },
          },
        }),
        responses: {
          "200": jsonResponse("Invite accepted", { type: "object" }),
          "410": problemResponse("Invite expired"),
        },
      },
    },
    "/team/{memberId}/role": {
      patch: {
        tags: ["Team"],
        operationId: "changeTeamRole",
        summary: "Change a team member's role",
        parameters: [pathParam("memberId", "Member ID")],
        requestBody: jsonBody({
          type: "object",
          required: ["role"],
          properties: { role: { type: "string" } },
        }),
        responses: {
          "200": jsonResponse("Role updated", { type: "object" }),
          "404": problemResponse("Member not found"),
        },
      },
    },
  };
}

function onboardingPaths(): Record<string, Record<string, unknown>> {
  return {
    "/onboarding/kyb": {
      get: {
        tags: ["Onboarding"],
        operationId: "getKybStatus",
        summary: "Get KYB application status",
        responses: { "200": jsonResponse("KYB status", { type: "object" }) },
      },
      post: {
        tags: ["Onboarding"],
        operationId: "submitKyb",
        summary: "Submit KYB (Know Your Business) application",
        requestBody: jsonBody({
          type: "object",
          required: ["businessName", "businessType", "country"],
          properties: {
            businessName: { type: "string" },
            businessType: { type: "string" },
            country: { type: "string" },
            registrationNumber: { type: "string" },
            taxId: { type: "string" },
            website: { type: "string" },
          },
        }),
        responses: { "201": jsonResponse("KYB submitted", { type: "object" }) },
      },
    },
    "/onboarding/configure": {
      post: {
        tags: ["Onboarding"],
        operationId: "configureOnboarding",
        summary: "Configure merchant settings",
        requestBody: jsonBody({
          type: "object",
          properties: {
            fraudSensitivity: { type: "string" },
            settlementCurrency: { type: "string" },
            payoutSchedule: { type: "string" },
          },
        }),
        responses: {
          "200": jsonResponse("Configured", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
        },
      },
    },
    "/onboarding/go-live": {
      post: {
        tags: ["Onboarding"],
        operationId: "goLive",
        summary: "Activate merchant account for production",
        responses: {
          "200": jsonResponse("Live", { type: "object" }),
          "422": problemResponse("KYB not approved"),
        },
      },
    },
  };
}

export function buildAuthPaths(): Record<string, Record<string, unknown>> {
  return {
    ...authEndpointPaths(),
    ...apiKeyPaths(),
    ...teamPaths(),
    ...onboardingPaths(),
  };
}
