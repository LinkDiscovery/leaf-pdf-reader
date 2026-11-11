@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13+ or 24+ is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Building Leaf PDF Reader...
  call npm.cmd install
  if errorlevel 1 goto failure
  call npm.cmd run build
  if errorlevel 1 goto failure
)
node scripts\launch.mjs
if errorlevel 1 goto failure
exit /b 0
:failure
echo Could not start Leaf PDF Reader.
pause
exit /b 1
