@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0app"
"%~dp0runtime\python\python.exe" -E -s -m server.portable --root "%~dp0."
if errorlevel 1 pause
endlocal
