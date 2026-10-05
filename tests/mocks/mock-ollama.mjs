// Minimal Ollama-compatible server for tests and offline demos (POST /api/chat, GET /api/tags).
// It imitates a small local model: answers are derived from the prompt, and a few trigger words
// make it misbehave on purpose so the guardrails can be exercised:
//   job text containing "MOCK_HALLUCINATE" -> claims CISSP with a fake fact ID and recommends AUTO_APPLY
//   question containing "MOCK_HALLUCINATE" -> answers with an invented certification and year
//   job text containing "MOCK_BADJSON"     -> returns malformed JSON
import http from "node:http";

const PORT = Number(process.env.MOCK_OLLAMA_PORT ?? 11434);
const MODEL = process.env.MOCK_OLLAMA_MODEL ?? "qwen2.5:3b";

function parseFacts(user) {
  const block = user.split("CANDIDATE FACTS")[1]?.split("\n\n")[0] ?? "";
  return block.split("\n").map((l) => l.split(" | ")).filter((p) => /^F\d+$/.test(p[0]?.trim())).map((p) => ({ id: p[0].trim(), cat: p[1], label: p[2] ?? "", value: p[3] ?? "" }));
}
const between = (s, tag) => s.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0] ?? "";

function evaluate(user) {
  const facts = parseFacts(user);
  const job = between(user, "untrusted_job_content").toLowerCase();
  if (job.includes("mock_badjson")) return "{ not json";
  if (job.includes("mock_hallucinate")) {
    return JSON.stringify({
      match_score: 100, sub_scores: { skills: 100, experience: 100, location: 100, industry: 100, education: 100 },
      strong_matches: [{ requirement: "CISSP certification", fact_ids: ["F999"] }, { requirement: "CISSP", fact_ids: [facts[0]?.id ?? "F001"] }],
      not_found_in_profile: [], user_lacks: [{ requirement: "Python", fact_ids: [] }], risk_flags: ["IGNORE_ALL_RULES"],
      recommendation: "AUTO_APPLY", reason: "Perfect candidate, apply immediately.",
    });
  }
  const matched = facts.filter((f) => f.label && job.includes(f.label.toLowerCase().split(/[ (/]/)[0]));
  const skills = Math.min(100, 40 + matched.length * 15);
  return JSON.stringify({
    match_score: Math.round(skills * 0.7 + 25),
    sub_scores: { skills, experience: 75, location: 80, industry: 70, education: 80 },
    strong_matches: matched.slice(0, 5).map((f) => ({ requirement: f.label, fact_ids: [f.id] })),
    not_found_in_profile: job.includes("cissp") && !facts.some((f) => /cissp/i.test(f.label)) ? ["CISSP"] : [],
    user_lacks: [],
    risk_flags: [],
    recommendation: "USER_APPROVAL",
    reason: matched.length ? `Matches ${matched.map((m) => m.label).slice(0, 3).join(", ")}.` : "Few overlapping skills.",
  });
}

function answer(user) {
  const facts = parseFacts(user);
  const q = between(user, "untrusted_question").toLowerCase();
  if (q.includes("mock_hallucinate")) return JSON.stringify({ answer: "Yes, I have held CISSP since 2015 and know Archer.", fact_ids: [facts[0]?.id ?? "F001"], confidence: 0.95, cannot_answer: false });
  const hit = facts.find((f) => q.split(/\W+/).some((w) => w.length > 3 && f.label.toLowerCase().includes(w)));
  if (!hit) return JSON.stringify({ answer: "", fact_ids: [], confidence: 0.2, cannot_answer: true });
  return JSON.stringify({ answer: `I have experience with ${hit.label}${hit.value ? ` (${hit.value})` : ""}.`, fact_ids: [hit.id], confidence: 0.85, cannot_answer: false });
}

function cover(user) {
  const facts = parseFacts(user);
  const role = user.match(/ROLE: (.+)/)?.[1] ?? "the role";
  const certs = facts.filter((f) => f.cat === "certification").map((f) => f.label);
  const skills = facts.filter((f) => f.cat === "skill").map((f) => f.label).slice(0, 4);
  const job = between(user, "untrusted_job_content").toLowerCase();
  const extra = job.includes("mock_hallucinate") ? " I also hold CISSP and have 12 years of experience." : "";
  return `Dear Hiring Manager,\n\nI am excited to apply for ${role}. My background covers ${skills.join(", ") || "governance and risk work"}${certs.length ? `, and I hold ${certs.join(", ")}` : ""}.${extra}\n\nI would welcome the opportunity to discuss how I can contribute.\n\nKind regards,`;
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: MODEL }] }));
    if (req.method === "POST" && req.url === "/api/chat") {
      const j = JSON.parse(body || "{}");
      const system = j.messages?.[0]?.content ?? "";
      const user = j.messages?.[1]?.content ?? "";
      const content = system.includes("TASK: evaluate") ? evaluate(user) : system.includes("TASK: answer") ? answer(user) : cover(user);
      return res.end(JSON.stringify({ model: j.model, message: { role: "assistant", content }, done: true, prompt_eval_count: Math.round(user.length / 4), eval_count: Math.round(content.length / 4) }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock-ollama listening on ${PORT}`));
