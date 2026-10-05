# Starts JobPilot on Windows: checks Docker and Ollama, pulls the model, builds and runs the app.
# Usage (PowerShell, in this folder):   powershell -ExecutionPolicy Bypass -File .\start-jobpilot.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "`n[X] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not (Test-Path ".env")) { Fail ".env not found in $PSScriptRoot. Copy .env.example to .env and fill MASTER_KEY and MONGO_PASSWORD." }
$envText = Get-Content ".env" -Raw
foreach ($k in "MASTER_KEY", "MONGO_PASSWORD") {
  if ($envText -notmatch "(?m)^$k=\S+") { Fail "$k is empty in .env" }
}
$model = if ($envText -match "(?m)^OLLAMA_MODEL=(\S+)") { $Matches[1] } else { "qwen2.5:3b" }

Step "Checking Docker"
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker is not running. Start Docker Desktop, wait for 'Engine running', then run this again." }
Ok "Docker is running"

Step "Checking Ollama"
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { Fail "The 'ollama' command was not found. Reinstall Ollama or open a new PowerShell window." }
try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 | Out-Null }
catch {
  Write-Host "Ollama is not answering; starting it..."
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 5
  try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 | Out-Null } catch { Fail "Ollama did not start. Open the Ollama app from the Start menu and try again." }
}
Ok "Ollama is running"

$tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags"
if (-not ($tags.models | Where-Object { $_.name -eq $model -or $_.name -eq "$model`:latest" })) {
  Step "Downloading model $model (about 2 GB, one time)"
  ollama pull $model
  if ($LASTEXITCODE -ne 0) { Fail "Model download failed. Check your internet connection and run: ollama pull $model" }
}
Ok "Model $model is ready"

Step "Building and starting JobPilot (first build takes 5-10 minutes)"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose failed. Copy the error above and send it to Claude." }

Step "Waiting for the app"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod -Uri "http://localhost:3000/api/auth/me" -TimeoutSec 3 | Out-Null; $ready = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { Fail "The app did not respond. Run: docker compose logs app --tail 50   and send the output to Claude." }

Ok "JobPilot is running at http://localhost:3000"
Start-Process "http://localhost:3000"
Write-Host "`nStop it any time with:  docker compose down   (your data is kept)"
