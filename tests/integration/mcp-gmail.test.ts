import { describe, expect, it, beforeAll } from "vitest";
import path from "node:path";

beforeAll(() => {
  process.env.MCP_GMAIL_COMMAND = "node";
  process.env.MCP_GMAIL_ARGS = path.resolve("tests/mocks/mock-gmail-mcp.mjs");
  process.env.MCP_GMAIL_SEARCH_TOOL = "search_emails";
  process.env.MCP_GMAIL_READ_TOOL = "read_email";
});

describe("Gmail via MCP (stdio, mock server)", () => {
  it("reads alert emails through read-only tools and parses jobs", async () => {
    const { fetchAlertsViaMcp } = await import("@/lib/jobs/sources/mcpGmail");
    const r = await fetchAlertsViaMcp();
    expect(r.messages).toBe(2);
    expect(r.drafts.map((d) => d.title)).toEqual(["Senior GRC Analyst", "Third Party Risk Analyst", "Information Security Analyst"]);
    expect(r.drafts.every((d) => d.source === "mcp_gmail")).toBe(true);
  });
});
