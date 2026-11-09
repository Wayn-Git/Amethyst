"""Pre-built batch templates for common parallel job patterns.

Usage:
    from backend.workers.templates import get_template, list_templates

    template = get_template("multi_source_research")
    batch = template.build(
        queries=["AI news", "machine learning", "deep learning"],
        urls=["https://example.com", "https://httpbin.org/get"],
        github_user="wayn-git"
    )
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class BatchTemplate:
    """A reusable batch configuration."""
    name: str
    description: str
    node_factory: Any  # Callable[[dict], list[dict]]

    def build(self, **kwargs: Any) -> list[dict[str, Any]]:
        """Build a list of nodes from the template."""
        return self.node_factory(kwargs)


def _multi_source_research(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Research a topic from multiple sources in parallel."""
    queries = params.get("queries") or []
    urls = params.get("urls") or []
    github_user = params.get("github_user")
    
    nodes = []
    
    # Web searches
    for i, query in enumerate(queries):
        nodes.append({
            "id": f"search-{i}",
            "task": "web_search",
            "params": {"query": query, "max_results": params.get("max_results", 5)},
        })
    
    # URL fetches
    if urls:
        nodes.append({
            "id": "urls",
            "task": "urls",
            "params": {"urls": urls, "summarize": True},
        })
    
    # GitHub activity
    if github_user:
        nodes.append({
            "id": "github",
            "task": "github_activity",
            "params": {"username": github_user},
        })
    
    return nodes


def _batch_url_read(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Read a large batch of URLs in parallel with chunking."""
    urls = params.get("urls") or []
    chunk_size = params.get("chunk_size", 10)
    summarize = params.get("summarize", False)
    
    nodes = []
    for i in range(0, len(urls), chunk_size):
        chunk = urls[i:i + chunk_size]
        nodes.append({
            "id": f"urls-{i // chunk_size}",
            "task": "urls",
            "params": {"urls": chunk, "summarize": summarize},
        })
    
    return nodes


def _codebase_analysis(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Analyze a codebase from multiple angles."""
    path = params.get("path", ".")
    include_git = params.get("include_git", True)
    include_files = params.get("include_files", True)
    include_system = params.get("include_system", False)
    
    nodes = []
    
    if include_git:
        nodes.append({
            "id": "git-status",
            "task": "git_status",
            "params": {"path": path},
        })
    
    if include_files:
        nodes.append({
            "id": "file-info",
            "task": "file_info",
            "params": {"paths": [path]},
        })
    
    if include_system:
        nodes.append({
            "id": "system",
            "task": "system_info",
            "params": {},
        })
    
    return nodes


def _news_aggregation(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Aggregate news from multiple feeds and searches."""
    feeds = params.get("feeds") or []
    queries = params.get("queries") or []
    max_per_source = params.get("max_per_source", 10)
    
    nodes = []
    
    # RSS feeds
    if feeds:
        nodes.append({
            "id": "feeds",
            "task": "rss",
            "params": {"feeds": feeds, "max_per_feed": max_per_source},
        })
    
    # Web searches for news
    for i, query in enumerate(queries):
        nodes.append({
            "id": f"news-{i}",
            "task": "web_search",
            "params": {"query": f"{query} news", "max_results": max_per_source},
        })
    
    return nodes


def _mail_and_tasks(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Check mail and tasks in parallel."""
    max_mail = params.get("max_mail", 10)
    include_todo = params.get("include_todo", True)
    
    nodes = [
        {
            "id": "gmail",
            "task": "gmail",
            "params": {"max_results": max_mail},
        }
    ]
    
    if include_todo:
        nodes.append({
            "id": "todo",
            "task": "todo",
            "params": {},
        })
    
    return nodes


# Registry of all templates
TEMPLATES: dict[str, BatchTemplate] = {
    "multi_source_research": BatchTemplate(
        name="multi_source_research",
        description="Research a topic from multiple sources: web search, URLs, GitHub",
        node_factory=_multi_source_research,
    ),
    "batch_url_read": BatchTemplate(
        name="batch_url_read",
        description="Read many URLs in parallel with automatic chunking",
        node_factory=_batch_url_read,
    ),
    "codebase_analysis": BatchTemplate(
        name="codebase_analysis",
        description="Analyze a codebase: git status, file info, system info",
        node_factory=_codebase_analysis,
    ),
    "news_aggregation": BatchTemplate(
        name="news_aggregation",
        description="Aggregate news from RSS feeds and web searches",
        node_factory=_news_aggregation,
    ),
    "mail_and_tasks": BatchTemplate(
        name="mail_and_tasks",
        description="Check mail and tasks in parallel",
        node_factory=_mail_and_tasks,
    ),
}


def get_template(name: str) -> BatchTemplate | None:
    """Get a template by name."""
    return TEMPLATES.get(name)


def list_templates() -> list[dict[str, str]]:
    """List all available templates."""
    return [
        {"name": t.name, "description": t.description}
        for t in TEMPLATES.values()
    ]
