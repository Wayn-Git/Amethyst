@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo               PSOK Launcher ^& Manager
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
    echo [PSOK] Creating virtual environment (.venv)...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

:: 4. Install Dependencies
python -c "import fastapi, uvicorn, pydantic, mcp, yaml, backend" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [PSOK] Installing Python dependencies from requirements.txt...
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
)

:: 5. Create .env if missing
if not exist ".env" (
    echo [PSOK] Creating initial .env from .env.example...
    copy .env.example .env >nul
)

:: 6. Initialize DB
echo [PSOK] Initializing PSOK...
python -m backend.cli init

:: 7. Build Frontend if missing
if not exist "frontend\node_modules" (
    echo [PSOK] Installing frontend dependencies...
    cd frontend && call npm install && cd ..
)

if not exist "frontend\dist\index.html" (
    echo [PSOK] Building frontend web app...
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
    echo [PSOK] Running diagnostics:
    python -m backend.cli doctor
    pause
    exit /b 0
)

echo [PSOK] Starting PSOK on http://127.0.0.1:8000 ...
python -m backend.cli serve --open %*

pause
