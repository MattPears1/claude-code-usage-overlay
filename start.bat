@echo off
cd /d "%~dp0"
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    echo.
)
echo Starting Claude Code Usage Overlay...
npx electron .
