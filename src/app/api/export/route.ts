import { route, ApiError } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";
import { toCsv, toXlsx } from "@/lib/export";

export const GET = route({ auth: "full", limit: 10 }, async ({ req, user, cipher }) => {
  const type = req.nextUrl.searchParams.get("type");
  const format = req.nextUrl.searchParams.get("format");
  if (!["applications", "audit"].includes(type ?? "") || !["csv", "xlsx"].includes(format ?? "")) throw new ApiError(400, "type=applications|audit and format=csv|xlsx");
  let headers: string[];
  let rows: unknown[][];
  if (type === "applications") {
    const apps = await (await cols.applications()).find({ userId: user._id }).sort({ createdAt: -1 }).toArray();
    headers = ["Application ID", "Job Title", "Company", "Portal", "Job URL", "Match Score", "Resume Used", "Application Date", "Application Status", "Automation Status", "Failure Reason", "Questions", "Answers", "Follow-up Date", "Current Hiring Status", "Notes"];
    rows = apps.map((a) => [
      a.appId, a.jobTitle, a.company, a.portal, a.jobUrl ?? "", a.matchScore, a.resumeLabel ?? "", (a.submittedAt ?? a.approvedAt).toISOString(), a.status, a.automationStatus, a.failureReason ?? "",
      a.questions.map((q) => q.question).join(" | "), a.questions.map((q) => cipher.dec(q.answerEnc)).join(" | "), a.followUpDate ?? "", a.hiringStatus ?? "", cipher.dec(a.notesEnc),
    ]);
  } else {
    const logs = await (await cols.audit()).find({ userId: user._id }).sort({ seq: 1 }).toArray();
    headers = ["Seq", "Timestamp", "Actor", "Action", "Entity", "Entity ID", "Details", "Row hash"];
    rows = logs.map((l) => [l.seq, new Date(l.ts).toISOString(), l.actor, l.action, l.entity ?? "", l.entityId ?? "", JSON.stringify(l.details), l.rowHash]);
  }
  await audit({ userId: user._id, actor: "user", action: "data_exported", details: { type, format, rows: rows.length } });
  const name = `jobpilot-${type}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "csv") {
    return new Response("﻿" + toCsv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  }
  const buf = await toXlsx(type === "applications" ? "Applications" : "Audit log", headers, rows);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
});
