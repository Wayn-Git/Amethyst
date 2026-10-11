#!/usr/bin/env python3
"""
Build script to compile the standalone amethyst-backend binary using PyInstaller.
Outputs binary directly to resources/bin/ for consumption by electron-builder.
"""
import sys
import os
import subprocess
import shutil

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPEC_PATH = os.path.join(ROOT_DIR, "packaging", "amethyst-backend.spec")
OUTPUT_DIR = os.path.join(ROOT_DIR, "resources", "bin")

def ensure_dependencies():
    try:
        import PyInstaller
    except ImportError:
        print("[Build] Installing pyinstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

def build():
    ensure_dependencies()
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--distpath",
        OUTPUT_DIR,
        "--workpath",
        os.path.join(ROOT_DIR, "build", "pyinstaller"),
        SPEC_PATH,
    ]

    print(f"[Build] Running PyInstaller: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=os.path.join(ROOT_DIR, "packaging"))

    binary_name = "amethyst-backend.exe" if sys.platform == "win32" else "amethyst-backend"
    expected_bin = os.path.join(OUTPUT_DIR, binary_name)
    if os.path.exists(expected_bin):
        print(f"[Build Success] Standalone binary compiled: {expected_bin}")
    else:
        raise FileNotFoundError(f"Expected binary not found: {expected_bin}")

if __name__ == "__main__":
    build()
