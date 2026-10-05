import { route } from "@/lib/http";
import { cols } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/ai/gateway";
import { CONNECTORS } from "@/lib/jobs/connectors";
import { getDiscoveryStatus, sourcesConfigured } from "@/lib/jobs/discovery";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  const [health, discovery] = await Promise.all([llm().health(), getDiscoveryStatus(user._id)]);
  const sources = sourcesConfigured(prefs);
  return {
    llm: { provider: llm().name, model: llm().model, ...health },
    gmailMcp: { configured: sources.gmailMcp },
    sources,
    schedule: { everyHours: env().DISCOVERY_INTERVAL_HOURS, maxNewPerRun: env().DISCOVERY_MAX_NEW_PER_RUN },
    discovery,
    connectors: Object.values(CONNECTORS),
  };
});
