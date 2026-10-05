# Publishes this folder to a new GitHub repository in one go.
# Usage (PowerShell, in this folder):
#   powershell -ExecutionPolicy Bypass -File .\publish-to-github.ps1 -User <your-github-username>
# Optional: -Repo jobpilot  -Private
param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = "jobpilot",
  [switch]$Private
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m) { Write-Host "`n[X] $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git is not installed. Installing Git for Windows with winget..."
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git install did not finish. Open a new PowerShell window and run this again." }
}
Ok "Git is installed"

# CI workflow: move it into .github/workflows (Claude's file tools may not write there)
if (Test-Path "ci\github-ci.yml") {
  New-Item -ItemType Directory -Force -Path ".github\workflows" | Out-Null
  Move-Item -Force "ci\github-ci.yml" ".github\workflows\ci.yml"
  if (-not (Get-ChildItem "ci" -Force | Select-Object -First 1)) { Remove-Item "ci" }
  Ok "CI workflow placed in .github\workflows\ci.yml"
}

# Safety check: secrets and personal files must never be committed
foreach ($p in ".env", "scripts\import-resume.js") {
  if (Test-Path $p) {
    $ignored = git check-ignore -q $p 2>$null; if ($LASTEXITCODE -ne 0 -and (Test-Path ".git")) { Fail "$p is not ignored by .gitignore - stopping." }
  }
}

if (-not (Test-Path ".git")) { git init -q -b main; Ok "Created local repository" }
# Use GitHub's private no-reply address so your work email is not published
$noreply = "$User@users.noreply.github.com"
git config user.name $User
git config user.email $noreply
git add -A
foreach ($p in ".env", "scripts/import-resume.js") {
  if (git ls-files --cached -- $p) { Fail "$p would be uploaded - stopping. Send this message to Claude." }
}
$count = (git ls-files --cached | Measure-Object).Count
if (-not (git log -1 2>$null)) { git commit -q -m "Initial commit: JobPilot - secure, human-controlled AI job application assistant" } else { git commit -q -m "Update" 2>$null }
Ok "Committed $count files (no .env, no personal data)"

$visibility = if ($Private) { "private" } else { "public" }
Write-Host "`nA browser opens GitHub's 'Create a new repository' page, pre-filled with '$Repo' ($visibility)." -ForegroundColor Yellow
Write-Host "Click the green 'Create repository' button, then come back here and press Enter." -ForegroundColor Yellow
Start-Process "https://github.com/new?name=$Repo&visibility=$visibility&description=Secure%2C+human-controlled+AI+job+application+assistant"
Read-Host "Press Enter after you've created the repository"

$url = "https://github.com/$User/$Repo.git"
if (git remote 2>$null | Select-String -Quiet "^origin$") { git remote set-url origin $url } else { git remote add origin $url }
Write-Host "Pushing... if a GitHub sign-in window appears, sign in and approve." -ForegroundColor Yellow
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail "Push failed. Check the repository exists at https://github.com/$User/$Repo and try again." }
Ok "Published: https://github.com/$User/$Repo"
Start-Process "https://github.com/$User/$Repo"
