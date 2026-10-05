import "server-only";
import { env } from "../env";
import { cols } from "../db";
import { newId } from "../crypto";
import { OllamaProvider, type LLMProvider } from "./provider";
import { evaluationPrompt, answerPrompt, coverLetterPrompt, type Tone } from "./prompts";
import { AnswerOutput, ANSWER_JSON_SCHEMA, EvaluationOutput, EVALUATION_JSON_SCHEMA, PROMPT_VERSION, type EvaluationOutputT } from "./schemas";
import { guardEvaluation, validateAnswer, validateCoverLetter, fallbackCoverLetter, deterministicAnswer, type DraftAnswer } from "./guardrails";
import type { AiLogDoc, Fact } from "../types";

/**
 * AI Gateway: the single path to an LLM.
 *   sanitised input → PII-minimised prompt → LLM → schema validation → guardrails → caller
 * Logs metadata only (model, tokens, latency, validation result) — never prompt or response text.
 */
let provider: LLMProvider | null = null;
export function llm(): LLMProvider {
  if (!provider) provider = new OllamaProvider(env().OLLAMA_URL, env().OLLAMA_MODEL, env().OLLAMA_TIMEOUT_MS);
  return provider;
}
export function setProviderForTests(p: LLMProvider | null) {
  provider = p;
}

async function log(entry: Omit<AiLogDoc, "_id" | "ts" | "provider" | "model" | "promptVersion">) {
  const p = llm();
  await (await cols.aiLog()).insertOne({ _id: newId(), ts: new Date(), provider: p.name, model: p.model, promptVersion: PROMPT_VERSION, ...entry });
}

function extractJson(s: string): unknown {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(s.slice(start, end + 1));
}

export async function llmEvaluate(userId: string, facts: Fact[], job: Parameters<typeof evaluationPrompt>[1]) {
  const { system, user } = evaluationPrompt(facts, job);
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await llm().chat({ system, user, schema: EVALUATION_JSON_SCHEMA, maxTokens: 900 });
      const parsed = EvaluationOutput.safeParse(extractJson(r.content));
      if (!parsed.success) {
        if (attempt === 0) continue;
        await log({ userId, requestType: "evaluate", latencyMs: Date.now() - t0, tokensIn: r.tokensIn, tokensOut: r.tokensOut, schemaValid: false, guardrailResult: "rejected" });
        return null;
      }
      const guarded = guardEvaluation(parsed.data, facts);
      await log({ userId, requestType: "evaluate", latencyMs: Date.now() - t0, tokensIn: r.tokensIn, tokensOut: r.tokensOut, schemaValid: true, guardrailResult: guarded.notes.length ? "corrected" : "pass" });
      return { raw: parsed.data as EvaluationOutputT, ...guarded };
    } catch (e) {
      if (attempt === 0 && !(e instanceof Error && /abort|ECONNREFUSED|fetch failed|not reachable/i.test(e.message))) continue;
      await log({ userId, requestType: "evaluate", latencyMs: Date.now() - t0, schemaValid: false, guardrailResult: "unavailable", error: (e as Error).message.slice(0, 120) });
      return null;
    }
  }
  return null;
}

export async function draftAnswer(userId: string, facts: Fact[], question: string, job: { title: string; company: string }): Promise<DraftAnswer & { source: "rules" | "ai" | "none" }> {
  const det = deterministicAnswer(question, facts);
  if (det) return { ...det, source: "rules" };
  const { system, user } = answerPrompt(facts, question, job);
  const t0 = Date.now();
  try {
    const r = await llm().chat({ system, user, schema: ANSWER_JSON_SCHEMA, maxTokens: 400 });
    const parsed = AnswerOutput.safeParse(extractJson(r.content));
    if (!parsed.success) {
      await log({ userId, requestType: "answer", latencyMs: Date.now() - t0, schemaValid: false, guardrailResult: "rejected" });
      return { answer: "", factIds: [], status: "human_review_required", reason: "AI output failed validation. Answer this yourself.", sensitive: false, source: "none" };
    }
    const a = parsed.data;
    if (a.cannot_answer) {
      await log({ userId, requestType: "answer", latencyMs: Date.now() - t0, schemaValid: true, guardrailResult: "pass" });
      return { answer: "", factIds: [], status: "human_review_required", reason: "Required information is unavailable in your verified facts.", sensitive: false, source: "ai" };
    }
    const problems = validateAnswer(a.answer, a.fact_ids, facts);
    if (a.confidence < 0.6) problems.push(`Low confidence (${a.confidence}).`);
    await log({ userId, requestType: "answer", latencyMs: Date.now() - t0, tokensIn: r.tokensIn, tokensOut: r.tokensOut, schemaValid: true, guardrailResult: problems.length ? "rejected" : "pass" });
    if (problems.length) {
      return { answer: a.answer, factIds: a.fact_ids.filter((id) => facts.some((f) => f.factId === id)), status: "human_review_required", reason: `Guardrail: ${problems.join(" ")}`, sensitive: false, source: "ai" };
    }
    return { answer: a.answer, factIds: a.fact_ids, status: "drafted", reason: `Drafted from ${a.fact_ids.join(", ")}.`, sensitive: false, source: "ai" };
  } catch (e) {
    await log({ userId, requestType: "answer", latencyMs: Date.now() - t0, schemaValid: false, guardrailResult: "unavailable", error: (e as Error).message.slice(0, 120) });
    return { answer: "", factIds: [], status: "human_review_required", reason: "AI unavailable. Answer this yourself or retry later.", sensitive: false, source: "none" };
  }
}

export async function generateCoverLetter(userId: string, facts: Fact[], job: { title: string; company: string; description: string }, tone: Tone) {
  const { system, user } = coverLetterPrompt(facts, job, tone);
  const t0 = Date.now();
  try {
    const r = await llm().chat({ system, user, maxTokens: 700 });
    const text = r.content.replace(/^```\w*\n?|```$/g, "").trim().slice(0, 5000);
    const flags = validateCoverLetter(text, facts);
    await log({ userId, requestType: "cover_letter", latencyMs: Date.now() - t0, tokensIn: r.tokensIn, tokensOut: r.tokensOut, schemaValid: true, guardrailResult: flags.length ? "corrected" : "pass" });
    return { text, flags, source: "ai" as const };
  } catch (e) {
    await log({ userId, requestType: "cover_letter", latencyMs: Date.now() - t0, schemaValid: false, guardrailResult: "unavailable", error: (e as Error).message.slice(0, 120) });
    const text = fallbackCoverLetter(facts, job, tone);
    return { text, flags: ["AI unavailable — this is a template built only from your verified facts."], source: "template" as const };
  }
}
