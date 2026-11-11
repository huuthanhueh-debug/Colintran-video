@echo off
rem Double-click to start PromptGate Video and open it in your browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Can Node.js 18+ / Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
node server.js --open
pause
