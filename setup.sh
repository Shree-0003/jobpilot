#!/usr/bin/env bash
# JobPilot setup for Linux / macOS / any Docker host.
#   ./setup.sh                 # interactive: creates .env with fresh secrets, picks Ollama mode, starts everything
#   ./setup.sh --bundled       # always run Ollama inside Docker (servers, cloud VMs)
#   ./setup.sh --host-ollama   # use an Ollama already installed on this machine
#   ./setup.sh --gpu           # bundled Ollama with an NVIDIA GPU (needs nvidia-container-toolkit)
#   ./setup.sh --origin https://jobs.example.com   # public HTTPS address (behind your reverse proxy)
set -euo pipefail
cd "$(dirname "$0")"

MODE="" ; GPU=0 ; ORIGIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundled) MODE=bundled ;;
    --host-ollama) MODE=host ;;
    --gpu) MODE=bundled; GPU=1 ;;
    --origin) ORIGIN="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

say() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()  { printf '\033[32m[OK]\033[0m %s\n' "$1"; }
die() { printf '\033[31m[X]\033[0m %s\n' "$1"; exit 1; }

command -v docker >/dev/null || die "Docker is not installed: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "Docker is not running (or you need sudo / the docker group)."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)."

set_env() { # key value
  if grep -q "^$1=" .env; then
    python3 - "$1" "$2" <<'PY' 2>/dev/null || sed -i.bak "s|^$1=.*|$1=$2|" .env
import sys,re
k,v=sys.argv[1],sys.argv[2]
s=open(".env").read()
s=re.sub(rf"(?m)^{re.escape(k)}=.*$", lambda m: f"{k}={v}", s)
open(".env","w").write(s)
PY
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
rand() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

say "Configuration"
if [ ! -f .env ]; then
  cp .env.example .env
  set_env MASTER_KEY "$(rand 32)"
  set_env MONGO_PASSWORD "$(rand 24 | tr -d '/+=')"
  set_env NODE_ENV production
  set_env OLLAMA_TIMEOUT_MS 180000
  ok "Created .env with new secrets (back up MASTER_KEY - without it your data cannot be decrypted)"
else
  ok "Using existing .env"
fi

if [ -n "$ORIGIN" ]; then
  set_env APP_ORIGIN "$ORIGIN"
  case "$ORIGIN" in https://*) set_env COOKIE_SECURE true ;; esac
  ok "App address: $ORIGIN"
fi

if [ -z "$MODE" ]; then
  if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then MODE=host; else MODE=bundled; fi
fi
MODEL="$(grep -E '^OLLAMA_MODEL=' .env | cut -d= -f2)"; MODEL="${MODEL:-qwen2.5:3b}"

if [ "$MODE" = host ]; then
  set_env OLLAMA_URL "http://host.docker.internal:11434"
  set_env COMPOSE_PROFILES ""
  ok "Using the Ollama installed on this machine"
  if command -v ollama >/dev/null; then
    ollama list 2>/dev/null | grep -q "^${MODEL%%:*}" || { say "Downloading model $MODEL"; ollama pull "$MODEL"; }
  fi
  if [ "$(uname)" = Linux ]; then
    echo "   Note (Linux): Ollama must listen on the Docker bridge. If AI shows 'unavailable', run:"
    echo "   sudo systemctl edit ollama  ->  [Service] Environment=\"OLLAMA_HOST=0.0.0.0\"  then: sudo systemctl restart ollama"
  fi
else
  set_env OLLAMA_URL "http://ollama:11434"
  set_env COMPOSE_PROFILES "bundled-ollama"
  ok "Ollama will run inside Docker (model $MODEL is downloaded on first start, about 2 GB)"
fi

FILES=(-f docker-compose.yml)
if [ "$GPU" = 1 ]; then FILES+=(-f docker-compose.gpu.yml); ok "NVIDIA GPU enabled for Ollama"; fi

say "Building and starting (first build takes a few minutes)"
docker compose "${FILES[@]}" up -d --build

say "Waiting for the app"
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/auth/me >/dev/null 2>&1; then
    ok "JobPilot is running at $(grep -E '^APP_ORIGIN=' .env | cut -d= -f2)"
    echo "   Create your account, scan the MFA QR code, then set up job sources (README -> Automatic job discovery)."
    exit 0
  fi
  sleep 2
done
die "The app did not respond. Check: docker compose logs app --tail 50"
