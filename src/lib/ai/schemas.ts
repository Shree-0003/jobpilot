import { z } from "zod";

export const PROMPT_VERSION = "eval-v1";

export const ALLOWED_LLM_FLAGS = [
  "REQUIRES_MORE_EXPERIENCE",
  "REQUIRES_RELOCATION",
  "SALARY_BELOW_PREFERENCE",
  "CONTRACT_ROLE",
  "CERTIFICATION_NOT_IN_PROFILE",
  "SUSPICIOUS_POSTING",
  "EXTERNAL_APPLICATION",
  "INFORMATION_NOT_AVAILABLE",
] as const;

const score = z.coerce.number().transform((n) => Math.max(0, Math.min(100, Math.round(n))));

export const EvaluationOutput = z
  .object({
    match_score: score,
    sub_scores: z.object({ skills: score, experience: score, location: score, industry: score, education: score }),
    strong_matches: z.array(z.object({ requirement: z.string().max(200), fact_ids: z.array(z.string().max(10)).max(10) })).max(30),
    not_found_in_profile: z.array(z.string().max(200)).max(30),
    user_lacks: z.array(z.object({ requirement: z.string().max(200), fact_ids: z.array(z.string().max(10)).max(10) })).max(30),
    risk_flags: z.array(z.string().max(60)).max(20),
    recommendation: z.enum(["AUTO_APPLY", "USER_APPROVAL", "MANUAL", "SKIP"]),
    reason: z.string().max(400),
  })
  .strict();
export type EvaluationOutputT = z.infer<typeof EvaluationOutput>;

export const AnswerOutput = z
  .object({
    answer: z.string().max(2000),
    fact_ids: z.array(z.string().max(10)).max(15),
    confidence: z.coerce.number().min(0).max(1),
    cannot_answer: z.boolean(),
  })
  .strict();
export type AnswerOutputT = z.infer<typeof AnswerOutput>;

// JSON Schemas passed to Ollama's `format` for constrained decoding.
const arrStr = { type: "array", items: { type: "string" } };
const arrReq = { type: "array", items: { type: "object", properties: { requirement: { type: "string" }, fact_ids: arrStr }, required: ["requirement", "fact_ids"] } };
const num = { type: "integer", minimum: 0, maximum: 100 };

export const EVALUATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    match_score: num,
    sub_scores: { type: "object", properties: { skills: num, experience: num, location: num, industry: num, education: num }, required: ["skills", "experience", "location", "industry", "education"] },
    strong_matches: arrReq,
    not_found_in_profile: arrStr,
    user_lacks: arrReq,
    risk_flags: arrStr,
    recommendation: { type: "string", enum: ["AUTO_APPLY", "USER_APPROVAL", "MANUAL", "SKIP"] },
    reason: { type: "string" },
  },
  required: ["match_score", "sub_scores", "strong_matches", "not_found_in_profile", "user_lacks", "risk_flags", "recommendation", "reason"],
};

export const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, fact_ids: arrStr, confidence: { type: "number" }, cannot_answer: { type: "boolean" } },
  required: ["answer", "fact_ids", "confidence", "cannot_answer"],
};
