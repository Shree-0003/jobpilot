# Deployment

JobPilot runs anywhere Docker Compose v2 runs: Windows, macOS, Linux laptops, or a cloud VM (AWS, Azure, GCP, DigitalOcean…).

| Where | Command | Ollama |
| --- | --- | --- |
| Windows laptop | `powershell -ExecutionPolicy Bypass -File .\start-jobpilot.ps1` | Ollama installed on Windows |
| Linux / macOS | `./setup.sh` | Uses an installed Ollama if one is running, otherwise runs it in Docker |
| Server / cloud VM (CPU) | `./setup.sh --bundled --origin https://jobs.example.com` | Inside Docker |
| Server with NVIDIA GPU | `./setup.sh --gpu --origin https://jobs.example.com` | Inside Docker, on the GPU |

Requirements: Docker + Compose v2, 4 GB RAM minimum (8 GB recommended for the 3B model), about 5 GB of disk.
MongoDB 7 needs a CPU with AVX; on very old CPUs set `image: mongo:4.4` in docker-compose.yml.
On a server keep `APP_BIND=127.0.0.1` and put a TLS reverse proxy (Caddy or nginx) in front, or use Tailscale.


## Laptop (recommended for the MVP)

`docker compose up -d --build` (see README). Data lives in three named volumes: `mongo`, `ollama` and
`resumes`. The app is published on `127.0.0.1:3000` only.

## Server behind HTTPS

1. Put a TLS reverse proxy (Caddy or nginx, TLS 1.2+) in front of the `app` service. Do not publish port 3000 publicly.
2. Set `APP_ORIGIN=https://jobs.example.com` and `COOKIE_SECURE=true`. This turns on the `Secure` flag, the `__Host-` cookie prefix, HSTS and `upgrade-insecure-requests`.
3. Set `ALLOW_REGISTRATION=false` once your account exists.
4. Load `MASTER_KEY` and `MONGO_PASSWORD` from a secrets manager, not a file in the repo. For Vault Transit or a cloud KMS, implement `KeyProvider` (`src/lib/crypto.ts`).
5. Optional: run ClamAV (`clamav/clamav` image) and set `CLAMAV_HOST=clamav:3310`.

## Backups and restore

- `docker compose exec mongo mongodump --archive --gzip -u jobpilot -p "$MONGO_PASSWORD" --authenticationDatabase admin > backup.gz`
- Back up the `resumes` volume too. Files are encrypted, so a backup is useless without `MASTER_KEY`. Store the key separately.
- Restore drill: `mongorestore --archive --gzip --drop`, then open the Audit Log and click **Verify integrity**.

## Key rotation

- **Sessions:** "Sign out all sessions" on the Security page.
- **MASTER_KEY:** re-wrap every user's `wrappedDek` with the new key (one pass over `users`); data does not need re-encrypting. Then retire the old key.
- **MFA:** delete your account data or reset `mfaEnabled` in the database to re-enrol (single-user MVP).

## CI suggestions

`npm ci && npx tsc --noEmit && npm test && npm audit --omit=dev`, plus Semgrep (SAST), Trivy (image scan),
OWASP ZAP baseline against a staging instance (DAST), and the Playwright suite.

## Known limitations

- LinkedIn and Naukri: discovery comes from alert emails and pasted text only, and you submit yourself (by design, per their terms).
- The email-to-recruiter Auto Apply channel is modelled in the policy engine but its sender is not built yet.
- Resume text is not parsed. Resume choice uses your label and focus keywords.
- Single user. Multi-tenant use needs per-tenant rate limiting (Redis) and an admin role.
