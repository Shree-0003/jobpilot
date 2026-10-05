import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { getDiscoveryStatus, runDiscovery } from "@/lib/jobs/discovery";

// Starts a discovery run in the background and returns immediately; poll /api/discovery/status.
export const POST = route({ auth: "full", limit: 6 }, async ({ user }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  if (prefs?.automationState !== "running") throw new ApiError(409, "Automation is paused or stopped. Press Resume first.");
  const st = await getDiscoveryStatus(user._id);
  if (!st.running) void runDiscovery(user, "manual");
  return { started: !st.running, alreadyRunning: st.running };
});
