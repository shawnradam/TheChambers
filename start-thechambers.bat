@echo off
cd /d %~dp0
powershell -ExecutionPolicy Bypass -File "%~dp0start-thechambers.ps1" %*
pause
