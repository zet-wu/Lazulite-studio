@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0app"
"%~dp0runtime\python\python.exe" -E -s -m server.portable --root "%~dp0." %*
set "STUDIO_EXIT=%ERRORLEVEL%"
if not "%STUDIO_EXIT%"=="0" pause
exit /b %STUDIO_EXIT%
