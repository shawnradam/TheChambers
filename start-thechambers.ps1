param(
  [string]$Workspace = $env:USERPROFILE,
  [int]$Port = 3002,
  [switch]$Local
)

# Starts TheChambers: a password-gated web chat for Command Code, reachable from a phone over
# Tailscale. Binds the Tailscale address (and loopback), never the LAN and never the internet.
#
# Port 3002: 3000 is the roadbike dev server, 3001 is prior art.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not on PATH. TheChambers needs Node 22 or newer." -ForegroundColor Red
  exit 1
}

# The password lives in a file rather than in this script: a password typed into a .ps1 is a
# password in every screenshot, backup and clipboard of this folder.
$configDir = Join-Path $env:USERPROFILE '.config\thechambers'
$passwordFile = Join-Path $configDir 'ui-password.txt'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (-not (Test-Path $passwordFile) -or -not (Get-Content $passwordFile -Raw).Trim()) {
  $generated = (node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))").Trim()
  Set-Content -Path $passwordFile -Value $generated -NoNewline
  Write-Host "Generated a password at $passwordFile"
}

if ((Get-Content $passwordFile -Raw).Trim().Length -lt 16) {
  Write-Host "The password in $passwordFile is shorter than 16 characters. Fix it and run again." -ForegroundColor Red
  exit 1
}

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $owner = (Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Host "Port $Port is already in use by $owner (pid $($busy.OwningProcess))." -ForegroundColor Red
  Write-Host "Close it, or run: .\start-thechambers.ps1 -Port 3003" -ForegroundColor Yellow
  exit 1
}

$hostAddress = '127.0.0.1'
if (-not $Local) {
  $tailscaleIp = $null
  if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    $tailscaleIp = (tailscale ip -4 2>$null | Select-Object -First 1)
  }
  if (-not $tailscaleIp) {
    Write-Host "Tailscale is not running, so the phone will not reach this." -ForegroundColor Red
    Write-Host "Start Tailscale and try again, or use -Local for this desktop only." -ForegroundColor Yellow
    exit 1
  }
  $hostAddress = $tailscaleIp.Trim()
}

$env:THECHAMBERS_HOST = $hostAddress
$env:THECHAMBERS_PORT = "$Port"
$env:THECHAMBERS_WORKSPACE = (Resolve-Path $Workspace).Path

Write-Host ""
Write-Host "Open on the phone:  http://${hostAddress}:$Port" -ForegroundColor Green
if ($hostAddress -ne '127.0.0.1') {
  Write-Host "Open on this desktop: http://127.0.0.1:$Port"
}
Write-Host "Password file:      $passwordFile"
Write-Host "Workspace:          $($env:THECHAMBERS_WORKSPACE)"
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

node "$here\server.mjs"
