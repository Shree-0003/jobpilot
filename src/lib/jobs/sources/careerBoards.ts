import { z } from "zod";
import { safeFetchJson } from "../ssrf";
import { sanitizeLine, sanitizeText, decodeEntities } from "../sanitize";
import { inferEmploymentType, inferWorkMode, type JobDraft } from "./types";
import type { CareerBoard } from "../../types";

// Public, read-only job-board feeds published by employers. Each vendor must pass the
// connector ToS review before it is enabled (see CONNECTORS in lib/jobs/connectors.ts).

const TOKEN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

const Greenhouse = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string().url(),
      location: z.object({ name: z.string().optional().default("") }).partial().optional(),
      content: z.string().optional().default(""),
    }).passthrough(),
  ),
});

const Lever = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string().url(),
    categories: z.object({ location: z.string().optional(), commitment: z.string().optional() }).partial().optional(),
    descriptionPlain: z.string().optional().default(""),
    lists: z.array(z.object({ text: z.string(), content: z.string() })).optional().default([]),
    workplaceType: z.string().optional(),
  }).passthrough(),
);

export async function fetchBoard(board: CareerBoard, fetchImpl?: typeof fetch): Promise<JobDraft[]> {
  if (!TOKEN.test(board.token)) throw new Error("Invalid board token");
  if (board.vendor === "greenhouse") {
    const data = Greenhouse.parse(await safeFetchJson(`https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`, fetchImpl));
    return data.jobs.slice(0, 200).map((j) => {
      const desc = sanitizeText(decodeEntities(j.content ?? ""));
      return {
        portal: "greenhouse",
        source: "career_board",
        url: j.absolute_url,
        externalJobId: `gh-${board.token}-${j.id}`,
        title: sanitizeLine(j.title),
        company: sanitizeLine(board.token),
        location: sanitizeLine(j.location?.name ?? ""),
        description: desc,
        workMode: inferWorkMode(`${j.location?.name ?? ""} ${desc.slice(0, 600)}`),
        employmentType: inferEmploymentType(desc.slice(0, 1500)),
      } satisfies JobDraft;
    });
  }
  const data = Lever.parse(await safeFetchJson(`https://api.lever.co/v0/postings/${board.token}?mode=json`, fetchImpl));
  return data.slice(0, 200).map((j) => {
    const lists = j.lists.map((l) => `${l.text}\n${l.content}`).join("\n");
    const desc = sanitizeText(`${j.descriptionPlain}\n${lists}`);
    return {
      portal: "lever",
      source: "career_board",
      url: j.hostedUrl,
      externalJobId: `lv-${board.token}-${j.id}`,
      title: sanitizeLine(j.text),
      company: sanitizeLine(board.token),
      location: sanitizeLine(j.categories?.location ?? ""),
      description: desc,
      workMode: j.workplaceType === "remote" ? "remote" : j.workplaceType === "hybrid" ? "hybrid" : j.workplaceType === "onsite" ? "onsite" : inferWorkMode(desc.slice(0, 600)),
      employmentType: inferEmploymentType(`${j.categories?.commitment ?? ""} ${desc.slice(0, 800)}`),
    } satisfies JobDraft;
  });
}
