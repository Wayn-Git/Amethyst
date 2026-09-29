"""Logging that outlives the terminal it was started from.

Every entry point writes to stderr and nowhere else, so the only record of a
failure is whatever the shell still holds in its scrollback -- and a process
that dies takes the reason with it. That is exactly the case this exists for: a
turn that ends with "the process running this turn stopped" and no traceback
anywhere leaves nothing to diagnose.

Three things, in one place, called once per process:

- a rotating file handler under `~/.amethyst/logs`, so a crash has a record
  after the terminal is gone;
- a handler for exceptions asyncio raises inside tasks nobody awaited -- the
  ones CPython prints as "Task exception was never retrieved" and then drops;
- `faulthandler`, which writes a C-level traceback for the failures that never
  reach Python at all: a segfault in a native extension, a stack overflow, an
  allocator abort. Those produce no Python exception and no log line, so a
  written traceback is the only evidence there will ever be.

Idempotent rather than documented as "call this first": `--reload` runs the
application in a child process and the desktop shell runs it a third way, and a
guard that has to be remembered at each of them is a guard that is not there.
"""

from __future__ import annotations

import faulthandler
import logging
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

from backend.config import paths

#: Kept alive for the life of the process. `faulthandler` writes through the
#: raw file descriptor, so the object that opened it must outlive the call.
_crash_file = None

_configured = False

#: The shape uvicorn's own handlers use, so a line from the framework and a
#: line from the agent are told apart by name rather than by eye.
_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def configure_logging(level: str = "INFO") -> None:
    """Attach the stderr and file handlers and the crash recorder. Safe twice."""
    global _configured, _crash_file
    if _configured:
        return
    _configured = True

    root = logging.getLogger()
    root.setLevel(getattr(logging, str(level).upper(), logging.INFO))
    formatter = logging.Formatter(_FORMAT)

    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        root.addHandler(stream)

    # Made as best it can be. A read-only home or a full disk must not stop the
    # server starting: stderr still has everything, it just will not be there
    # tomorrow.
    try:
        paths().ensure()
        file_handler = RotatingFileHandler(
            paths().logs_dir / "amethyst.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except Exception as exc:  # noqa: BLE001 - diagnostics must never be fatal
        print(f"! could not open the log file: {exc}")

    _enable_faullthandler()
    threading.excepthook = _thread_hook


def install_asyncio_handler(loop) -> None:
    """Send asyncio's "never retrieved" exceptions to the log.

    The default handler prints to stderr and drops them. Those are precisely
    the failures from work nobody awaits -- a background sweep, a done
    callback, a notification -- which is why a subsystem can be silently dead
    while the turn in front of it keeps streaming.
    """
    loop.set_exception_handler(lambda _loop, context: _log_task_exception(context))


def _log_task_exception(context: dict) -> None:
    exception = context.get("exception")
    message = str(context.get("message") or "unhandled task exception")
    if exception is not None:
        logging.getLogger("asyncio").error("%s: %s", message, exception, exc_info=exception)
    else:
        logging.getLogger("asyncio").error("%s", message)


def _enable_faullthandler() -> None:
    global _crash_file
    try:
        paths().ensure()
        crash: Path = paths().logs_dir / "crash.log"
        _crash_file = open(crash, "a", encoding="utf-8")
        faulthandler.enable(file=_crash_file, all_threads=True)
    except Exception:
        # faulthandler is a diagnostic, and a diagnostic that prevents startup
        # has cost more than it can ever return.
        _crash_file = None


def _thread_hook(args: threading.ExceptHookArgs) -> None:
    if args.exc_value is not None:
        logging.getLogger("thread").error(
            "unhandled exception in %s", args.thread.name, exc_info=args.exc_value
        )
