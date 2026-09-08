@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo               AMETHYST Launcher ^& Manager
echo ======================================================

:: 1. Check Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python 3.11+ is required but was not found in PATH.
    echo Please install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 2. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is required for the web frontend.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: 3. Setup Virtual Environment
if not exist ".venv" (
    echo [AMETHYST] Creating virtual environment (.venv)...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

:: 4. Install Dependencies
python -c "import fastapi, uvicorn, pydantic, mcp, yaml, backend" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [AMETHYST] Installing Python dependencies from requirements.txt...
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
)

:: 5. Create .env if missing
if not exist ".env" (
    echo [AMETHYST] Creating initial .env from .env.example...
    copy .env.example .env >nul
)

:: 6. Initialize DB
echo [AMETHYST] Initializing AMETHYST...
python -m backend.cli init

:: 7. Build Frontend if missing
if not exist "frontend\node_modules" (
    echo [AMETHYST] Installing frontend dependencies...
    cd frontend && call npm install && cd ..
)

if not exist "frontend\dist\index.html" (
    echo [AMETHYST] Building frontend web app...
    cd frontend && call npm run build && cd ..
)

:: 8. Check flags or run server
if "%1"=="--setup" goto :setup
if "%1"=="--config" goto :setup
goto :check_doctor

:setup
python scripts\setup_wizard.py
pause
exit /b 0

:check_doctor

if "%1"=="--doctor" (
    echo [AMETHYST] Running diagnostics:
    python -m backend.cli doctor
    pause
    exit /b 0
)

echo [AMETHYST] Starting AMETHYST on http://127.0.0.1:8000 ...
python -m backend.cli serve --open %*

pause
