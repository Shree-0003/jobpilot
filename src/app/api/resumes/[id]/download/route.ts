import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { readEncrypted } from "@/lib/resumes";
import { audit } from "@/lib/audit";

export const GET = route({ auth: "full", limit: 30 }, async ({ user, cipher, params }) => {
  const r = await (await cols.resumes()).findOne({ _id: params.id, userId: user._id });
  if (!r) throw new ApiError(404, "Resume not found.");
  const buf = cipher.decBuffer(await readEncrypted(r.objectKey));
  await audit({ userId: user._id, actor: "user", action: "resume_downloaded", entity: "resume", entityId: r._id });
  const ext = r.mime === "application/pdf" ? "pdf" : "docx";
  const name = r.label.replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 60) || "resume";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": r.mime,
      "Content-Disposition": `attachment; filename="${name}.${ext}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
});
