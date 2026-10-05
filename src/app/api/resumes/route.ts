import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { newId } from "@/lib/crypto";
import { audit, securityEvent } from "@/lib/audit";
import { clamScan, fileHash, inspectFile, MAX_RESUME_BYTES, storeEncrypted } from "@/lib/resumes";

export const GET = route({ auth: "full" }, async ({ user }) => {
  const r = await (await cols.resumes()).find({ userId: user._id }).sort({ createdAt: -1 }).project({ objectKey: 0 }).toArray();
  return { resumes: r };
});

export const POST = route({ auth: "full", limit: 20 }, async ({ req, user, cipher, ip }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RESUME_BYTES + 64 * 1024) throw new ApiError(413, "File is larger than 5 MB.");
  const form = await req.formData();
  const file = form.get("file");
  const label = String(form.get("label") ?? "").trim().slice(0, 80);
  const keywords = String(form.get("focusKeywords") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20).map((s) => s.slice(0, 40));
  if (!(file instanceof File)) throw new ApiError(400, "Choose a file.");
  if (!label) throw new ApiError(400, "Give the resume a label, e.g. Security/GRC Resume.");
  const buf = Buffer.from(await file.arrayBuffer());
  const { mime, problems } = inspectFile(buf);
  const clam = mime && !problems.length ? await clamScan(buf) : null;
  if (clam && !clam.clean) problems.push(`Antivirus: ${clam.detail}`);
  if (!mime || problems.length) {
    await securityEvent({ userId: user._id, type: "upload_rejected", severity: "medium", ip, details: { problems } });
    throw new ApiError(400, `Upload rejected: ${problems.join(" ")}`);
  }
  const objectKey = await storeEncrypted(cipher.encBuffer(buf));
  const doc = { _id: newId(), userId: user._id, label, focusKeywords: keywords, objectKey, sha256: fileHash(buf), mime, size: buf.length, scanStatus: "clean" as const, scanDetail: clam ? clam.detail : "Structure checks passed (ClamAV not configured)", approved: false, createdAt: new Date() };
  await (await cols.resumes()).insertOne(doc);
  await audit({ userId: user._id, actor: "user", action: "resume_uploaded", entity: "resume", entityId: doc._id, details: { label, size: buf.length, mime } });
  const { objectKey: _k, ...safe } = doc;
  void _k;
  return { resume: safe };
});
