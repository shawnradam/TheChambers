param(
  [string]$Workspace = $env:USERPROFILE,
  [int]$Port = 3002,
  [switch]$Local
)

# Windows wrapper. Everything else lives in bin/thechambers.mjs, so Windows, macOS and Linux
# resolve Tailscale, check the port, bootstrap the password and print the same URLs.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not on PATH. TheChambers needs Node 22 or newer." -ForegroundColor Red
  exit 1
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) {
  Write-Host "Node 22 or newer is required (found $(node -v))." -ForegroundColor Red
  exit 1
}

$launcherArgs = @('--port', "$Port", '--workspace', $Workspace)
if ($Local) { $launcherArgs += '--local' }

node "$here\bin\thechambers.mjs" @launcherArgs
