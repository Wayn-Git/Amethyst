"""Give a local file a URL, so it can be embedded somewhere public.

An image on this machine cannot be put into a GitHub issue by writing its path
into the body -- which is exactly what happened when the model was handed
`/home/wayne/.amethyst/attachments/…/Screenshot.png` and asked to file a bug.
Markdown needs a URL, and GitHub's own image upload is a browser-only endpoint
that the API and `gh` both refuse.

The route that does work with what is already installed: commit the file into
the repository and use the raw URL GitHub returns. `gh` is the same tool the
agent already shells out to for `gh issue create`, and it carries the user's
existing credentials.

This writes to a real remote, so it is `RiskLevel.HIGH` and goes through the
confirmation gate like anything else that leaves the machine.
"""

from __future__ import annotations

import base64
import json
import shutil
from pathlib import Path
from typing import Any

from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult

# GitHub renders images from the repository; anything else is a download link,
# which is not what "put the screenshot in the issue" means.
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

# The API rejects large blobs, and a screenshot has no business being one.
_MAX_BYTES = 10 * 1024 * 1024

# One place, so a repository does not accumulate images in arbitrary corners.
_UPLOAD_DIR = ".github/assets"


async def upload_image(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    path = Path(str(args.get("path", ""))).expanduser()
    if not path.is_file():
        return ToolResult.error(f"no such file: {path}")
    if path.suffix.lower() not in _IMAGE_SUFFIXES:
        return ToolResult.error(
            f"{path.name} is not an image GitHub will render"
            f" ({', '.join(sorted(_IMAGE_SUFFIXES))})"
        )

    raw = path.read_bytes()
    if len(raw) > _MAX_BYTES:
        return ToolResult.error(f"{path.name} is {len(raw):,} bytes; the limit is {_MAX_BYTES:,}")

    if shutil.which("gh") is None:
        return ToolResult.error("the GitHub CLI (gh) is not installed, so there is nowhere to put it")

    repo = str(args.get("repo") or "").strip()
    if not repo:
        found = await _run("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner")
        if found.returncode != 0:
            return ToolResult.error(
                "no repository given and this directory is not a GitHub checkout"
            )
        repo = found.stdout.strip()

    # A stable name per file, so re-uploading the same screenshot twice does not
    # litter the repository with copies -- but distinct enough that two
    # different screenshots taken the same second do not collide.
    digest = __import__("hashlib").sha256(raw).hexdigest()[:12]
    target = f"{_UPLOAD_DIR}/{digest}-{path.name}"

    existing = await _run("gh", "api", f"/repos/{repo}/contents/{target}", "-q", ".download_url")
    if existing.returncode == 0 and existing.stdout.strip():
        url = existing.stdout.strip()
        return ToolResult.ok(
            f"Already uploaded. Embed it with:\n\n![{path.stem}]({url})",
            artifacts=[{"kind": "url", "url": url}],
        )

    payload = json.dumps({
        "message": f"Add {path.name} for an issue",
        "content": base64.b64encode(raw).decode("ascii"),
    })
    created = await _run(
        "gh", "api", "--method", "PUT", f"/repos/{repo}/contents/{target}",
        "--input", "-", input_text=payload,
    )
    if created.returncode != 0:
        return ToolResult.error(f"the upload failed: {created.stderr.strip() or created.stdout.strip()}")

    try:
        url = json.loads(created.stdout)["content"]["download_url"]
    except (ValueError, KeyError, TypeError):
        return ToolResult.error("the upload succeeded but GitHub returned no download URL")

    return ToolResult.ok(
        f"Uploaded to {repo}. Embed it with:\n\n![{path.stem}]({url})",
        artifacts=[{"kind": "url", "url": url}],
    )


async def _run(*command: str, input_text: str | None = None):
    """`gh`, with its output captured. A thin wrapper so the calls above read."""
    import asyncio
    from types import SimpleNamespace

    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE if input_text is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await process.communicate(input_text.encode() if input_text is not None else None)
    return SimpleNamespace(
        returncode=process.returncode,
        stdout=out.decode(errors="replace"),
        stderr=err.decode(errors="replace"),
    )


def tools() -> list[Tool]:
    return [
        Tool(
            name="upload_image",
            description=(
                "Put a local image somewhere public and get a URL back, so it can be"
                " embedded in a GitHub issue, pull request or comment. Use this"
                " whenever you are asked to include a screenshot in something you"
                " file -- a filesystem path in an issue body shows nothing to anyone"
                " reading it. Returns the markdown to paste. Commits the image to"
                " the repository."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "The image on this machine"},
                    "repo": {
                        "type": "string",
                        "description": "owner/name. Defaults to the repository in the"
                        " working directory.",
                    },
                },
                "required": ["path"],
            },
            handler=upload_image,
            # It pushes to a remote other people can see. Nothing about that is
            # undoable from here.
            risk=RiskLevel.HIGH,
        ),
    ]
