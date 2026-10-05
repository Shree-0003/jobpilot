// Job descriptions, alert emails and application questions are UNTRUSTED.
// Everything passes through here before storage, display or the LLM.

export const MAX_DESCRIPTION = 12_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) return safeChar(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return safeChar(parseInt(k.slice(1), 10));
    return m;
  });
}
function safeChar(cp: number) {
  return Number.isFinite(cp) && cp > 31 && cp < 0x10ffff ? String.fromCodePoint(cp) : " ";
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|iframe|object|embed|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  );
}

// Zero-width, bidi overrides, tag characters and C0/C1 controls (keep \n and \t).
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]|[\u{E0000}-\u{E007F}]/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sanitizeText(input: string, max = MAX_DESCRIPTION): string {
  let s = input ?? "";
  if (/<[a-z!/][^>]*>/i.test(s)) s = stripHtml(s);
  s = s.normalize("NFKC").replace(INVISIBLE, "").replace(CONTROL, " ");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > max ? s.slice(0, max) + " …[truncated]" : s;
}

export function sanitizeLine(input: string, max = 200): string {
  return sanitizeText(input, max).replace(/\s+/g, " ");
}

const INJECTION_PATTERNS: [string, RegExp][] = [
  ["ignore_instructions", /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|directions?)\b/i],
  ["role_hijack", /\b(you are now|act as|pretend to be|from now on you)\b/i],
  ["prompt_markers", /(<\|im_start\|>|<\|system\|>|\[INST\]|<<SYS>>|^\s*(system|assistant)\s*:)/im],
  ["secret_exfiltration", /\b(reveal|print|show|send|output|leak|share|give)\b[^.\n]{0,60}\b(password|passcode|credential|token|cookie|secret|api[ -]?key|system prompt|otp|session)\b/i],
  ["data_exfiltration", /\b(send|email|post|upload|forward)\b[^.\n]{0,40}\b(resume|cv|profile|personal (data|details|information))\b[^.\n]{0,40}\b(to|at)\b[^.\n]{0,40}(@|https?:\/\/)/i],
  ["decision_tampering", /\b(set|mark|change|output)\b[^.\n]{0,30}\b(recommendation|match[_ ]?score|decision|auto[_ ]?apply)\b/i],
  ["hidden_from_user", /\b(do not|don't|never)\b[^.\n]{0,20}\b(tell|inform|show|mention)\b[^.\n]{0,20}\b(the )?(user|candidate|human)\b/i],
  ["encoded_payload", /[A-Za-z0-9+/]{120,}={0,2}/],
];

export function detectInjection(text: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of INJECTION_PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}

const SUSPICIOUS_PATTERNS: [string, RegExp][] = [
  ["asks_for_payment", /\b(registration|processing|training|security|joining)\s+(fee|deposit|charges?)\b|\bpay\b[^.\n]{0,30}\b(fee|amount|deposit)\b/i],
  ["off_platform_contact", /\b(whats ?app|telegram|signal)\b[^.\n]{0,40}(\+?\d[\d\s-]{8,}|only)/i],
  ["unrealistic_offer", /\b(no interview|guaranteed (job|placement|selection)|earn \d+[k ]? (per|a) (day|week))\b/i],
  ["asks_sensitive_upfront", /\b(aadhaar|pan card|bank (account|details)|passport (copy|number)|otp)\b/i],
];

export function detectSuspicious(text: string): string[] {
  const hits: string[] = [];
  for (const [name, re] of SUSPICIOUS_PATTERNS) if (re.test(text)) hits.push(name);
  return hits;
}
