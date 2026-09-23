"""
Standalone entrypoint for frozen PyInstaller Amethyst backend.
Initializes multiprocessing freeze support, resolves bundled asset roots,
and routes execution through backend.cli.main().
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

from backend.cli import main as cli_main


def main():
    host = os.environ.get("AMETHYST_HOST", "127.0.0.1")
    port = int(os.environ.get("AMETHYST_PORT", "8000"))

    # Ensure AMETHYST_BIND_PORT and AMETHYST_BIND_HOST are exported
    os.environ["AMETHYST_BIND_PORT"] = str(port)
    os.environ["AMETHYST_BIND_HOST"] = str(host)

    if len(sys.argv) > 1:
        # CLI invocation with subcommands, e.g. amethyst doctor, amethyst secrets
        sys.exit(cli_main(sys.argv[1:]))

    print(f"[Amethyst Frozen Engine] Starting on {host}:{port}")
    argv = ["serve", "--port", str(port), "--host", host, "--no-build"]
    sys.exit(cli_main(argv))


if __name__ == "__main__":
    main()
