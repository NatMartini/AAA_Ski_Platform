@echo off
REM One-click launcher for AAA Ski Platform. Double-click this file.
REM It brings up the database, applies migrations, seeds demo data and starts
REM the dev server, then opens the browser. No account login needed.

cd /d "%~dp0"
title AAA Ski Platform

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on your PATH. Install Node 20.9 or newer first.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first time...
  call npm install
)

node scripts\launch.mjs

echo.
echo The dev server has stopped.
pause
