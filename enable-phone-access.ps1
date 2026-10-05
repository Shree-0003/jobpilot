# Makes JobPilot reachable from your phone over Tailscale (private network between your own devices).
# Nothing is exposed to the public internet: only devices signed in to YOUR Tailscale account can connect,
# and traffic is HTTPS end to end.
#
# Usage (PowerShell, in this folder):   powershell -ExecutionPolicy Bypass -File .\enable-phone-access.ps1
# To turn phone access off again:      powershell -ExecutionPolicy Bypass -File .\enable-phone-access.ps1 -Off
param([switch]$Off)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "`n[X] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Set-EnvValue([string]$key, [string]$value) {
  $lines = Get-Content ".env"
  if ($lines -match "^$key=") { $lines = $lines -replace "^$key=.*$", "$key=$value" } else { $lines += "$key=$value" }
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), (($lines -join "`n") + "`n"))
}

if (-not (Test-Path ".env")) { Fail ".env not found. Run start-jobpilot.ps1 first." }

$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts) { $p = "C:\Program Files\Tailscale\tailscale.exe"; if (Test-Path $p) { $ts = Get-Item $p } }

if ($Off) {
  if ($ts) { & $ts.Source serve reset 2>$null }
  Set-EnvValue "APP_ORIGIN" "http://localhost:3000"
  Set-EnvValue "COOKIE_SECURE" "false"
  docker compose up -d --build
  Ok "Phone access turned off. JobPilot is back to http://localhost:3000 only."
  exit 0
}

Step "Checking Tailscale"
if (-not $ts) {
  Write-Host "Tailscale is not installed. Installing it with winget..."
  winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  $p = "C:\Program Files\Tailscale\tailscale.exe"
  if (-not (Test-Path $p)) { Fail "Install did not finish. Install Tailscale from https://tailscale.com/download/windows and run this script again." }
  $ts = Get-Item $p
}
$tsExe = $ts.Source; if (-not $tsExe) { $tsExe = $ts.FullName }
Ok "Tailscale is installed"

$status = $null
try { $status = & $tsExe status --json | ConvertFrom-Json } catch {}
if (-not $status -or $status.BackendState -ne "Running") {
  Step "Sign in to Tailscale (a browser window opens - use Google, Microsoft or GitHub)"
  & $tsExe up
  $status = & $tsExe status --json | ConvertFrom-Json
  if ($status.BackendState -ne "Running") { Fail "Tailscale is not signed in. Open the Tailscale app from the system tray, sign in, then run this again." }
}
$dns = $status.Self.DNSName.TrimEnd(".")
if (-not $dns) { Fail "Could not read this computer's Tailscale name. Turn on MagicDNS at https://login.tailscale.com/admin/dns and run this again." }
Ok "This computer is $dns"

Step "Publishing JobPilot to your Tailscale devices only (HTTPS)"
& $tsExe serve --bg 3000
if ($LASTEXITCODE -ne 0) {
  Fail "Tailscale could not enable HTTPS. Open https://login.tailscale.com/admin/dns, turn on 'HTTPS Certificates', then run this again."
}
$url = "https://$dns"
Ok "Serving $url"

Step "Updating JobPilot settings for HTTPS"
Set-EnvValue "APP_ORIGIN" $url
Set-EnvValue "COOKIE_SECURE" "true"
Set-EnvValue "ALLOW_REGISTRATION" "false"   # your account exists; nobody else can sign up
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose failed. Copy the error above and send it to Claude." }

Write-Host ""
Ok "Done. Open this on your phone (and on this laptop from now on):"
Write-Host "    $url" -ForegroundColor Yellow
Write-Host @"

On your phone:
  1. Install the Tailscale app (App Store / Play Store) and sign in with the SAME account.
  2. Turn Tailscale on, then open the address above in your browser.
  3. Sign in to JobPilot with your password and authenticator code.

Your laptop must be on, awake and running Docker Desktop for the phone to reach it.
To stop phone access:  powershell -ExecutionPolicy Bypass -File .\enable-phone-access.ps1 -Off
"@
