"""
Standalone entrypoint for frozen PyInstaller Amethyst backend.
Initializes multiprocessing freeze support, resolves bundled asset roots,
and runs the FastAPI server via uvicorn.
"""
import sys
import os
import multiprocessing

# On Windows, PyInstaller requires freeze_support() at the very start
multiprocessing.freeze_support()

# Add root directory to sys.path so backend imports resolve seamlessly
if getattr(sys, "frozen", False):
    bundle_dir = sys._MEIPASS
    sys.path.insert(0, bundle_dir)
else:
    bundle_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, bundle_dir)

import uvicorn
from backend.api.main import app

def main():
    host = os.environ.get("AMETHYST_HOST", "127.0.0.1")
    port = int(os.environ.get("AMETHYST_PORT", "8000"))

    print(f"[Amethyst Frozen Engine] Starting on {host}:{port}")
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
    )

if __name__ == "__main__":
    main()
