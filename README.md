# JobPilot — secure, human-controlled AI job application assistant

JobPilot helps you find relevant jobs, scores them against **only your verified facts**, prepares every
application (resume choice, answers, cover letter) and keeps a complete, tamper-evident register.
**You** submit on LinkedIn and Naukri: their terms forbid bots, so JobPilot never logs in to or scrapes them.

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + Tailwind CSS 4 (Next.js App Router pages) |
| Backend | Next.js 15 route handlers (TypeScript) |
| Database | MongoDB 7 (official driver; works with any MongoDB-wire-compatible server) |
| LLM | Ollama, local (default `qwen2.5:3b` for CPU), behind a provider-neutral AI Gateway |
| Mail discovery | Any open-source Gmail MCP server over stdio (read/search tools only) |
| Tests | Vitest (unit/integration) + Playwright (end-to-end and security) |

## Deploy anywhere

- **Windows:** `powershell -ExecutionPolicy Bypass -File .\start-jobpilot.ps1`
- **Linux / macOS / cloud VM:** `git clone … && cd jobpilot && ./setup.sh` (add `--bundled` to run Ollama in Docker, `--gpu` for NVIDIA)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for servers, HTTPS and backups.

## Quick start on Windows

With Docker Desktop and Ollama installed: copy `.env.example` to `.env`, set `MASTER_KEY` and `MONGO_PASSWORD`, then run
`powershell -ExecutionPolicy Bypass -File .\start-jobpilot.ps1`. It checks Docker and Ollama, downloads the model
if needed, builds and starts the app and opens http://localhost:3000.

## Automatic job discovery

JobPilot looks for jobs on its own every 4 hours (and when you click **Find jobs now** on the Dashboard):

- **Gmail alerts** - your LinkedIn and Naukri job-alert emails, read-only over IMAP with a Google app password.
- **Adzuna India** - official job-search API (free key) for your target roles.
- **Career boards** - Greenhouse / Lever companies you add in Preferences.

Turn them on with `powershell -ExecutionPolicy Bypass -File .\set-job-sources.ps1`. New relevant jobs are scored and land in
**Jobs -> Awaiting Approval**, with a notification. Alert emails carry only titles, so those jobs are marked *title only* until you paste
the description.

## Access from your phone (Tailscale)

`powershell -ExecutionPolicy Bypass -File .\enable-phone-access.ps1` installs Tailscale if needed, publishes
JobPilot over HTTPS to **your own Tailscale devices only** (`tailscale serve`, not Funnel), and switches the app to secure
cookies. Install the Tailscale app on your phone, sign in with the same account and open the `https://<pc>.<tailnet>.ts.net`
address it prints. Turn it off with `-Off`. The laptop must be on and running Docker Desktop.

## Quick start (Docker, any OS)

```bash
cp .env.example .env
# fill in:  MASTER_KEY=$(openssl rand -base64 32)   MONGO_PASSWORD=$(openssl rand -base64 24)
docker compose up -d --build          # uses the Ollama installed on your computer
open http://localhost:3000            # create your account, then scan the MFA QR code
```

Only port 3000 is published, and only on `127.0.0.1`. MongoDB sits on an internal network with no
internet access. By default the app uses the Ollama on your computer (`host.docker.internal`); to run Ollama
in Docker instead, set `OLLAMA_URL=http://ollama:11434` and use `docker compose --profile bundled-ollama up -d --build`.

### Choosing an Ollama model (CPU only)

| Model | RAM | Speed on a laptop CPU | Notes |
| --- | --- | --- | --- |
| `qwen2.5:3b` (default) | ~3 GB | 20–60 s per job | Best JSON reliability at this size |
| `llama3.2:3b` | ~3 GB | similar | Good alternative |
| `qwen2.5:1.5b` | ~1.5 GB | 2–3× faster | Weaker scoring; the rule engine still guards it |

Set `OLLAMA_MODEL` in `.env`, then run `ollama pull <model>` (or re-run the start script). If Ollama is slow or
offline, JobPilot still works: scores fall back to the deterministic rules and every answer comes back
to you for review.

## Local development (without Docker)

```bash
npm ci
cp .env.example .env.local      # point MONGODB_URI at a local MongoDB, set MASTER_KEY
ollama serve & ollama pull qwen2.5:3b     # or: npm run mock:ollama  (offline mock)
npm run dev                      # http://localhost:3000
```

## Gmail job alerts through MCP

JobPilot reads the LinkedIn/Naukri **alert emails you already receive**. It runs your chosen
open-source Gmail MCP server as a child process and calls only two tools:

```env
MCP_GMAIL_COMMAND=npx
MCP_GMAIL_ARGS=-y <your-gmail-mcp-package>
MCP_GMAIL_SEARCH_TOOL=search_emails      # tool names as your server defines them
MCP_GMAIL_READ_TOOL=read_email
MCP_GMAIL_QUERY=from:(jobalerts-noreply@linkedin.com OR naukri.com) newer_than:7d
```

Guardrails: it refuses any tool name that looks like a write (send, modify, delete, trash, draft, label…).
The child gets a minimal environment (no `MASTER_KEY`, no DB URI). The MCP output is treated as
untrusted text, and the LLM never sees or calls MCP tools. Authorise the server with the narrowest
Gmail scope it supports (`gmail.readonly`). You can also paste an alert email under **Jobs → Import alert email**.

## How a job flows

1. **Discover** — paste a job, import an alert email, sync Gmail (MCP), or sync public Greenhouse/Lever boards.
2. **Sanitise** — HTML/scripts, invisible characters and over-long text are stripped. Prompt-injection and scam patterns are flagged.
3. **Score** — deterministic rules (skills, certifications, years, location, salary, contract, exclusions) plus Ollama's semantic score. Numbers are always decided by code.
4. **Guardrails** — the LLM's JSON is schema-checked. Uncited claims and unknown fact IDs are dropped, and anything without a contradicting fact is listed as *not found*, never *lacking*.
5. **Policy engine** — pure code decides: Skip / Low relevance / Manual / Your approval. LinkedIn and Naukri are capped at *human submit*. The AI can make a decision stricter, never looser.
6. **Approve** — caps, duplicate check, Emergency Stop and resume choice are checked again. An Apply Pack is then created.
7. **Apply Pack** — job link, resume download, answers drafted only from verified facts (salary, notice period, relocation, visa and personal questions always come to you), and a cover letter checked for unverified claims.
8. **Submit yourself → Mark as applied** — or mark it failed (CAPTCHA, OTP, external site). Every step is in the hash-chained audit log.

## Tests

```bash
npm test                          # 106 unit + integration tests (Vitest)
npm run e2e:server && npx playwright test   # 39 browser tests: 27 feature + 12 security
```

The e2e server script needs a MongoDB-compatible server on `127.0.0.1:27017` and Ollama (or
`npm run mock:ollama`) on `:11434`. The mock deliberately hallucinates on the keyword `MOCK_HALLUCINATE`
so the guardrails can be tested.

## Docs

- [docs/SECURITY.md](docs/SECURITY.md) — threat model, controls, security checklist, test coverage
- [docs/API.md](docs/API.md) — API reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hardening, HTTPS, backups, key rotation, limitations

> Not legal advice: portal terms change. Each connector carries a review date (Data & Integrations page);
> re-check terms before enabling anything new.
