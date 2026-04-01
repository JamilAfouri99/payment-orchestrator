import { describe, it, expect } from "vitest";
import { ALL_QUEUE_NAMES, type QueueName } from "./queue-service.js";

describe("QueueService", () => {
  describe("queue names", () => {
    it("defines 7 queue names", () => {
      expect(ALL_QUEUE_NAMES.length).toBe(7);
    });

    it("includes payment-processing", () => {
      expect(ALL_QUEUE_NAMES).toContain("payment-processing");
    });

    it("includes webhook-delivery", () => {
      expect(ALL_QUEUE_NAMES).toContain("webhook-delivery");
    });

    it("includes settlement-calculation", () => {
      expect(ALL_QUEUE_NAMES).toContain("settlement-calculation");
    });

    it("includes dunning-retry", () => {
      expect(ALL_QUEUE_NAMES).toContain("dunning-retry");
    });

    it("includes report-generation", () => {
      expect(ALL_QUEUE_NAMES).toContain("report-generation");
    });

    it("includes dispute-resolution", () => {
      expect(ALL_QUEUE_NAMES).toContain("dispute-resolution");
    });

    it("includes metrics-computation", () => {
      expect(ALL_QUEUE_NAMES).toContain("metrics-computation");
    });

    it("all names are valid QueueName type", () => {
      const validNames: QueueName[] = [
        "payment-processing",
        "webhook-delivery",
        "settlement-calculation",
        "dunning-retry",
        "report-generation",
        "dispute-resolution",
        "metrics-computation",
      ];
      expect(ALL_QUEUE_NAMES).toEqual(validNames);
    });

    it("names use kebab-case", () => {
      for (const name of ALL_QUEUE_NAMES) {
        expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      }
    });

    it("has no duplicate names", () => {
      const unique = new Set(ALL_QUEUE_NAMES);
      expect(unique.size).toBe(ALL_QUEUE_NAMES.length);
    });
  });
});
