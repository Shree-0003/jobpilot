# Security design

## Principles

- **Human-controlled.** The default is Human Approval Required. LinkedIn and Naukri are hard-capped at
  *human submit* in the connector ToS register (`src/lib/jobs/connectors.ts`).
- **The LLM recommends, code decides.** The LLM has no tools, network, secrets or write access. Its only output
  is schema-validated JSON, which the deterministic policy engine (`src/lib/policy/engine.ts`) can only
  make *more* restrictive.
- **No portal credentials.** LinkedIn/Naukri logins are never requested, stored or used.
- **Data minimisation.** Prompts carry fact IDs and values only. Name, contact details, DOB, address,
  salary, notice period, work authorisation and resume files never reach the LLM.

## Threat model (summary)

| ID | Threat | Mitigation in code | Test |
| --- | --- | --- | --- |
| T1 | Prompt injection in job text or questions | `sanitize.ts` strips HTML, invisible and bidi chars; `detectInjection` flags it; flagged jobs skip the LLM and go to Manual; untrusted text is wrapped in tags with closing-tag neutralisation | unit `sanitize-dedupe`, `guardrails`; e2e 9 |
| T2 | Hallucinated qualifications or answers | `guardrails.ts`: fact-ID citation required; numbers, certifications and tools checked against cited facts; years and certification questions answered in code; uncited "lacks" → "not found" | unit `guardrails`; e2e 10, 16, 17 |
| T3 | PII leakage to the LLM | `prompts.ts` `factsForLlm` excludes sensitive categories; profile is never passed; local Ollama | unit `guardrails` (PII) |
| T4 | Account takeover | Argon2id; mandatory TOTP MFA with single-use codes (replay-protected); lockout after 5 failures; rate limits; dummy-hash timing equalisation | e2e 1, 2, 26; security spec |
| T5 | Session theft / fixation | Opaque 256-bit token, only its SHA-256 stored; HttpOnly + SameSite=Strict (+Secure and `__Host-` on HTTPS); new token per login; 30-min idle, 12-h absolute timeout; revoke-all | security spec |
| T6 | CSRF | Origin check + double-submit token on every state-changing request | security spec |
| T7 | XSS | React escaping; nonce-based strict CSP (`strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`); input sanitised before storage; `javascript:` URLs rejected | security spec (stored XSS) |
| T8 | SSRF | Fetch allowlist (Greenhouse/Lever APIs only); https only; no credentials, ports or IP literals; DNS-resolved private ranges blocked; redirects not followed; 10 s / 2 MB caps | unit `sources` |
| T9 | Malicious uploads | Magic-byte typing (PDF/DOCX only), 5 MB cap; rejects PDF JavaScript, launch actions, embedded files, XFA, DOCX macros, embedded objects and external refs; optional ClamAV; random object keys; AES-256-GCM at rest; download as attachment with `CSP: sandbox` | unit `sources`; e2e 5; security spec |
| T10 | Injection (NoSQL / formula) | zod schemas reject operator objects; CSV/XLSX cells starting `= + - @` are neutralised | security spec; unit `sanitize-dedupe` |
| T11 | IDOR / path traversal | Every query is scoped by `userId`; fact/resume IDs are pattern-checked | security spec |
| T12 | Audit tampering | Append-only, hash-chained log (SHA-256 over canonical JSON); `/api/audit/verify` | unit `sources`; e2e 23 |
| T13 | Runaway or duplicate applications | URL / portal-ID / company+title dedupe; daily, hourly and per-company caps; Emergency Stop re-checked on every action | unit `baseline-policy`; e2e 8, 21 |
| T14 | Account ban by a portal | No automation against LinkedIn/Naukri; ToS review dates expire automation | unit `baseline-policy` |
| T15 | Malicious or compromised MCP server | Read-tool allowlist; write-looking tools refused; minimal child env; output parsed as untrusted text | integration `mcp-*` |

## Controls checklist (OWASP ASVS L2 / ISO 27001:2022 Annex A)

- [x] V2 Authentication — Argon2id (m=19 MiB, t=2), 12+ char policy, mandatory TOTP, recovery codes (hashed), lockout, rate limit (A.5.17, A.8.5)
- [x] V3 Session — server-side opaque sessions, rotation on login, idle and absolute timeouts, revoke all (A.8.5)
- [x] V4 Access control — deny by default, owner scoping on every query, re-auth for export, delete and Auto Apply (A.5.15, A.8.3)
- [x] V5 Validation — zod on every endpoint, sanitisation of untrusted text, SSRF guard (A.8.28)
- [x] V6/V9 Crypto — AES-256-GCM envelope encryption with per-user DEKs bound to user ID (AAD); KEK only in env/secret store; crypto-shred on delete (A.8.24)
- [x] V7 Logging — hash-chained audit log; security events; AI gateway metadata log without prompt bodies; PII-key scrubbing (A.8.15, A.8.16)
- [x] V8 Data protection — export, delete history, delete resumes, delete everything; retention via deletion (A.5.34; DPDP Act 2023)
- [x] V11 Business logic — caps, duplicate prevention, Emergency Stop, state-machine transitions
- [x] V12 Files — see T9
- [x] V14 Config — security headers (CSP nonce, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS on HTTPS); no `x-powered-by`; non-root, read-only, cap-dropped container; internal DB network; `npm audit` clean (A.8.9, A.8.20)
- [ ] Before production: external penetration test, SAST (Semgrep) + DAST (OWASP ZAP) in CI, Vault/KMS for `MASTER_KEY`, TLS reverse proxy, backups with restore drill

## Residual risks

- The single-instance in-memory rate limiter resets on restart. Use Redis when scaling out.
- `MASTER_KEY` in an env file is acceptable for a single laptop. Use a secrets manager (Vault Transit or a cloud KMS) for servers. The `KeyProvider` interface in `src/lib/crypto.ts` is the swap point.
- A small CPU model can misjudge relevance. The rule engine bounds the effect, and every application is approved by you.
