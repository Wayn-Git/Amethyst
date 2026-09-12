#!/usr/bin/env bash
# ==============================================================================
# AMETHYST - Personal Operating System Startup Script
# ==============================================================================
# Usage:
#   ./run.sh          # Default: builds frontend & runs unified server (opens browser)
#   ./run.sh --dev    # Development mode: runs backend & Vite dev server with hot reload
#   ./run.sh --doctor # Runs AMETHYST doctor diagnostic check
#   ./run.sh --build  # Rebuilds the frontend bundle
#   ./run.sh --help   # Displays usage information
# ==============================================================================

set -e

# ANSI Color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

info() {
    echo -e "${CYAN}${BOLD}[AMETHYST]${RESET} $1"
}

success() {
    echo -e "${GREEN}${BOLD}[AMETHYST]${RESET} $1"
}

warn() {
    echo -e "${YELLOW}${BOLD}[AMETHYST]${RESET} $1"
}

error() {
    echo -e "${RED}${BOLD}[ERROR]${RESET} $1" >&2
}

# Change to repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

show_help() {
    echo -e "${BOLD}AMETHYST - Personal Operating System${RESET}"
    echo ""
    echo "Usage:"
    echo "  ./run.sh [OPTION]"
    echo ""
    echo "Options:"
    echo "  (none)        Builds frontend (if needed), initializes DB, and serves on http://127.0.0.1:8000"
    echo "  --setup       Interactive configuration wizard (API keys, OAuth, Cloudflare, connectors)"
    echo "  --dev         Starts backend with auto-reload and frontend Vite dev server concurrently"
    echo "  --desktop     Runs in the system tray: stays up with no window open, global hotkey"
    echo "  --doctor      Runs system diagnostics (checks model providers, DB, sandbox, tools)"
    echo "  --build       Forces rebuilding the frontend single-page application"
    echo "  --port <PORT> Specify port (default: 8000)"
    echo "  --init        Initializes configuration and database without starting the server"
    echo "  --help, -h    Shows this help message"
    echo ""
}

# Parse command line argument
MODE="serve"
PORT=8000
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)
            MODE="dev"
            shift
            ;;
        --setup|--config)
            MODE="setup"
            shift
            ;;
        --doctor)
            MODE="doctor"
            shift
            ;;
        --desktop|--tray)
            MODE="desktop"
            shift
            ;;
        --build)
            MODE="build"
            shift
            ;;
        --init)
            MODE="init"
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

echo -e "${BOLD}======================================================${RESET}"
echo -e "${BOLD}              AMETHYST Launcher & Manager                 ${RESET}"
echo -e "${BOLD}======================================================${RESET}"

# 1. Check Python >= 3.11
info "Checking Python environment..."
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.13 python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        if "$cmd" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >/dev/null 2>&1; then
            PYTHON_CMD="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    error "Python 3.11 or higher is required but was not found."
    echo "Please install Python 3.11 or 3.12:"
    echo "  - macOS:          brew install python@3.12"
    echo "  - Ubuntu/Debian:  sudo apt update && sudo apt install -y python3 python3-venv python3-pip"
    echo "  - Fedora:         sudo dnf install python3 python3-pip"
    echo "  - Arch Linux:     sudo pacman -S python python-pip"
    exit 1
fi
success "Found Python: $("$PYTHON_CMD" --version)"

# 2. Check Node.js and npm
info "Checking Node.js & npm..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    error "Node.js (v18+) and npm are required for the web frontend."
    echo "Please install Node.js:"
    echo "  - macOS:          brew install node"
    echo "  - Ubuntu/Debian:  sudo apt install -y nodejs npm (or install via nvm / NodeSource)"
    echo "  - Windows/WSL:    https://nodejs.org/"
    exit 1
fi
success "Found Node.js $(node -v) and npm $(npm -v)"

# 3. Setup Virtual Environment
if [ ! -d ".venv" ]; then
    info "Creating Python virtual environment (.venv)..."
    if command -v uv >/dev/null 2>&1; then
        uv venv .venv || {
            error "Failed to create virtual environment with uv."
            exit 1
        }
    else
        if ! "$PYTHON_CMD" -m venv .venv; then
            error "Failed to create Python virtual environment (.venv)."
            echo "On Debian/Ubuntu systems, you may need to install the python3-venv package:"
            echo "  sudo apt update && sudo apt install -y python3-venv python3-pip"
            exit 1
        fi
    fi
    success "Created virtual environment in .venv"
fi

# Activate virtual environment
# shellcheck source=/dev/null
source .venv/bin/activate

# 4. Check & Install Python Dependencies
info "Verifying Python dependencies..."
NEED_INSTALL=0
if ! python -c "import fastapi, uvicorn, pydantic, mcp, yaml" >/dev/null 2>&1; then
    NEED_INSTALL=1
elif ! python -c "import backend" >/dev/null 2>&1; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    info "Installing Python dependencies from requirements.txt..."
    if command -v uv >/dev/null 2>&1; then
        uv pip install -r requirements.txt
    else
        python -m pip install --upgrade pip
        python -m pip install -r requirements.txt
    fi
    success "Python dependencies installed successfully."
else
    success "Python dependencies are up to date."
fi

# 5. Check .env file
if [ ! -f ".env" ]; then
    info "Creating initial .env from .env.example..."
    cp .env.example .env
    success "Created .env. (You can add API keys in .env or configure them via the UI)"
fi

# 6. Initialize AMETHYST (DB, directories, skills)
info "Running AMETHYST initialization..."
amethyst init >/dev/null 2>&1 || python -m backend.cli init
success "AMETHYST storage and database verified."

# Handle setup mode
if [ "$MODE" == "setup" ]; then
    python scripts/setup_wizard.py
    exit 0
fi

# Handle init mode
if [ "$MODE" == "init" ]; then
    success "Initialization complete. Run './run.sh' to start AMETHYST."
    exit 0
fi

# Handle doctor mode
if [ "$MODE" == "doctor" ]; then
    info "Running AMETHYST Doctor diagnostics:"
    echo ""
    amethyst doctor || python -m backend.cli doctor
    exit 0
fi

# 7. Frontend Setup
if [ ! -d "frontend/node_modules" ]; then
    info "Installing frontend dependencies (npm install)..."
    (cd frontend && npm install)
    success "Frontend dependencies installed."
fi

# Rebuild frontend if requested or if dist doesn't exist
if [ "$MODE" == "build" ] || [ ! -f "frontend/dist/index.html" ]; then
    info "Building frontend web app (npm run build)..."
    (cd frontend && npm run build)
    success "Frontend built successfully in frontend/dist."
    if [ "$MODE" == "build" ]; then
        exit 0
    fi
fi

# 8. Start AMETHYST
if [ "$MODE" == "desktop" ]; then
    echo ""
    info "${BOLD}Starting AMETHYST in the system tray...${RESET}"
    info "Application URL: ${BOLD}http://127.0.0.1:${PORT}${RESET}"
    info "Closing the window leaves it running. Quit from the tray icon."
    echo ""
    exec amethyst desktop --port "$PORT"
fi

if [ "$MODE" == "dev" ]; then
    echo ""
    info "${BOLD}Starting AMETHYST in DEVELOPMENT mode...${RESET}"
    info "Backend API:  http://127.0.0.1:8000"
    info "Frontend Dev: http://127.0.0.1:5173 (with hot reload)"
    info "Press Ctrl+C to stop both servers."
    echo ""

    # Trap to kill background processes on Ctrl+C or exit
    cleanup() {
        echo ""
        warn "Stopping development servers..."
        kill $(jobs -p) 2>/dev/null || true
        wait 2>/dev/null || true
        success "Servers stopped."
    }
    trap cleanup EXIT INT TERM

    # Start backend
    amethyst serve --port "$PORT" --reload &
    BACKEND_PID=$!

    # Start frontend dev server
    (cd frontend && npm run dev) &
    FRONTEND_PID=$!

    wait
else
    # Check if port is already listening
    if command -v lsof >/dev/null 2>&1; then
        if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
            warn "Port $PORT is already in use by another process."
            info "If AMETHYST is already running, you can open http://127.0.0.1:$PORT directly in your browser."
            info "Or launch on a different port: ./run.sh --port $((PORT+1))"
            echo ""
        fi
    fi

    echo ""
    info "${BOLD}Starting AMETHYST Unified Server...${RESET}"
    info "Application URL: ${BOLD}http://127.0.0.1:${PORT}${RESET}"
    info "Press Ctrl+C to stop."
    echo ""
    amethyst serve --port "$PORT" --open
fi
