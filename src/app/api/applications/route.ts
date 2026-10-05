import { route } from "@/lib/http";
import { cols } from "@/lib/db";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const apps = await (await cols.applications()).find({ userId: user._id }).sort({ createdAt: -1 }).limit(1000)
    .project({ notesEnc: 0, coverLetterEnc: 0, questions: 0, userId: 0 }).toArray();
  return { applications: apps };
});
