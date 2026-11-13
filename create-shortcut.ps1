# Creates a shortcut that starts TheChambers with one double-click.
#
# Run once: powershell -ExecutionPolicy Bypass -File .\create-shortcut.ps1

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcutPath = Join-Path $here 'TheChambers.lnk'

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $here 'start-thechambers.bat'
$shortcut.WorkingDirectory = $here
$shortcut.Description = 'Start TheChambers (Command Code from your phone)'

$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $tailscale) {
  $shortcut.IconLocation = "$tailscale, 0"
}

$shortcut.Save()
Write-Host "Shortcut created: $shortcutPath"
