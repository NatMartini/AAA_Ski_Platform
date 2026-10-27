@echo off
REM Stops only the dev server recorded by this project's launcher.
cd /d "%~dp0"
title AAA Ski Platform - stop

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-dev.ps1"
if errorlevel 1 exit /b 1

echo Done.
timeout /t 2 >nul
