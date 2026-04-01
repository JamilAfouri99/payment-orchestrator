import { describe, it, expect } from "vitest";
import { createWebhookCatalog, API_VERSION } from "./webhook-catalog.js";

describe("WebhookCatalog", () => {
  const catalog = createWebhookCatalog();

  describe("getEvents", () => {
    it("returns all 23 event definitions", () => {
      const events = catalog.getEvents();
      expect(events.length).toBe(23);
    });

    it("includes events from all categories", () => {
      const events = catalog.getEvents();
      const categories = new Set(events.map((e) => e.category));
      expect(categories).toEqual(new Set(["payment", "subscription", "dispute", "payout", "merchant"]));
    });

    it("every event has type, category, description, fields, and example", () => {
      for (const event of catalog.getEvents()) {
        expect(event.type).toBeTruthy();
        expect(event.category).toBeTruthy();
        expect(event.description).toBeTruthy();
        expect(event.payloadFields.length).toBeGreaterThan(0);
        expect(event.example).toBeTruthy();
      }
    });
  });

  describe("getEvent", () => {
    it("returns a specific event by type", () => {
      const event = catalog.getEvent("payment.created");
      expect(event).not.toBeNull();
      expect(event!.type).toBe("payment.created");
      expect(event!.category).toBe("payment");
    });

    it("returns null for unknown event type", () => {
      expect(catalog.getEvent("unknown.event")).toBeNull();
    });
  });

  describe("getEventsByCategory", () => {
    it("returns 6 payment events", () => {
      const events = catalog.getEventsByCategory("payment");
      expect(events.length).toBe(6);
      expect(events.every((e) => e.category === "payment")).toBe(true);
    });

    it("returns 7 subscription events", () => {
      const events = catalog.getEventsByCategory("subscription");
      expect(events.length).toBe(7);
    });

    it("returns 4 dispute events", () => {
      const events = catalog.getEventsByCategory("dispute");
      expect(events.length).toBe(4);
    });

    it("returns 4 payout events", () => {
      const events = catalog.getEventsByCategory("payout");
      expect(events.length).toBe(4);
    });

    it("returns 2 merchant events", () => {
      const events = catalog.getEventsByCategory("merchant");
      expect(events.length).toBe(2);
    });

    it("returns empty for unknown category", () => {
      expect(catalog.getEventsByCategory("nonexistent")).toEqual([]);
    });
  });

  describe("getCategories", () => {
    it("returns all 5 categories", () => {
      const categories = catalog.getCategories();
      expect(categories.length).toBe(5);
      expect(categories).toContain("payment");
      expect(categories).toContain("subscription");
      expect(categories).toContain("dispute");
      expect(categories).toContain("payout");
      expect(categories).toContain("merchant");
    });
  });

  describe("buildEnvelope", () => {
    it("builds a valid webhook event envelope", () => {
      const envelope = catalog.buildEnvelope("payment.captured", {
        id: "pay_123",
        status: "completed",
        amount: 5000,
      });

      expect(envelope.id).toMatch(/^evt_/);
      expect(envelope.type).toBe("payment.captured");
      expect(envelope.apiVersion).toBe(API_VERSION);
      expect(envelope.createdAt).toBeTruthy();
      expect(envelope.data.object).toEqual({
        id: "pay_123",
        status: "completed",
        amount: 5000,
      });
    });

    it("generates unique IDs for each envelope", () => {
      const e1 = catalog.buildEnvelope("payment.created", {});
      const e2 = catalog.buildEnvelope("payment.created", {});
      expect(e1.id).not.toBe(e2.id);
    });
  });
});
