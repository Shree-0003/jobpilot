import { describe, expect, it } from "vitest";

describe("Gmail MCP write-tool refusal", () => {
  it("refuses to run when a write tool is configured", async () => {
    process.env.MCP_GMAIL_COMMAND = "node";
    process.env.MCP_GMAIL_ARGS = "tests/mocks/mock-gmail-mcp.mjs";
    process.env.MCP_GMAIL_SEARCH_TOOL = "search_emails";
    process.env.MCP_GMAIL_READ_TOOL = "send_email";
    const { fetchAlertsViaMcp } = await import("@/lib/jobs/sources/mcpGmail");
    await expect(fetchAlertsViaMcp()).rejects.toThrow(/only read-only tools/);
  });
});
