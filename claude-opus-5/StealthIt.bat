@echo off
REM StealthIt launcher. Uses pythonw so no console window appears alongside
REM the overlay -- a visible terminal would defeat the point.
setlocal
cd /d "%~dp0"

where pythonw >nul 2>nul
if errorlevel 1 (
    echo Python was not found on PATH. Install Python 3.10+ and try again.
    pause
    exit /b 1
)

start "" pythonw -m stealthit
endlocal
