@echo off
setlocal
"%~dp0runtime\python\python.exe" -I -X utf8 "%~dp0download_vocal_models.py"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
