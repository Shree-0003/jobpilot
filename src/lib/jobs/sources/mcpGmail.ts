import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "../../env";
import { parseAlertEmail } from "./alertEmail";
import type { JobDraft } from "./types";

/**
 * Reads LinkedIn/Naukri job-alert emails from the user's Gmail through an open-source
 * Gmail MCP server (stdio). Guardrails:
 *  - only the two configured read tools may be called; any tool whose name suggests a write
 *    (send, delete, modify, trash, draft, label, filter) is refused even if configured;
 *  - the MCP server's output is treated as untrusted text and goes through the same parser
 *    and sanitiser as a pasted email;
 *  - the LLM never sees or calls MCP tools — this is deterministic application code.
 */
const WRITE_TOOL = /(send|delete|modify|trash|draft|label|filter|batch|update|create|forward|reply)/i;
const MAX_MESSAGES = 25;

export function mcpConfigured() {
  return !!env().MCP_GMAIL_COMMAND;
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] })?.content ?? [];
  return content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n").slice(0, 500_000);
}

export function extractMessageIds(searchText: string): string[] {
  const ids = new Set<string>();
  try {
    const j = JSON.parse(searchText);
    const arr = Array.isArray(j) ? j : j.messages ?? j.results ?? [];
    for (const m of arr) if (typeof m?.id === "string") ids.add(m.id);
  } catch {
    for (const m of searchText.matchAll(/\bID:\s*([A-Za-z0-9_-]{6,})/g)) ids.add(m[1]);
  }
  return [...ids].slice(0, MAX_MESSAGES);
}

export async function fetchAlertsViaMcp(): Promise<{ drafts: JobDraft[]; messages: number }> {
  const e = env();
  if (!e.MCP_GMAIL_COMMAND) throw new Error("Gmail MCP server is not configured (MCP_GMAIL_COMMAND).");
  for (const t of [e.MCP_GMAIL_SEARCH_TOOL, e.MCP_GMAIL_READ_TOOL]) {
    if (WRITE_TOOL.test(t)) throw new Error(`Refusing to call MCP tool "${t}": only read-only tools are allowed.`);
  }
  const transport = new StdioClientTransport({
    command: e.MCP_GMAIL_COMMAND,
    args: e.MCP_GMAIL_ARGS ? e.MCP_GMAIL_ARGS.split(" ").filter(Boolean) : [],
    // Minimal environment: do not leak app secrets (MASTER_KEY, DB URI) to the child process.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stderr: "ignore",
  });
  const client = new Client({ name: "jobpilot", version: "0.1.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    if (!names.has(e.MCP_GMAIL_SEARCH_TOOL) || !names.has(e.MCP_GMAIL_READ_TOOL)) {
      throw new Error("Configured MCP tools were not found on the server.");
    }
    const search = await client.callTool({ name: e.MCP_GMAIL_SEARCH_TOOL, arguments: { query: e.MCP_GMAIL_QUERY, maxResults: MAX_MESSAGES } });
    const ids = extractMessageIds(textOf(search));
    const drafts: JobDraft[] = [];
    for (const id of ids) {
      const msg = await client.callTool({ name: e.MCP_GMAIL_READ_TOOL, arguments: { messageId: id } });
      drafts.push(...parseAlertEmail(textOf(msg), "mcp_gmail"));
    }
    return { drafts, messages: ids.length };
  } finally {
    await client.close().catch(() => undefined);
  }
}
