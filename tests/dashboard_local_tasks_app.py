"""Disposable, fixed-clock backend for dashboard-local-tasks.mjs.

Run: PYTHONPATH=. .venv/bin/uvicorn dashboard_local_tasks_app:app --app-dir tests --port 8017
Restart for each TEST_WIDGET. This app always replaces AMETHYST_HOME with a temporary home.
"""

import os
from datetime import datetime
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

from fastapi import FastAPI

_home = TemporaryDirectory(prefix="amethyst-widget-test-")
os.environ["AMETHYST_HOME"] = _home.name


def create_app():
    from backend.dashboard import items
    from backend.dashboard.router import router

    items.local_now = lambda: datetime(2026, 10, 25, 23, 59, tzinfo=ZoneInfo("Asia/Kolkata"))
    app = FastAPI()
    app.include_router(router)
    return app


app = create_app()
