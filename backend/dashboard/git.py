"""Bounded, non-mutating Git observations for explicitly configured local paths."""

import asyncio
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from pydantic import Field, field_validator

from backend.dashboard.models import StrictModel
from backend.dashboard.store import settings_read

_GIT_GATE = asyncio.Semaphore(4)


class RepoSettings(StrictModel):
    repos: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("repos")
    @classmethod
    def paths(cls, values):
        result = []
        for value in values:
            if not value or len(value) > 4096 or any(ord(char) < 32 for char in value):
                raise ValueError("Use one absolute local repository path per line")
            path = Path(value).expanduser()
            if not path.is_absolute():
                raise ValueError("Repository paths must be absolute")
            result.append(str(path.resolve()))
        return list(dict.fromkeys(result))


async def git(path, *args, timeout=2):
    async with _GIT_GATE:
        process = await asyncio.create_subprocess_exec(
            "git",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            *args,
            cwd=path,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        if process.returncode:
            raise RuntimeError("Git observation unavailable")
        return stdout.decode(errors="replace").strip()


def public_remote(value):
    if "://" in value:
        parsed = urlsplit(value)
        return urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path, "", ""))
    return re.sub(r"^[^/@:]+@", "", value)


async def backup(path):
    item = {"id": path, "title": path, "local_clone": False, "remotes": [], "warnings": []}
    try:
        await git(path, "rev-parse", "--git-dir")
        item["local_clone"] = True
        names = (await git(path, "remote")).splitlines()
        # Git does not record every host's push time. Only report local reflog evidence.
        pushes = {}
        logs = await git(
            path, "reflog", "show", "--all", "--date=iso-strict", "--format=%gD%x09%gs", "-n", "200"
        )
        for line in logs.splitlines():
            ref, _, message = line.partition("\t")
            match = re.match(r"refs/remotes/([^/]+)/.+@\{(.+)\}$", ref)
            if match and message == "update by push":
                name, when = match.groups()
                pushes[name] = max(
                    filter(None, [pushes.get(name), when]), key=datetime.fromisoformat
                )

        async def remote(name):
            url = await git(path, "remote", "get-url", name)
            reachable = None
            # Never run custom Git remote helpers or repository-supplied upload-pack commands.
            safe = url.startswith(
                ("https://", "http://", "ssh://", "git://", "file://", "/")
            ) or bool(re.fullmatch(r"[\w.-]+@[\w.-]+:[^\s]+", url))
            if safe:
                try:
                    await git(
                        path,
                        "-c",
                        "protocol.ext.allow=never",
                        "-c",
                        "credential.helper=",
                        "-c",
                        "core.sshCommand=ssh -oBatchMode=yes -oConnectTimeout=1",
                        "ls-remote",
                        "--upload-pack=git-upload-pack",
                        "--heads",
                        "--",
                        url,
                    )
                    reachable = True
                except (OSError, RuntimeError, TimeoutError):
                    reachable = False
            return {
                "name": name,
                "url": public_remote(url),
                "reachable": reachable,
                "last_push": pushes.get(name),
            }

        item["remotes"] = await asyncio.gather(*(remote(name) for name in names))
        if len(names) < 2:
            item["warnings"].append("Only one remote" if names else "No remotes configured")
    except (OSError, RuntimeError, TimeoutError):
        item["warnings"].append(
            "Repository details unavailable" if item["local_clone"] else "No readable local clone"
        )
    return item


async def unpushed(path):
    item = {"id": path, "title": path, "warnings": [], "branches": [], "dirty": None}
    try:
        item["dirty"] = bool(await git(path, "status", "--porcelain", "--untracked-files=normal"))
        branches = await git(
            path, "for-each-ref", "--format=%(refname:short)%09%(upstream:short)", "refs/heads/"
        )
        for line in branches.splitlines():
            name, _, upstream = line.partition("\t")
            ahead = None
            if upstream:
                ahead = int(await git(path, "rev-list", "--count", f"{upstream}..{name}", "--"))
            item["branches"].append({"name": name, "upstream": upstream or None, "ahead": ahead})
    except (OSError, RuntimeError, TimeoutError):
        item["warnings"].append("Repository details unavailable")
    return item


async def provide(widget_id):
    repos = settings_read(widget_id).get("repos", [])
    return {
        "items": await asyncio.gather(
            *((unpushed if widget_id == "dev.unpushed" else backup)(path) for path in repos)
        ),
        "repos": repos,
    }
