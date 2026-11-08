@echo off
setlocal
"%~dp0runtime\python\python.exe" -I -X utf8 "%~dp0download_models.py"
pause
