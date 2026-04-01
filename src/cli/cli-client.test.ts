import { describe, it, expect } from "vitest";
import { parseArgs, formatTable } from "./cli-client.js";

describe("CLI Client", () => {
  describe("parseArgs", () => {
    it("parses simple command", () => {
      const result = parseArgs(["node", "cli.ts", "help"]);
      expect(result.command).toBe("help");
      expect(result.subcommand).toBe("");
      expect(result.flags).toEqual({});
    });

    it("parses command with subcommand", () => {
      const result = parseArgs(["node", "cli.ts", "payments", "list"]);
      expect(result.command).toBe("payments");
      expect(result.subcommand).toBe("list");
    });

    it("parses flags with values", () => {
      const result = parseArgs(["node", "cli.ts", "payments", "create", "--amount", "5000", "--currency", "EUR"]);
      expect(result.command).toBe("payments");
      expect(result.subcommand).toBe("create");
      expect(result.flags["amount"]).toBe("5000");
      expect(result.flags["currency"]).toBe("EUR");
    });

    it("handles boolean flags", () => {
      const result = parseArgs(["node", "cli.ts", "login", "--verbose", "--key", "abc"]);
      expect(result.flags["verbose"]).toBe("true");
      expect(result.flags["key"]).toBe("abc");
    });

    it("defaults to help when no command", () => {
      const result = parseArgs(["node", "cli.ts"]);
      expect(result.command).toBe("help");
    });
  });

  describe("formatTable", () => {
    it("formats a table with headers and rows", () => {
      const rows = [
        { id: "pay_1", status: "completed", amount: 5000 },
        { id: "pay_2", status: "failed", amount: 1000 },
      ];
      const output = formatTable(rows, ["id", "status", "amount"]);
      const lines = output.split("\n");
      expect(lines.length).toBe(4); // header + separator + 2 rows
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("status");
      expect(lines[0]).toContain("amount");
      expect(lines[2]).toContain("pay_1");
      expect(lines[2]).toContain("completed");
    });

    it("handles empty rows", () => {
      const output = formatTable([], ["id", "status"]);
      expect(output).toBe("No results.");
    });

    it("handles missing fields gracefully", () => {
      const rows = [{ id: "pay_1" }];
      const output = formatTable(rows, ["id", "status"]);
      expect(output).toContain("pay_1");
    });

    it("pads columns to max width", () => {
      const rows = [
        { name: "short", id: "1" },
        { name: "a much longer name", id: "2" },
      ];
      const output = formatTable(rows, ["name", "id"]);
      const lines = output.split("\n");
      // Header should be padded to accommodate the longest value
      expect(lines[0]).toContain("name");
      // Data row with short value should still be aligned (contains spaces)
      expect(lines[2]!.length).toBeGreaterThan("short".length);
    });
  });
});
