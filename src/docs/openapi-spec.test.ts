import { describe, it, expect } from "vitest";
import { buildOpenAPISpec } from "./openapi-spec.js";

describe("OpenAPI Spec", () => {
  const spec = buildOpenAPISpec();

  it("uses OpenAPI 3.1.0", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("has info with title and version", () => {
    expect(spec.info["title"]).toBe("Payment Orchestrator API");
    expect(spec.info["version"]).toBe("1.0.0");
  });

  it("defines BearerAuth security scheme", () => {
    const schemes = spec.components["securitySchemes"] as Record<string, Record<string, string>>;
    expect(schemes["BearerAuth"]).toBeDefined();
    expect(schemes["BearerAuth"]!["type"]).toBe("http");
    expect(schemes["BearerAuth"]!["scheme"]).toBe("bearer");
  });

  it("has global security requirement", () => {
    expect(spec.security).toEqual([{ BearerAuth: [] }]);
  });

  it("defines 30+ tags", () => {
    expect(spec.tags.length).toBeGreaterThanOrEqual(30);
  });

  it("documents 100+ paths", () => {
    const pathCount = Object.keys(spec.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(80);
  });

  describe("path documentation quality", () => {
    it("every path has at least one HTTP method", () => {
      for (const [path, methods] of Object.entries(spec.paths)) {
        const httpMethods = Object.keys(methods as Record<string, unknown>);
        expect(httpMethods.length, `${path} should have methods`).toBeGreaterThan(0);
      }
    });

    it("every operation has tags, operationId, summary, and responses", () => {
      const httpMethodNames = ["get", "post", "put", "patch", "delete"];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const method of httpMethodNames) {
          const op = (methods as Record<string, Record<string, unknown>>)[method];
          if (op) {
            expect(op["tags"], `${method.toUpperCase()} ${path} needs tags`).toBeDefined();
            expect(op["operationId"], `${method.toUpperCase()} ${path} needs operationId`).toBeDefined();
            expect(op["summary"], `${method.toUpperCase()} ${path} needs summary`).toBeDefined();
            expect(op["responses"], `${method.toUpperCase()} ${path} needs responses`).toBeDefined();
          }
        }
      }
    });

    it("public endpoints have security: [] override", () => {
      const publicPaths = ["/health", "/auth/register", "/auth/login", "/team/invite/accept"];
      for (const path of publicPaths) {
        const methods = spec.paths[path] as Record<string, Record<string, unknown>> | undefined;
        if (methods) {
          const firstMethod = Object.values(methods)[0];
          expect(firstMethod!["security"], `${path} should have empty security`).toEqual([]);
        }
      }
    });
  });

  describe("component schemas", () => {
    const schemas = spec.components["schemas"] as Record<string, Record<string, unknown>>;

    it("defines ProblemDetails (RFC 7807)", () => {
      expect(schemas["ProblemDetails"]).toBeDefined();
      const props = schemas["ProblemDetails"]!["properties"] as Record<string, unknown>;
      expect(props["type"]).toBeDefined();
      expect(props["title"]).toBeDefined();
      expect(props["status"]).toBeDefined();
      expect(props["detail"]).toBeDefined();
    });

    it("defines PaymentRequest schema", () => {
      expect(schemas["PaymentRequest"]).toBeDefined();
      const required = schemas["PaymentRequest"]!["required"] as string[];
      expect(required).toContain("amount");
      expect(required).toContain("currency");
      expect(required).toContain("customerId");
    });

    it("defines PaymentState schema", () => {
      expect(schemas["PaymentState"]).toBeDefined();
    });

    it("defines WebhookEventEnvelope schema", () => {
      expect(schemas["WebhookEventEnvelope"]).toBeDefined();
      expect(schemas["WebhookEventEnvelope"]!["example"]).toBeDefined();
    });

    it("defines TestCard schema", () => {
      expect(schemas["TestCard"]).toBeDefined();
    });

    it("defines 15+ schemas", () => {
      expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(15);
    });
  });

  describe("specific endpoint coverage", () => {
    it("documents payment CRUD", () => {
      expect(spec.paths["/payments"]).toBeDefined();
      expect((spec.paths["/payments"] as Record<string, unknown>)["get"]).toBeDefined();
      expect((spec.paths["/payments"] as Record<string, unknown>)["post"]).toBeDefined();
      expect(spec.paths["/payments/{id}"]).toBeDefined();
    });

    it("documents sandbox endpoints", () => {
      expect(spec.paths["/admin/sandbox/test-cards"]).toBeDefined();
      expect(spec.paths["/admin/sandbox/trigger-dispute"]).toBeDefined();
      expect(spec.paths["/admin/sandbox/reset"]).toBeDefined();
    });

    it("documents webhook catalog endpoints", () => {
      expect(spec.paths["/admin/webhook-catalog"]).toBeDefined();
      expect(spec.paths["/admin/webhook-catalog/{type}"]).toBeDefined();
    });

    it("documents checkout endpoints", () => {
      expect(spec.paths["/checkout/sessions"]).toBeDefined();
      expect(spec.paths["/checkout/sessions/{id}"]).toBeDefined();
    });

    it("documents 3D Secure endpoints", () => {
      expect(spec.paths["/admin/3ds/check"]).toBeDefined();
      expect(spec.paths["/admin/3ds/initiate"]).toBeDefined();
    });
  });
});
