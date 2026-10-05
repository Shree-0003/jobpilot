# API reference

All endpoints are JSON under `/api`, same-origin only. The rules below apply to every endpoint.

- **Auth levels:** `none` (public); `pre-mfa` (password verified, MFA pending); `full` (password + MFA).
- **CSRF:** every POST, PUT, PATCH or DELETE needs an `Origin` header matching the app, plus an `x-csrf-token` header equal to the `jp_csrf` cookie.
- **Errors:** `{ "error": "...", "fields"?: [{ "path", "message" }] }` with status 400, 401, 403, 404, 409, 412, 413, 422, 429 or 500. Internals are never echoed.
- **Caching:** responses carry `Cache-Control: no-store`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/auth/me` | none | Session state; whether registration is open |
| POST | `/auth/register` | none | Create the single owner account `{email, password}` |
| POST | `/auth/login` | none | Password step `{email, password}`; then MFA |
| GET | `/auth/mfa/setup` | pre-mfa | TOTP enrolment QR + secret (until enrolled) |
| POST | `/auth/mfa/verify` | pre-mfa | `{code}` TOTP or recovery code; returns recovery codes on enrolment |
| POST | `/auth/logout` · `/auth/logout-all` | pre-mfa · full | End this / every session |
| GET, PUT | `/profile` | full | Personal (encrypted) and role details |
| GET, POST | `/facts` | full | List or add verified facts `{category, label, value?, valueNumeric?, unit?}` |
| PUT, DELETE | `/facts/{F001}` | full | Edit (new version) or delete a fact |
| POST | `/facts/{F001}/verify` | full | Approve an AI-proposed fact |
| GET, PUT | `/prefs` | full | Preferences, limits, career boards, notifications |
| GET, POST | `/automation` | full | Get state or set `{state: running|paused|stopped}` (Emergency Stop) |
| POST | `/auto-apply` | full | `{enabled, password}` — re-auth required to enable |
| GET, POST | `/resumes` | full | List; upload (multipart `file`, `label`, `focusKeywords`) |
| PATCH, DELETE | `/resumes/{id}` | full | Approve, relabel, delete |
| GET | `/resumes/{id}/download` | full | Decrypted file as attachment |
| GET, POST | `/jobs` | full | List (`?status=`); add a pasted job (scored immediately) |
| GET, PATCH | `/jobs/{id}` | full | Job + latest evaluation + policy rules; replace description and re-score |
| POST | `/jobs/{id}/evaluate` · `/approve` · `/dismiss` | full | Re-score; approve `{resumeId?, acknowledgeRisk?}` → application; dismiss |
| POST | `/discovery/alert-email` | full | `{text}` — parse a LinkedIn/Naukri alert email |
| POST | `/discovery/gmail` | full | Sync alert emails via the Gmail MCP server |
| POST | `/discovery/boards` | full | Sync configured Greenhouse/Lever public boards |
| GET | `/discovery/status` | full | Ollama health, MCP configured, connector ToS register |
| GET | `/applications` | full | Register |
| GET, PATCH | `/applications/{id}` | full | Detail with decrypted answers, notes, history; update status, notes, follow-up, hiring status |
| POST | `/applications/{id}/questions` | full | `{questions: string[]}` → drafted answers with fact citations |
| PATCH, DELETE | `/applications/{id}/questions/{qid}` | full | `{answer, approve}` / remove |
| POST, PUT | `/applications/{id}/cover-letter` | full | Generate `{tone}` / save edited `{text}` (re-validated) |
| GET | `/action-required` | full | Manual queue: apps to submit or retry, jobs needing a decision |
| GET | `/dashboard` | full | Today, statistics, recent applications |
| GET | `/audit` · `/audit/verify` | full | Paged audit log · hash-chain verification |
| GET | `/export?type=applications|audit&format=csv|xlsx` | full | Export (formula-injection safe) |
| GET | `/security/events` | full | Security events, sessions, AI gateway log |
| GET, POST | `/notifications` | full | List · mark read `{ids}` or `{all: true}` |
| POST | `/account/export` | full | `{password}` → full JSON export |
| POST | `/account/delete` | full | `{password, confirm: "DELETE", scope: history|resumes|everything}` |

## AI output contracts

The LLM can return only these shapes (validated with zod; unknown keys are rejected):

```json
{ "match_score": 87, "sub_scores": {"skills": 92, "experience": 88, "location": 100, "industry": 90, "education": 80},
  "strong_matches": [{"requirement": "ISO 27001", "fact_ids": ["F001"]}],
  "not_found_in_profile": ["CISSP"], "user_lacks": [{"requirement": "5+ years", "fact_ids": ["F002"]}],
  "risk_flags": ["REQUIRES_MORE_EXPERIENCE"], "recommendation": "USER_APPROVAL", "reason": "..." }
```

```json
{ "answer": "…", "fact_ids": ["F004"], "confidence": 0.85, "cannot_answer": false }
```
