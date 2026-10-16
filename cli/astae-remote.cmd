@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo [ASTAE] Node.js 20 or later is required: https://nodejs.org/
  exit /b 1
)
node "%~dp0bin\astae-remote.mjs" remote %*
exit /b %errorlevel%
