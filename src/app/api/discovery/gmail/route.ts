import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { fetchAlertsViaMcp, mcpConfigured } from "@/lib/jobs/sources/mcpGmail";
import { ingestDrafts } from "@/lib/jobs/service";
import { audit, securityEvent } from "@/lib/audit";

export const POST = route({ auth: "full", limit: 6 }, async ({ user, cipher, ip }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  if (prefs?.automationState !== "running") throw new ApiError(409, "Automation is paused or stopped.");
  if (!mcpConfigured()) throw new ApiError(412, "Gmail MCP server is not configured. See README → Gmail via MCP.");
  try {
    const { drafts, messages } = await fetchAlertsViaMcp();
    const r = await ingestDrafts(user, cipher, drafts);
    await audit({ userId: user._id, actor: "system", action: "gmail_mcp_sync", details: { messages, found: drafts.length, created: r.created.length, duplicates: r.duplicates.length } });
    return { messages, found: drafts.length, created: r.created.length, duplicates: r.duplicates.length };
  } catch (e) {
    await securityEvent({ userId: user._id, type: "connector_error", severity: "low", ip, details: { connector: "gmail_mcp", error: (e as Error).message.slice(0, 120) } });
    throw new ApiError(502, `Gmail MCP sync failed: ${(e as Error).message.slice(0, 160)}`);
  }
});
