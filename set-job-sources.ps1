# Turns on JobPilot's automatic job sources. Asks for each value; press Enter to skip one.
#   - Gmail alerts: your Gmail address + a Google app password (read-only access to your LinkedIn / Naukri alert emails)
#   - Adzuna India: free API App ID + App Key from https://developer.adzuna.com/
# Values are written to .env on this laptop only, then the app restarts.
# Usage (PowerShell, in this folder):   powershell -ExecutionPolicy Bypass -File .\set-job-sources.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
if (-not (Test-Path ".env")) { Write-Host ".env not found. Run start-jobpilot.ps1 first." -ForegroundColor Red; exit 1 }

function Set-EnvValue([string]$key, [string]$value) {
  $lines = @(Get-Content ".env")
  if ($lines -match "^$key=") { $lines = $lines -replace "^$key=.*$", "$key=$value" } else { $lines += "$key=$value" }
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), (($lines -join "`n") + "`n"))
}
function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }

Write-Host "`n== Gmail job alerts ==" -ForegroundColor Cyan
Write-Host "Create an app password at https://myaccount.google.com/apppasswords (needs 2-Step Verification on)."
Write-Host "Name it 'JobPilot'. Google shows 16 letters - paste them below."
$gUser = Read-Host "Gmail address (Enter to skip)"
if ($gUser) {
  $gPass = (Plain (Read-Host "App password (16 letters)" -AsSecureString)) -replace "\s", ""
  if ($gPass.Length -ne 16) { Write-Host "That doesn't look like a 16-letter app password - Gmail skipped." -ForegroundColor Yellow }
  else { Set-EnvValue "GMAIL_IMAP_USER" $gUser; Set-EnvValue "GMAIL_IMAP_APP_PASSWORD" $gPass; Write-Host "[OK] Gmail alerts on" -ForegroundColor Green }
}

Write-Host "`n== Adzuna India job search ==" -ForegroundColor Cyan
Write-Host "Register free at https://developer.adzuna.com/signup, then copy the App ID and App Key from your dashboard."
$aId = Read-Host "Adzuna App ID (Enter to skip)"
if ($aId) {
  $aKey = Plain (Read-Host "Adzuna App Key" -AsSecureString)
  if ($aKey) { Set-EnvValue "ADZUNA_APP_ID" $aId.Trim(); Set-EnvValue "ADZUNA_APP_KEY" $aKey.Trim(); Write-Host "[OK] Adzuna on" -ForegroundColor Green }
}

Write-Host "`nRestarting JobPilot with the new settings..." -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "docker compose failed - send the error above to Claude." -ForegroundColor Red; exit 1 }
Write-Host "`n[OK] Done. Open JobPilot > Dashboard and click 'Find jobs now'. It then runs automatically every 4 hours." -ForegroundColor Green
