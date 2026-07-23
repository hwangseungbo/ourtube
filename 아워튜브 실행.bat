@echo off
title OurTube Local Server
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 goto missing_node

echo Starting OurTube at http://127.0.0.1:4545
echo Press Ctrl+C to stop the server.
echo.

if /i "%~1"=="--no-browser" goto run_server
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4545'"

:run_server
node.exe server.mjs
goto finished

:missing_node
echo Node.js is not installed or is not available in PATH.

:finished
echo.
echo The server has stopped.
pause
