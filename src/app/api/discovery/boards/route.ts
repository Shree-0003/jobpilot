import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { fetchBoard } from "@/lib/jobs/sources/careerBoards";
import { ingestDrafts } from "@/lib/jobs/service";
import { titleSimilarity } from "@/lib/ai/baseline";
import { audit } from "@/lib/audit";

export const POST = route({ auth: "full", limit: 6 }, async ({ user, cipher }) => {
  const prefs = await (await cols.prefs()).findOne({ _id: user._id });
  if (!prefs || prefs.automationState !== "running") throw new ApiError(409, "Automation is paused or stopped.");
  if (!prefs.careerBoards.length) throw new ApiError(412, "Add company career boards in Preferences first.");
  const results: { board: string; found: number; created: number; error?: string }[] = [];
  for (const b of prefs.careerBoards) {
    try {
      const all = await fetchBoard(b);
      // Only pull roles that resemble your target titles or keywords, to keep data minimal.
      const wanted = all.filter((d) =>
        (!prefs.targetTitles.length && !prefs.keywords.length) ||
        prefs.targetTitles.some((t) => titleSimilarity(t, d.title) >= 0.5) ||
        prefs.keywords.some((k) => d.title.toLowerCase().includes(k.toLowerCase())));
      const r = await ingestDrafts(user, cipher, wanted.slice(0, 25));
      results.push({ board: `${b.vendor}:${b.token}`, found: wanted.length, created: r.created.length });
    } catch (e) {
      results.push({ board: `${b.vendor}:${b.token}`, found: 0, created: 0, error: (e as Error).message.slice(0, 120) });
    }
  }
  await audit({ userId: user._id, actor: "system", action: "career_board_sync", details: { boards: results.length, created: results.reduce((n, r) => n + r.created, 0) } });
  return { results };
});
