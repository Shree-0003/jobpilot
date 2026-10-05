import { z } from "zod";
import { route, body } from "@/lib/http";
import { cols } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { ProfileSensitive } from "@/lib/types";

const url = z.string().trim().max(300).refine((v) => !v || /^https:\/\/[^\s<>"']+$/i.test(v), "Must be an https:// link").optional().default("");
const list = z.array(z.string().trim().max(80)).max(30).default([]);
const Schema = z.object({
  fullName: z.string().trim().max(120).default(""),
  email: z.string().trim().max(254).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email").default(""),
  phone: z.string().trim().max(30).refine((v) => !v || /^[+\d][\d\s()-]{6,}$/.test(v), "Invalid phone").default(""),
  dob: z.string().trim().max(10).refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD").optional().default(""),
  address: z.string().trim().max(400).optional().default(""),
  currentLocation: z.string().trim().max(120).default(""),
  preferredLocations: list,
  currentDesignation: z.string().trim().max(120).default(""),
  employmentTypePref: list,
  links: z.object({ linkedin: url, naukri: url, portfolio: url, github: url, website: url }).partial().default({}),
});

export const GET = route({ auth: "full" }, async ({ user, cipher }) => {
  const p = await (await cols.profiles()).findOne({ _id: user._id });
  const s = cipher.decJson<ProfileSensitive>(p?.sensitiveEnc) ?? { fullName: "", email: "", phone: "" };
  return { ...p?.plain, ...s };
});

export const PUT = route({ auth: "full", limit: 30 }, async ({ req, user, cipher }) => {
  const v = await body(req, Schema);
  const sensitive: ProfileSensitive = { fullName: v.fullName, email: v.email, phone: v.phone, dob: v.dob || undefined, address: v.address || undefined };
  await (await cols.profiles()).updateOne(
    { _id: user._id },
    { $set: { plain: { currentLocation: v.currentLocation, preferredLocations: v.preferredLocations, currentDesignation: v.currentDesignation, links: v.links, employmentTypePref: v.employmentTypePref }, sensitiveEnc: cipher.encJson(sensitive), updatedAt: new Date() } },
    { upsert: true },
  );
  await audit({ userId: user._id, actor: "user", action: "profile_updated" });
  return { ok: true };
});
