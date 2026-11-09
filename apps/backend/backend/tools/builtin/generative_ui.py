"""Generative sandboxed UI tool for rich interactive components.

Allows the agent to generate interactive tools (calculators, 3D viewers,
charts, diagrams, animations, and simulations) that render inside an isolated
sandboxed iframe in the Amethyst interface.
"""

from __future__ import annotations

from typing import Any

from backend.agent.widgets import SandboxedUi, to_envelope
from backend.tools.base import RiskLevel, Tool, ToolContext, ToolResult


async def generate_sandboxed_ui(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    title = str(args.get("title") or "Interactive Tool")
    html = str(args.get("html") or "")
    css = str(args.get("css") or "")
    js = str(args.get("js") or "")
    initial_height = int(args.get("initial_height") or 400)
    scripts = args.get("scripts") or []
    if isinstance(scripts, str):
        scripts = [scripts]
    elif not isinstance(scripts, list):
        scripts = []

    if not html.strip() and not js.strip():
        return ToolResult.error("Must provide either 'html' or 'js' for the sandboxed UI.")

    try:
        validated = SandboxedUi(
            title=title,
            initial_height=initial_height,
            html=html,
            css=css,
            js=js,
            scripts=scripts,
        )
    except Exception as exc:
        return ToolResult.error(f"Invalid sandboxed UI data: {exc}")

    envelope = to_envelope("sandboxed_ui", validated.model_dump(), [])

    # If events queue is available, notify live
    if ctx.events is not None:
        ctx.events.put_nowait(
            (
                "widget",
                {
                    "widget": {
                        "type": "sandboxed_ui",
                        "data": validated.model_dump(),
                        "media": [],
                    },
                    "text": envelope,
                },
            )
        )

    return ToolResult.ok(
        f"Generated interactive tool '{title}'. The component is delivered to the user.\n\n{envelope}"
    )


def tools() -> list[Tool]:
    return [
        Tool(
            name="generate_sandboxed_ui",
            description=(
                "Generate an interactive, sandboxed UI tool (calculator, 3D model, "
                "chart, interactive diagram, simulation, or custom visual application). "
                "Renders inside a secure isolated iframe matching Amethyst design tokens. "
                "Provide self-contained HTML, CSS, and JavaScript. You can also specify "
                "popular CDN library URLs in 'scripts' (e.g. Chart.js, Three.js)."
            ),
            risk=RiskLevel.LOW,
            parameters={
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short title describing the interactive tool (e.g. 'Mortgage Calculator', 'Revenue Chart', '3D Airplane Pitch/Yaw')",
                    },
                    "initial_height": {
                        "type": "integer",
                        "description": "Initial height in pixels (default 400, recommended 300 to 600)",
                    },
                    "html": {
                        "type": "string",
                        "description": "Clean semantic HTML content, control inputs, buttons, containers, and canvas elements",
                    },
                    "css": {
                        "type": "string",
                        "description": "Scoped CSS styling. Use CSS variables var(--canvas), var(--text), var(--accent), var(--border) to adapt to the user's theme",
                    },
                    "js": {
                        "type": "string",
                        "description": "Client-side JavaScript implementing interactivity, calculations, event listeners, or animations",
                    },
                    "scripts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of external CDN script URLs to load before executing js (e.g. 'https://cdn.jsdelivr.net/npm/chart.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')",
                    },
                },
                "required": ["title", "html"],
            },
            handler=generate_sandboxed_ui,
        )
    ]
