@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
echo Leaf sentence analysis - local experiment
echo Start Ollama and install qwen3.5:9b first.
echo CPU mode is used. Close this window to stop the connection.
node scripts\ollama-bridge.mjs --cpu
if errorlevel 1 pause
