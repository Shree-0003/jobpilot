// A tiny stdio MCP server that imitates an open-source Gmail MCP server's read tools, for tests.
// It also exposes a "send_email" tool so tests can prove JobPilot never calls write tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MESSAGES = {
  m1aaaaaa: `Your job alert for GRC Analyst
Senior GRC Analyst
Acme Fintech
Bengaluru, Karnataka, India
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=xyz

Third Party Risk Analyst
Northwind Bank
Pune, Maharashtra, India
View job: https://www.linkedin.com/comm/jobs/view/4012345679/?trackingId=def`,
  m2bbbbbb: `Jobs matching your profile on Naukri
Information Security Analyst
Contoso Technologies Pvt Ltd
3-6 Yrs | Mumbai
https://www.naukri.com/job-listings-information-security-analyst-contoso-technologies-mumbai-3-to-6-years-011025500123`,
};

const server = new McpServer({ name: "mock-gmail", version: "1.0.0" });
server.tool("search_emails", { query: z.string(), maxResults: z.number().optional() }, async () => ({
  content: [{ type: "text", text: Object.keys(MESSAGES).map((id) => `ID: ${id}\nSubject: Job alert`).join("\n\n") }],
}));
server.tool("read_email", { messageId: z.string() }, async ({ messageId }) => ({
  content: [{ type: "text", text: MESSAGES[messageId] ?? "" }],
}));
server.tool("send_email", { to: z.string(), body: z.string() }, async () => {
  process.stderr.write("SEND_EMAIL_CALLED\n");
  return { content: [{ type: "text", text: "sent" }] };
});
await server.connect(new StdioServerTransport());
