@echo off
cd /d "%~dp0"
echo Installing Claude Code Usage Overlay...
echo.
call npm install
echo.
echo Done! Double-click start.bat to launch the overlay.
pause
