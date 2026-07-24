@echo off
REM Stops the dev server and the bundled Postgres container.
cd /d "%~dp0"
title AAA Ski Platform - stop

echo Stopping any dev server on ports 3000-3010...
for /L %%p in (3000,1,3010) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>nul
  )
)

echo Stopping the Postgres container (if running)...
docker compose stop postgres >nul 2>nul

echo Done.
timeout /t 2 >nul
