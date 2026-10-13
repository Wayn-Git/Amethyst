"""Composio service integration and session lifecycle manager.

Manages persistent Composio sessions with hosted MCP endpoints, scopes toolkits
via explicit allowlists to prevent prompt bloat, and provides connection details
to Amethyst's MCP manager.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

from backend import secrets
from backend.db.connection import get_connection

log = logging.getLogger(__name__)

# Suppress noisy HTTP client logs and telemetry
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("composio").setLevel(logging.WARNING)
os.environ.setdefault("COMPOSIO_TELEMETRY", "false")

SECRET_KEY_REF = "amethyst/composio"
DEFAULT_TOOLKITS = ["slack", "github", "linear", "notion", "gmail"]


def sanitize_composio_key(raw: str | None) -> str:
    """Clean and normalize a pasted Composio API key.

    Strips surrounding whitespace, quotes, shell prefixes like 'export',
    common environment variable names ('COMPOSIO_API_KEY='), and 'Bearer'.
    """
    cleaned = (raw or "").strip()
    if cleaned.startswith("export "):
        cleaned = cleaned[7:].strip()
    for prefix in (
        "COMPOSIO_API_KEY=",
        "COMPOSIO_USER_API_KEY=",
        "COMPOSIO_ORG_API_KEY=",
    ):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    return cleaned.strip("'\"").strip()


def _extract_composio_error_message(exc: Exception) -> str | None:
    """Extract a descriptive error message from a Composio SDK or HTTP error."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        if isinstance(err, str):
            return err
    msg = getattr(exc, "message", None) or str(exc)
    return str(msg) if msg else None


NON_OAUTH_TOOLKITS: list[dict[str, Any]] = [
    {
        "slug": "web_scraper",
        "name": "Web Scraper",
        "description": "Scrape and extract clean text from any webpage or article.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "duckduckgo",
        "name": "DuckDuckGo Search",
        "description": "Privacy-focused web search for links, snippets, and answers.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "calculator",
        "name": "Calculator",
        "description": "Evaluate mathematical equations and perform numeric computations.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "weather",
        "name": "Weather",
        "description": "Get real-time weather reports and forecasts for locations worldwide.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "hackernews",
        "name": "Hacker News",
        "description": "Browse frontpage stories, comments, and search Hacker News.",
        "category": "Developer Tools",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "wikipedia",
        "name": "Wikipedia",
        "description": "Search and retrieve encyclopedia summaries and structured sections.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "sql",
        "name": "SQL Tool",
        "description": "Execute queries and inspect database schemas directly.",
        "category": "Developer Tools",
        "no_auth": True,
        "auth_type": "none",
    },
    {
        "slug": "arxiv",
        "name": "ArXiv Search",
        "description": "Search scientific research papers, abstracts, and academic authors.",
        "category": "Web & Data",
        "no_auth": True,
        "auth_type": "none",
    },
]

OAUTH_TOOLKITS: list[dict[str, Any]] = [
    # --- Developer Tools ---
    {
        "slug": "github",
        "name": "GitHub",
        "description": "Manage repositories, issues, pull requests, actions, and git workflows.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "gitlab",
        "name": "GitLab",
        "description": "Manage projects, merge requests, issues, pipelines, and repositories.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "bitbucket",
        "name": "Bitbucket",
        "description": "Track Git repositories, pull requests, and pipelines in Atlassian Bitbucket.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "linear",
        "name": "Linear",
        "description": "Track issues, cycles, projects, and roadmaps.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "jira",
        "name": "Jira",
        "description": "Create and update issues, sprints, and epics in Atlassian Jira.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "sentry",
        "name": "Sentry",
        "description": "Monitor application errors, stack traces, and release health.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "postman",
        "name": "Postman",
        "description": "Run API collections, monitor endpoints, and inspect environments.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "supabase",
        "name": "Supabase",
        "description": "Query Postgres tables, inspect auth users, and execute storage ops.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "vercel",
        "name": "Vercel",
        "description": "Deployments, project domains, build logs, and environment variables.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "datadog",
        "name": "Datadog",
        "description": "Search metrics, monitor alerts, and inspect telemetry dashboards.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "grafana",
        "name": "Grafana",
        "description": "Query dashboards, annotations, data sources, and alert rules.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "cloudflare",
        "name": "Cloudflare",
        "description": "Manage DNS records, workers, zone cache, and security firewall.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "render",
        "name": "Render",
        "description": "Inspect deployed services, web services, databases, and deploys.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "circleci",
        "name": "CircleCI",
        "description": "Inspect CI/CD pipelines, jobs, workflows, and test artifacts.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "pagerduty",
        "name": "PagerDuty",
        "description": "Manage incident responses, on-call schedules, and services.",
        "category": "Developer Tools",
        "no_auth": False,
        "auth_type": "oauth",
    },

    # --- Communication ---
    {
        "slug": "slack",
        "name": "Slack",
        "description": "Send messages, manage channels, and search workspace history.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "discord",
        "name": "Discord",
        "description": "Send messages, manage channels, and inspect Discord servers.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "gmail",
        "name": "Gmail",
        "description": "Send emails, search inbox, and manage threads.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "outlook",
        "name": "Microsoft Outlook",
        "description": "Send emails, manage mail folders, and search messages.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "microsoft_teams",
        "name": "Microsoft Teams",
        "description": "Chat in team channels, manage team spaces, and schedule calls.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "telegram",
        "name": "Telegram",
        "description": "Send messages and notifications to Telegram chats and channels.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "whatsapp",
        "name": "WhatsApp",
        "description": "Send WhatsApp business messages, templates, and notifications.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "zoom",
        "name": "Zoom",
        "description": "Schedule meetings, retrieve recordings, and view attendee lists.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "twilio",
        "name": "Twilio",
        "description": "Send SMS, make voice calls, and lookup phone numbers.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "intercom",
        "name": "Intercom",
        "description": "Manage customer conversations, user profiles, and help articles.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "zendesk",
        "name": "Zendesk",
        "description": "Create support tickets, track user requests, and update macros.",
        "category": "Communication",
        "no_auth": False,
        "auth_type": "oauth",
    },

    # --- Productivity & Workspace ---
    {
        "slug": "notion",
        "name": "Notion",
        "description": "Search workspace pages, read databases, and update documents.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "googlecalendar",
        "name": "Google Calendar",
        "description": "Schedule events, check availability, and manage calendars.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "googledrive",
        "name": "Google Drive",
        "description": "Search, organize, and read files in Google Drive.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "googlesheets",
        "name": "Google Sheets",
        "description": "Read, create, and update spreadsheet sheets and rows.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "googledocs",
        "name": "Google Docs",
        "description": "Create, edit, and read document contents in Google Docs.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "asana",
        "name": "Asana",
        "description": "Manage tasks, projects, portfolios, and team workflows.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "trello",
        "name": "Trello",
        "description": "Manage boards, lists, checklists, and task cards.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "clickup",
        "name": "ClickUp",
        "description": "Manage tasks, spaces, custom fields, and project documents.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "airtable",
        "name": "Airtable",
        "description": "Query and manipulate Airtable bases, tables, and records.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "coda",
        "name": "Coda",
        "description": "Automate documents, interact with Coda tables, and sync formulas.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "todoist",
        "name": "Todoist",
        "description": "Create and prioritize tasks, manage projects and labels.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "monday",
        "name": "Monday.com",
        "description": "Track project boards, team items, columns, and automations.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "basecamp",
        "name": "Basecamp",
        "description": "Organize team message boards, todos, and project documents.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "confluence",
        "name": "Confluence",
        "description": "Search company wikis, read spaces, and publish pages.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "miro",
        "name": "Miro",
        "description": "Create sticky notes, whiteboard diagrams, and mind maps.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "evernote",
        "name": "Evernote",
        "description": "Search notebooks, read notes, and sync personal clippings.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "box",
        "name": "Box",
        "description": "Store, search, and securely share enterprise cloud files.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "dropbox",
        "name": "Dropbox",
        "description": "Search, upload, and manage files in Dropbox storage.",
        "category": "Productivity",
        "no_auth": False,
        "auth_type": "oauth",
    },

    # --- Business & CRM ---
    {
        "slug": "salesforce",
        "name": "Salesforce",
        "description": "Manage CRM contacts, leads, accounts, and opportunities.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "hubspot",
        "name": "HubSpot",
        "description": "Track marketing leads, deals, contacts, and customer tickets.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "stripe",
        "name": "Stripe",
        "description": "Inspect payments, customer charges, invoices, and subscriptions.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "shopify",
        "name": "Shopify",
        "description": "Search store inventory, customer orders, and product listings.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "pipedrive",
        "name": "Pipedrive",
        "description": "Manage sales pipelines, deal stages, and sales activities.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "zoho",
        "name": "Zoho CRM",
        "description": "Track sales leads, customer contacts, accounts, and tasks.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "quickbooks",
        "name": "QuickBooks",
        "description": "Access accounting records, bills, invoices, and expenses.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "mailchimp",
        "name": "Mailchimp",
        "description": "Manage email marketing lists, campaign blasts, and subscriber tags.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "apollo",
        "name": "Apollo.io",
        "description": "Search B2B leads, enrich company contacts, and sequence outreach.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "gumroad",
        "name": "Gumroad",
        "description": "Track digital sales, customer purchases, and product catalogs.",
        "category": "Business",
        "no_auth": False,
        "auth_type": "oauth",
    },

    # --- Social & Media ---
    {
        "slug": "twitter",
        "name": "Twitter / X",
        "description": "Post tweets, search timelines, and monitor mentions on X.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "linkedin",
        "name": "LinkedIn",
        "description": "Read updates, share posts, and inspect company pages.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "youtube",
        "name": "YouTube",
        "description": "Search videos, inspect channel analytics, and manage playlists.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "reddit",
        "name": "Reddit",
        "description": "Browse subreddits, read comments, post links, and vote.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "instagram",
        "name": "Instagram",
        "description": "Post photos, read comments, and monitor profile insights.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "facebook",
        "name": "Facebook",
        "description": "Publish page posts, manage page feeds, and view insights.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "spotify",
        "name": "Spotify",
        "description": "Control playback, search music, albums, and manage playlists.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "medium",
        "name": "Medium",
        "description": "Publish articles, read story drafts, and monitor stats.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "producthunt",
        "name": "Product Hunt",
        "description": "Discover trending tech products, upvotes, and daily launches.",
        "category": "Social & Media",
        "no_auth": False,
        "auth_type": "oauth",
    },

    # --- Web Intelligence & AI ---
    {
        "slug": "tavily",
        "name": "Tavily Search",
        "description": "High-precision AI web search optimized for LLM factual synthesis.",
        "category": "Web & Data",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "exa",
        "name": "Exa Neural Search",
        "description": "Neural semantic web search finding pages by concepts and embeddings.",
        "category": "Web & Data",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "firecrawl",
        "name": "Firecrawl Web Extraction",
        "description": "Crawl and convert websites into clean markdown documents.",
        "category": "Web & Data",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "serpapi",
        "name": "SerpApi Google Search",
        "description": "Search Google, Bing, Yahoo, and structured web snippets.",
        "category": "Web & Data",
        "no_auth": False,
        "auth_type": "oauth",
    },
    {
        "slug": "wolframalpha",
        "name": "Wolfram Alpha",
        "description": "Query computational knowledge, mathematics, and curated facts.",
        "category": "Web & Data",
        "no_auth": False,
        "auth_type": "oauth",
    },
]


def is_no_auth_toolkit(toolkit_slug: str) -> bool:
    """Return True if the toolkit is a Direct Tool requiring no user OAuth setup."""
    slug = toolkit_slug.strip().lower()
    return any(item["slug"] == slug for item in NON_OAUTH_TOOLKITS)


def get_toolkits_catalog() -> list[dict[str, Any]]:
    """Return unified catalog of all supported Composio toolkits."""
    return [dict(t) for t in (NON_OAUTH_TOOLKITS + OAUTH_TOOLKITS)]


CURATED_TOOLKITS_CARDS: list[dict[str, Any]] = [
    {"slug": "slack", "label": "Slack", "blurb": "Post updates and read channels", "domain": "slack.com", "logo": "https://logos.composio.dev/api/slack", "noAuth": False},
    {"slug": "github", "label": "GitHub", "blurb": "Issues, pull requests, and code", "domain": "github.com", "logo": "https://logos.composio.dev/api/github", "noAuth": False},
    {"slug": "gmail", "label": "Gmail", "blurb": "Read and send email", "domain": "mail.google.com", "logo": "https://logos.composio.dev/api/gmail", "noAuth": False},
    {"slug": "googlecalendar", "label": "Google Calendar", "blurb": "Read and create events", "domain": "calendar.google.com", "logo": "https://logos.composio.dev/api/googlecalendar", "noAuth": False},
    {"slug": "googlesheets", "label": "Google Sheets", "blurb": "Read and update spreadsheets", "domain": "sheets.google.com", "logo": "https://logos.composio.dev/api/googlesheets", "noAuth": False},
    {"slug": "googledocs", "label": "Google Docs", "blurb": "Read and write documents", "domain": "docs.google.com", "logo": "https://logos.composio.dev/api/googledocs", "noAuth": False},
    {"slug": "googledrive", "label": "Google Drive", "blurb": "Browse and manage files", "domain": "drive.google.com", "logo": "https://logos.composio.dev/api/googledrive", "noAuth": False},
    {"slug": "notion", "label": "Notion", "blurb": "Pages and databases", "domain": "notion.so", "logo": "https://logos.composio.dev/api/notion", "noAuth": False},
    {"slug": "linear", "label": "Linear", "blurb": "Issues and project tracking", "domain": "linear.app", "logo": "https://logos.composio.dev/api/linear", "noAuth": False},
    {"slug": "sentry", "label": "Sentry", "blurb": "Errors and alerts", "domain": "sentry.io", "logo": "https://logos.composio.dev/api/sentry", "noAuth": False},
    {"slug": "posthog", "label": "PostHog", "blurb": "Analytics, feature flags, experiments", "domain": "posthog.com", "logo": "https://logos.composio.dev/api/posthog", "noAuth": False},
    {"slug": "discord", "label": "Discord", "blurb": "Messages and channels", "domain": "discord.com", "logo": "https://logos.composio.dev/api/discord", "noAuth": False},
    {"slug": "twitter", "label": "X (Twitter)", "blurb": "Post and read on X", "domain": "x.com", "logo": "https://logos.composio.dev/api/twitter", "noAuth": False},
    {"slug": "reddit", "label": "Reddit", "blurb": "Browse and post", "domain": "reddit.com", "logo": "https://logos.composio.dev/api/reddit", "noAuth": False},
    {"slug": "zapier", "label": "Zapier", "blurb": "Connect 9,000+ apps", "domain": "zapier.com", "logo": "https://logos.composio.dev/api/zapier", "noAuth": False},
    {"slug": "hubspot", "label": "HubSpot", "blurb": "CRM search & updates", "domain": "hubspot.com", "logo": "https://logos.composio.dev/api/hubspot", "noAuth": False},
    {"slug": "salesforce", "label": "Salesforce", "blurb": "CRM records and reports", "domain": "salesforce.com", "logo": "https://logos.composio.dev/api/salesforce", "noAuth": False},
    {"slug": "jira", "label": "Jira", "blurb": "Issues and sprints", "domain": "atlassian.com", "logo": "https://logos.composio.dev/api/jira", "noAuth": False},
    {"slug": "asana", "label": "Asana", "blurb": "Tasks and projects", "domain": "asana.com", "logo": "https://logos.composio.dev/api/asana", "noAuth": False},
    {"slug": "trello", "label": "Trello", "blurb": "Boards and cards", "domain": "trello.com", "logo": "https://logos.composio.dev/api/trello", "noAuth": False},
    {"slug": "dropbox", "label": "Dropbox", "blurb": "Files and folders", "domain": "dropbox.com", "logo": "https://logos.composio.dev/api/dropbox", "noAuth": False},
    {"slug": "airtable", "label": "Airtable", "blurb": "Bases and records", "domain": "airtable.com", "logo": "https://logos.composio.dev/api/airtable", "noAuth": False},
    {"slug": "figma", "label": "Figma", "blurb": "Files and comments", "domain": "figma.com", "logo": "https://logos.composio.dev/api/figma", "noAuth": False},
    {"slug": "stripe", "label": "Stripe", "blurb": "Payments and customers", "domain": "stripe.com", "logo": "https://logos.composio.dev/api/stripe", "noAuth": False},
]

NON_AUTH_TOOLKITS_CARDS: list[dict[str, Any]] = [
    {"slug": "web_scraper", "label": "Web Scraper", "blurb": "Scrape and extract clean text from any webpage or article.", "domain": None, "logo": "https://logos.composio.dev/api/web_scraper", "noAuth": True},
    {"slug": "duckduckgo", "label": "DuckDuckGo", "blurb": "Privacy-focused web search for links, snippets, and answers.", "domain": "duckduckgo.com", "logo": "https://logos.composio.dev/api/duckduckgo", "noAuth": True},
    {"slug": "calculator", "label": "Calculator", "blurb": "Evaluate mathematical equations and perform numeric computations.", "domain": None, "logo": "https://logos.composio.dev/api/calculator", "noAuth": True},
    {"slug": "weather", "label": "Weather", "blurb": "Get real-time weather reports and forecasts for locations worldwide.", "domain": "weather.com", "logo": "https://logos.composio.dev/api/weather", "noAuth": True},
    {"slug": "hackernews", "label": "Hacker News", "blurb": "Browse frontpage stories, comments, and search Hacker News.", "domain": "news.ycombinator.com", "logo": "https://logos.composio.dev/api/hackernews", "noAuth": True},
    {"slug": "wikipedia", "label": "Wikipedia", "blurb": "Search and retrieve encyclopedia summaries and structured sections.", "domain": "wikipedia.org", "logo": "https://logos.composio.dev/api/wikipedia", "noAuth": True},
    {"slug": "sql", "label": "SQL Tool", "blurb": "Execute queries and inspect database schemas directly.", "domain": None, "logo": "https://logos.composio.dev/api/sql", "noAuth": True},
]

_DOMAIN_MAPPING: dict[str, str] = {
    "slack": "slack.com",
    "github": "github.com",
    "gmail": "mail.google.com",
    "googlecalendar": "calendar.google.com",
    "googlesheets": "sheets.google.com",
    "googledocs": "docs.google.com",
    "googledrive": "drive.google.com",
    "google_drive": "drive.google.com",
    "notion": "notion.so",
    "linear": "linear.app",
    "gitlab": "gitlab.com",
    "bitbucket": "bitbucket.org",
    "jira": "atlassian.com",
    "asana": "asana.com",
    "trello": "trello.com",
    "sentry": "sentry.io",
    "posthog": "posthog.com",
    "discord": "discord.com",
    "twitter": "x.com",
    "reddit": "reddit.com",
    "zapier": "zapier.com",
    "hubspot": "hubspot.com",
    "salesforce": "salesforce.com",
    "dropbox": "dropbox.com",
    "airtable": "airtable.com",
    "figma": "figma.com",
    "stripe": "stripe.com",
    "telegram": "telegram.org",
    "whatsapp": "whatsapp.com",
    "shopify": "shopify.com",
    "zoom": "zoom.us",
    "clickup": "clickup.com",
    "todoist": "todoist.com",
    "zendesk": "zendesk.com",
    "intercom": "intercom.com",
    "supabase": "supabase.com",
    "vercel": "vercel.com",
    "cloudflare": "cloudflare.com",
    "datadog": "datadoghq.com",
    "spotify": "spotify.com",
    "canva": "canva.com",
    "adobe": "adobe.com",
    "medium": "medium.com",
    "tavily": "tavily.com",
    "firecrawl": "firecrawl.dev",
    "exa": "exa.ai",
    "duckduckgo": "duckduckgo.com",
    "wikipedia": "wikipedia.org",
    "hackernews": "news.ycombinator.com",
    "arxiv": "arxiv.org",
    "weather": "weather.com",
}


def _validate_consumer_key(key: str) -> tuple[bool, str | None]:
    """Validate a consumer key against Composio Connect MCP gateway."""
    try:
        import httpx

        url = "https://connect.composio.dev/mcp"
        headers = {
            "x-consumer-api-key": key,
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        }
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "amethyst-validator", "version": "1.0.0"},
            },
        }
        resp = httpx.post(url, headers=headers, json=body, timeout=10.0)
        if resp.status_code == 200:
            return True, None

        if resp.status_code in (401, 403):
            reason = resp.headers.get("x-mcp-auth-failure-reason")
            if not reason:
                try:
                    data = resp.json()
                    reason = data.get("error", {}).get("message") or data.get("message")
                except Exception:
                    pass
            msg = (
                f"Invalid Composio Consumer Key: {reason}"
                if reason
                else "Invalid Composio Consumer Key. Key was rejected by Composio Connect."
            )
            return False, msg

        return False, f"Composio Connect returned status {resp.status_code}: {resp.text[:200]}"
    except Exception as exc:
        log.warning("Composio consumer key probe failed: %s", exc)
        return False, f"Could not reach Composio Connect MCP gateway: {exc}"


class ComposioService:
    """Manages credentials, sessions, and hosted MCP configuration for Composio."""

    def __init__(self) -> None:
        self._cached_client: Any = None
        self._cached_session: Any = None
        self._connections_cache: tuple[float, dict[str, Any]] | None = None
        self._catalog_cache: tuple[float, dict[str, Any]] | None = None
        self._tools_cache: tuple[float, dict[str, Any]] | None = None
        self._key_mode: str | None = None

    def _detect_key_mode(self, key: str) -> str:
        k = key.strip()
        if k.startswith(("ck_", "ck-")):
            return "consumer"
        if k.startswith(("uak_", "uak-")):
            return "user"
        if k.startswith(("oak_", "oak-")):
            return "org"
        return "project"

    def get_key_mode(self) -> str:
        """Get the active key mode ('consumer', 'user', 'org', or 'project')."""
        if getattr(self, "_key_mode", None):
            return self._key_mode
        try:
            conn = get_connection()
            row = conn.execute("SELECT key_mode FROM composio_state WHERE id = 1").fetchone()
            if row and row["key_mode"]:
                self._key_mode = str(row["key_mode"])
                return self._key_mode
        except Exception:
            pass

        key = self.get_api_key()
        if key:
            mode = self._detect_key_mode(key)
            self._key_mode = mode
            return mode
        return "project"

    def _client_kwargs_for_key(self, key: str) -> dict[str, Any]:
        """Produce the appropriate Composio constructor kwargs for a key."""
        cleaned = sanitize_composio_key(key)
        mode = self.get_key_mode()
        if mode == "user" or (mode is None and cleaned.startswith(("uak_", "uak-"))):
            return {"disable_api_key": True, "user_api_key": cleaned}
        if mode == "org" or (mode is None and cleaned.startswith(("oak_", "oak-"))):
            return {"disable_api_key": True, "user_api_key": cleaned, "org_api_key": cleaned}
        return {"api_key": cleaned}

    def get_api_key(self) -> str | None:
        """Retrieve the configured Composio API key from environment or keychain."""
        from_env = (
            os.environ.get("COMPOSIO_API_KEY", "").strip()
            or os.environ.get("COMPOSIO_USER_API_KEY", "").strip()
            or os.environ.get("COMPOSIO_CONSUMER_API_KEY", "").strip()
        )
        if from_env:
            return sanitize_composio_key(from_env)
        secret = secrets.get_secret(SECRET_KEY_REF)
        return sanitize_composio_key(secret) if secret else None

    def set_api_key(self, key: str, mode: str | None = None) -> bool:
        """Store the Composio API key in the OS keychain and persist key_mode to database."""
        cleaned = sanitize_composio_key(key)
        if not cleaned:
            return False
        secrets.set_secret(SECRET_KEY_REF, cleaned)
        self._cached_client = None
        self._cached_session = None
        self._connections_cache = None
        self._catalog_cache = None

        target_mode = mode or getattr(self, "_key_mode", None) or self._detect_key_mode(cleaned)
        self._key_mode = target_mode

        conn = get_connection()
        conn.execute(
            """
            INSERT INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, key_mode, updated_at)
            VALUES (1, '', '', '[]', '', ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                key_mode = excluded.key_mode,
                session_id = '',
                mcp_url = '',
                updated_at = excluded.updated_at
            """,
            (target_mode,),
        )
        conn.commit()
        return True

    def validate_api_key(self, key: str) -> tuple[bool, str | None]:
        """Verify that the API key is accepted by the appropriate Composio API."""
        cleaned = sanitize_composio_key(key)
        if not cleaned:
            return False, "API key cannot be empty"

        # Consumer keys (ck_*) target the Composio Connect MCP gateway directly
        if cleaned.startswith(("ck_", "ck-")):
            valid, err = _validate_consumer_key(cleaned)
            if valid:
                self._key_mode = "consumer"
                return True, None
            return False, err

        try:
            from composio import Composio
        except ImportError:
            return False, "Composio package is not installed. Please install 'composio>=0.22.0'."

        # Candidate client initializations to try in order of likelihood
        if cleaned.startswith(("uak_", "uak-")):
            candidates = [
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("project", lambda k: Composio(api_key=k)),
            ]
        elif cleaned.startswith(("oak_", "oak-")):
            candidates = [
                ("org", lambda k: Composio(disable_api_key=True, user_api_key=k, org_api_key=k)),
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("project", lambda k: Composio(api_key=k)),
            ]
        else:
            candidates = [
                ("project", lambda k: Composio(api_key=k)),
                ("user", lambda k: Composio(disable_api_key=True, user_api_key=k)),
                ("consumer", None),
            ]

        last_exc: Exception | None = None
        for mode, factory in candidates:
            if mode == "consumer":
                valid, _ = _validate_consumer_key(cleaned)
                if valid:
                    self._key_mode = "consumer"
                    return True, None
                continue

            try:
                client = factory(cleaned)
                # Lightweight API call to verify key credentials
                client.toolkits.list()
                self._key_mode = mode
                return True, None
            except Exception as exc:
                last_exc = exc
                exc_name = type(exc).__name__
                exc_str = str(exc)
                if "AuthenticationError" not in exc_name and "401" not in exc_str:
                    break

        if last_exc is not None:
            detail = _extract_composio_error_message(last_exc)
            if "AuthenticationError" in type(last_exc).__name__ or "401" in str(last_exc):
                if detail:
                    return False, f"Invalid Composio API key: {detail}"
                return False, "Invalid Composio API key. Please check your credentials."
            log.warning("Composio API key validation check failed: %s", detail or last_exc)
            return False, f"Composio validation error: {detail or last_exc}"

        return False, "Invalid Composio API key. Please check your credentials."

    def delete_api_key(self) -> None:
        """Remove the Composio API key and clear local session state."""
        secrets.delete_secret(SECRET_KEY_REF)
        self._cached_client = None
        self._cached_session = None
        self._connections_cache = None
        self._catalog_cache = None
        self._key_mode = None
        conn = get_connection()
        conn.execute("DELETE FROM composio_state WHERE id = 1")
        conn.commit()

    def is_configured(self) -> bool:
        """Check whether an API key is available."""
        return bool(self.get_api_key())

    def _get_client(self) -> Any:
        """Instantiate the Composio client using the modern SDK."""
        key = self.get_api_key()
        if not key:
            raise RuntimeError("Composio API key is not configured.")
        if self._cached_client is not None:
            return self._cached_client
        try:
            from composio import Composio

            kwargs = self._client_kwargs_for_key(key)
            client = Composio(**kwargs)
            self._cached_client = client
            return client
        except ImportError as exc:
            raise RuntimeError(
                "Composio package is not installed. Please install 'composio>=0.22.0'."
            ) from exc

    def get_enabled_toolkits(self) -> list[str]:
        """Fetch list of enabled toolkit slugs from database or defaults."""
        conn = get_connection()
        row = conn.execute("SELECT enabled_toolkits FROM composio_state WHERE id = 1").fetchone()
        if row and row["enabled_toolkits"]:
            try:
                parsed = json.loads(row["enabled_toolkits"])
                if isinstance(parsed, list):
                    return parsed
            except (ValueError, TypeError):
                pass
        return list(DEFAULT_TOOLKITS)

    def _canonical_toolkit_slug(self, slug: str) -> str:
        """Map toolkit aliases (e.g. 'x' -> 'twitter') to canonical Composio slug."""
        s = slug.strip().lower()
        return "twitter" if s == "x" else s

    def _trusted_auth_url(self, value: str | None, slug: str) -> str:
        """Validate that authorization redirect URL points to a secure Composio domain."""
        if not value:
            raise RuntimeError(f"Composio returned no authorization link for {slug}")
        import urllib.parse
        parsed = urllib.parse.urlparse(value)
        if parsed.scheme != "https":
            raise RuntimeError(f"Composio returned non-HTTPS authorization link: {value}")
        host = parsed.netloc.lower()
        if host != "composio.dev" and not host.endswith(".composio.dev"):
            raise RuntimeError(f"Composio returned untrusted authorization host: {host}")
        return value

    def _auth_headers(self, json: bool = False) -> dict[str, str]:
        """Produce proper HTTP headers for Composio API based on key type."""
        key = self.get_api_key()
        if not key:
            return {}
        mode = getattr(self, "_key_mode", None) or self._detect_key_mode(key)
        # User API keys (uak_*) authenticate with x-user-api-key; project keys (ak_*) with x-api-key
        header = "x-user-api-key" if mode == "user" or key.startswith(("uak_", "uak-")) else "x-api-key"
        headers = {header: key}
        if json:
            headers["content-type"] = "application/json"
        return headers

    def _get_stable_user_id(self) -> str:
        """Generate a persistent, stable identifier for this Amethyst instance."""
        node = os.environ.get("AMETHYST_USER_ID")
        if node:
            return node
        conn = get_connection()
        row = conn.execute("SELECT user_id FROM composio_state WHERE id = 1").fetchone()
        if row and row["user_id"]:
            return row["user_id"]
        return f"amethyst_{uuid.uuid4().hex[:12]}"

    def get_or_create_session(
        self,
        enabled_toolkits: list[str] | None = None,
        force_refresh: bool = False,
    ) -> Any:
        """Get the active Composio session or create a new tool router session.

        Adopts OpenMausBot's tool router configuration (unrestricted toolkits with
        multi_account and manage_connections enabled) so any OAuth service can be
        linked and invoked on demand.
        """
        conn = get_connection()
        row = conn.execute("SELECT session_id, user_id, mcp_url FROM composio_state WHERE id = 1").fetchone()
        user_id = (row["user_id"] if row and row["user_id"] else None) or self._get_stable_user_id()

        # Resume existing session unless forced refresh
        if not force_refresh and self._cached_session is not None:
            return self._cached_session
        if not force_refresh and row and row["session_id"]:
            try:
                client = self._get_client()
                session = client.use(row["session_id"], mcp=True)
                self._cached_session = session
                return session
            except Exception as exc:
                log.warning("Could not resume Composio session %s: %s; recreating.", row["session_id"], exc)

        # Create fresh session via OpenMausBot HTTP tool router API
        headers = self._auth_headers(json=True)
        toolkits = enabled_toolkits if enabled_toolkits is not None else self.get_enabled_toolkits()
        if headers:
            try:
                import httpx
                payload: dict[str, Any] = {
                    "user_id": user_id,
                    "manage_connections": {
                        "enable": True,
                        "enable_wait_for_connections": True,
                        "enable_connection_removal": True,
                    },
                    "multi_account": {
                        "enable": True,
                        "max_accounts_per_toolkit": 5,
                        "require_explicit_selection": True,
                    },
                }
                if enabled_toolkits:
                    payload["toolkits"] = {"enable": enabled_toolkits}

                res = httpx.post(
                    "https://backend.composio.dev/api/v3.1/tool_router/session",
                    headers=headers,
                    json=payload,
                    timeout=15.0,
                )
                if res.status_code in (200, 201):
                    data = res.json()
                    new_session_id = data.get("session_id")
                    mcp_url = data.get("mcp", {}).get("url", "")
                    conn.execute(
                        """
                        INSERT INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, updated_at)
                        VALUES (1, ?, ?, ?, ?, datetime('now'))
                        ON CONFLICT(id) DO UPDATE SET
                            session_id = excluded.session_id,
                            user_id = excluded.user_id,
                            enabled_toolkits = excluded.enabled_toolkits,
                            mcp_url = excluded.mcp_url,
                            updated_at = excluded.updated_at
                        """,
                        (new_session_id, user_id, json.dumps(toolkits), mcp_url),
                    )
                    conn.commit()
                    from types import SimpleNamespace
                    return SimpleNamespace(
                        session_id=new_session_id,
                        user_id=user_id,
                        mcp=SimpleNamespace(url=mcp_url, type="http", headers=self._auth_headers()),
                    )
            except Exception as exc:
                log.warning("Direct HTTP session creation failed: %s; falling back to SDK.", exc)

        # Fallback to python SDK
        client = self._get_client()
        create_kwargs: dict[str, Any] = {"user_id": user_id, "mcp": True}
        if toolkits:
            create_kwargs["toolkits"] = {"enable": toolkits}
        session = client.sessions.create(**create_kwargs)

        mcp_url = getattr(getattr(session, "mcp", None), "url", "")
        conn.execute(
            """
            INSERT INTO composio_state (id, session_id, user_id, enabled_toolkits, mcp_url, updated_at)
            VALUES (1, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                user_id = excluded.user_id,
                enabled_toolkits = excluded.enabled_toolkits,
                mcp_url = excluded.mcp_url,
                updated_at = excluded.updated_at
            """,
            (session.session_id, user_id, json.dumps(toolkits), mcp_url),
        )
        conn.commit()
        return session

    def update_toolkits(self, toolkits: list[str]) -> bool:
        """Update active toolkits on the current session and persist to database."""
        client = self._get_client()
        conn = get_connection()
        row = conn.execute("SELECT session_id, user_id FROM composio_state WHERE id = 1").fetchone()

        if row and row["session_id"]:
            try:
                session = client.use(row["session_id"])
                session.update(toolkits={"enable": toolkits})
            except Exception as exc:
                log.warning("Failed to update toolkits on session %s: %s; refreshing session.", row["session_id"], exc)
                self.get_or_create_session(enabled_toolkits=toolkits)
                return True
        else:
            self.get_or_create_session(enabled_toolkits=toolkits)

        conn.execute(
            "UPDATE composio_state SET enabled_toolkits = ?, updated_at = datetime('now') WHERE id = 1",
            (json.dumps(toolkits),),
        )
        conn.commit()
        return True

    def get_mcp_config(self) -> dict[str, Any] | None:
        """Return MCP server configuration dict for Amethyst's MCP manager."""
        if not self.is_configured():
            return None
        key = self.get_api_key()
        if not key:
            return None

        mode = self.get_key_mode()
        if mode == "consumer" or key.startswith(("ck_", "ck-")):
            return {
                "transport": "streamable-http",
                "url": "https://connect.composio.dev/mcp",
                "headers": {
                    "x-consumer-api-key": key,
                },
            }

        conn = get_connection()
        row = conn.execute("SELECT session_id, mcp_url FROM composio_state WHERE id = 1").fetchone()
        if row and row["mcp_url"]:
            return {
                "transport": "streamable-http",
                "url": row["mcp_url"],
                "headers": self._auth_headers(),
            }

        try:
            session = self.get_or_create_session()
            mcp_info = getattr(session, "mcp", None)
            if not mcp_info or not getattr(mcp_info, "url", None):
                return None
            headers = dict(getattr(mcp_info, "headers", {}) or {})
            has_auth = any(
                k.lower() in ("x-api-key", "x-user-api-key", "x-org-api-key", "authorization", "x-consumer-api-key")
                for k in headers
            )
            if not has_auth:
                if key.startswith(("uak_", "uak-")):
                    headers["x-user-api-key"] = key
                elif key.startswith(("oak_", "oak-")):
                    headers["x-org-api-key"] = key
                else:
                    headers["x-api-key"] = key
            return {
                "transport": "streamable-http",
                "url": mcp_info.url,
                "headers": headers,
            }
        except Exception as exc:
            log.error("Failed to resolve Composio MCP config: %s", exc)
            return None

    def get_status(self) -> dict[str, Any]:
        """Return high-level connection and configuration status without network roundtrips."""
        configured = self.is_configured()
        if not configured:
            return {
                "configured": False,
                "active": False,
                "key_mode": "project",
                "session_id": None,
                "enabled_toolkits": [],
                "error": None,
            }
        mode = self.get_key_mode()
        if mode == "consumer":
            return {
                "configured": True,
                "active": True,
                "key_mode": "consumer",
                "session_id": "connect-gateway",
                "enabled_toolkits": self.get_enabled_toolkits(),
                "error": None,
            }

        conn = get_connection()
        row = conn.execute("SELECT session_id, mcp_url FROM composio_state WHERE id = 1").fetchone()
        session_id = row["session_id"] if row else None
        mcp_url = row["mcp_url"] if row else None

        return {
            "configured": True,
            "active": bool(mcp_url or session_id),
            "key_mode": mode,
            "session_id": session_id,
            "enabled_toolkits": self.get_enabled_toolkits(),
            "error": None,
        }

    def get_connections(self, force: bool = False) -> dict[str, dict[str, Any]]:
        """Return dict of {toolkit_slug: connection_details} for ACTIVE accounts only."""
        if not self.is_configured():
            return {}
        now = time.monotonic()
        if not force and self._connections_cache is not None and now < self._connections_cache[0]:
            return self._connections_cache[1]

        active: dict[str, dict[str, Any]] = {}
        headers = self._auth_headers()
        user_id = self._get_stable_user_id()

        # Strategy 1: OpenMausBot HTTP query to connected_accounts
        if headers:
            try:
                import httpx
                params = {
                    "limit": "50",
                    "user_ids": user_id,
                    "order_by": "updated_at",
                    "order_direction": "desc",
                }
                res = httpx.get(
                    "https://backend.composio.dev/api/v3.1/connected_accounts",
                    headers=headers,
                    params=params,
                    timeout=8.0,
                )
                if res.status_code == 200:
                    data = res.json()
                    for item in data.get("items", []):
                        status = (item.get("status") or "").upper()
                        if status == "ACTIVE":
                            tk = item.get("toolkit") or {}
                            slug = tk.get("slug") if isinstance(tk, dict) else tk
                            if slug:
                                s_slug = str(slug).lower()
                                active[s_slug] = {
                                    "id": item.get("id", ""),
                                    "status": "ACTIVE",
                                    "created_at": item.get("created_at"),
                                    "updated_at": item.get("updated_at"),
                                    "word_id": item.get("word_id"),
                                    "alias": item.get("alias"),
                                }
                    self._connections_cache = (now + 30.0, active)
                    return active
            except Exception as exc:
                log.debug("HTTP connected accounts listing failed: %s; falling back to SDK", exc)

        # Strategy 2: Python SDK fallback (e.g. for mock tests)
        mode = self.get_key_mode()
        if mode != "consumer":
            try:
                client = self._get_client()
                try:
                    accounts = client.connected_accounts.list(user_ids=[user_id], statuses=["ACTIVE"])
                except Exception as exc:
                    log.debug("User-scoped connection list failed, querying project connections: %s", exc)
                    accounts = client.connected_accounts.list(statuses=["ACTIVE"])
                for item in getattr(accounts, "items", []):
                    toolkit = getattr(item, "toolkit", None)
                    slug = getattr(toolkit, "slug", None) if toolkit else None
                    if not slug and isinstance(toolkit, str):
                        slug = toolkit
                    status = getattr(item, "status", "")
                    if slug and (status == "ACTIVE" or not status):
                        active[str(slug).lower()] = {
                            "id": getattr(item, "id", ""),
                            "status": status or "ACTIVE",
                            "created_at": getattr(item, "created_at", None),
                        }
            except Exception as exc:
                log.warning("Failed to fetch Composio connected accounts via SDK: %s", exc)

        self._connections_cache = (now + 30.0, active)
        return active

    def initiate_connection(self, toolkit: str, alias: str | None = None) -> str:
        """Initiate hosted OAuth authorization with Composio and return redirect URL.

        Uses OpenMausBot's tool router session link technique:
        POST /api/v3.1/tool_router/session/{session_id}/link with {"toolkit": slug, "alias": alias}
        Returns the browser OAuth link (e.g. https://connect.composio.dev/link/...).
        """
        slug = self._canonical_toolkit_slug(toolkit)
        if not self.is_configured():
            raise RuntimeError("Composio is not configured with an API key. Connect Composio first.")

        headers = self._auth_headers(json=True)
        user_id = self._get_stable_user_id()

        # Strategy 1: OpenMausBot Tool Router Session Link API
        if headers:
            try:
                import httpx
                session = self.get_or_create_session()
                session_id = getattr(session, "session_id", None)
                if session_id:
                    link_url = f"https://backend.composio.dev/api/v3.1/tool_router/session/{session_id}/link"
                    link_payload: dict[str, Any] = {"toolkit": slug}
                    if alias and str(alias).strip():
                        link_payload["alias"] = str(alias).strip()
                    res = httpx.post(link_url, headers=headers, json=link_payload, timeout=15.0)

                    # If session restricted or expired, recreate session and retry once
                    if res.status_code in (400, 404):
                        err_text = res.text
                        if "ToolkitNotAllowed" in err_text or "Session Restriction" in err_text or res.status_code == 404:
                            log.info("Composio session restricted or expired for %s; recreating session...", slug)
                            session = self.get_or_create_session(force_refresh=True)
                            session_id = getattr(session, "session_id", None)
                            link_url = f"https://backend.composio.dev/api/v3.1/tool_router/session/{session_id}/link"
                            res = httpx.post(link_url, headers=headers, json=link_payload, timeout=15.0)

                    if res.status_code in (200, 201):
                        data = res.json()
                        redirect_url = data.get("redirect_url")
                        if redirect_url:
                            return self._trusted_auth_url(str(redirect_url), slug)
                    else:
                        err_text = res.text
                        try:
                            err_json = res.json()
                            err_text = err_json.get("error", {}).get("message") or err_json.get("message") or err_text
                        except Exception:
                            pass
                        log.warning("Tool router link request for %s returned HTTP %s: %s", slug, res.status_code, err_text)
                        if res.status_code in (400, 401, 403, 404, 409):
                            if res.status_code == 401 or "invalid or revoked" in err_text.lower():
                                raise RuntimeError("Composio API key is invalid or revoked. Please log in to Composio or update your API key.")
                            raise RuntimeError(f"Composio connection failed for {slug}: {err_text}")
            except RuntimeError:
                raise
            except Exception as exc:
                log.debug("HTTP tool router link flow failed for %s: %s; trying SDK fallback", slug, exc)

        # Strategy 2: Modern composio-client Link API via auth_configs (SDK fallback)
        try:
            client = self._get_client()
            raw_client = getattr(client, "client", client)
            if hasattr(raw_client, "auth_configs") and hasattr(raw_client, "link"):
                configs_res = raw_client.auth_configs.list(toolkit_slug=slug)
                items = getattr(configs_res, "items", []) or []
                if items:
                    auth_cfg = items[0]
                    auth_cfg_id = getattr(auth_cfg, "id", None) or (auth_cfg.get("id") if isinstance(auth_cfg, dict) else None)
                    if auth_cfg_id:
                        link_res = raw_client.link.create(user_id=user_id, auth_config_id=auth_cfg_id)
                        redirect_url = getattr(link_res, "redirect_url", None)
                        if redirect_url:
                            return self._trusted_auth_url(str(redirect_url), slug)
        except Exception as exc:
            if "401" in str(exc) or "AuthenticationError" in type(exc).__name__:
                raise RuntimeError("Composio API key is invalid or revoked. Please log in to Composio or update your API key.")
            log.debug("Composio SDK link.create flow failed for %s: %s", slug, exc)

        # Strategy 3: High-level session.authorize if available (SDK fallback)
        try:
            client = self._get_client()
            if hasattr(client, "create"):
                session = client.create(user_id=user_id)
                if hasattr(session, "authorize"):
                    req = session.authorize(slug)
                    redirect_url = getattr(req, "redirect_url", None)
                    if redirect_url:
                        return self._trusted_auth_url(str(redirect_url), slug)
        except Exception as exc:
            if "401" in str(exc) or "AuthenticationError" in type(exc).__name__:
                raise RuntimeError("Composio API key is invalid or revoked. Please log in to Composio or update your API key.")
            log.debug("Composio session.authorize failed for %s: %s", slug, exc)

        # Strategy 4: Legacy toolkits.authorize (SDK fallback)
        try:
            client = self._get_client()
            if hasattr(client, "toolkits") and hasattr(client.toolkits, "authorize"):
                req = client.toolkits.authorize(user_id=user_id, toolkit=slug)
                redirect_url = getattr(req, "redirect_url", None)
                if not redirect_url and hasattr(req, "connection_data"):
                    val = getattr(req.connection_data, "val", None)
                    if val:
                        redirect_url = getattr(val, "redirect_url", None)
                if redirect_url:
                    return self._trusted_auth_url(str(redirect_url), slug)
        except Exception as exc:
            if "401" in str(exc) or "AuthenticationError" in type(exc).__name__:
                raise RuntimeError("Composio API key is invalid or revoked. Please log in to Composio or update your API key.")
            log.debug("Legacy toolkits.authorize failed for %s: %s", slug, exc)

        raise RuntimeError(f"Could not generate Composio authorization URL for {slug}. Please log in to Composio or check your connection.")

    def remove_connected_account(self, account_id: str) -> bool:
        """Revoke and delete a connected account by its ID."""
        if not self.is_configured() or not account_id:
            return False
        headers = self._auth_headers()
        try:
            import httpx
            res = httpx.delete(
                f"https://backend.composio.dev/api/v3.1/connected_accounts/{account_id}?revoke_on_delete=true",
                headers=headers,
                timeout=15.0,
            )
            self._connections_cache = None
            return res.status_code in (200, 204)
        except Exception as exc:
            log.warning("Failed to remove Composio connected account %s: %s", account_id, exc)
            return False

    def disconnect_toolkit(self, toolkit: str) -> bool:
        """Disconnect all active accounts for a toolkit slug."""
        slug = self._canonical_toolkit_slug(toolkit)
        conns = self.get_connections(force=True)
        conn_info = conns.get(slug)
        if not conn_info or not conn_info.get("id"):
            # Check un-cached directly from accounts list
            headers = self._auth_headers()
            user_id = self._get_stable_user_id()
            if headers:
                try:
                    import httpx
                    res = httpx.get(
                        f"https://backend.composio.dev/api/v3.1/connected_accounts?user_ids={user_id}&toolkit_slugs={slug}",
                        headers=headers,
                        timeout=8.0,
                    )
                    if res.status_code == 200:
                        items = res.json().get("items", []) or []
                        deleted_any = False
                        for it in items:
                            act_id = it.get("id")
                            if act_id and self.remove_connected_account(act_id):
                                deleted_any = True
                        if deleted_any:
                            return True
                except Exception:
                    pass
            return False
        return self.remove_connected_account(conn_info["id"])

    def start_browser_login(self) -> dict[str, Any]:
        """Initiate Composio CLI-style browser login session.

        Creates an authentication session on backend.composio.dev and returns
        the direct web URL for Google/web login alongside the verification code.
        """
        import httpx

        url = "https://backend.composio.dev/api/v3/cli/create-session"
        try:
            resp = httpx.post(url, json={"scope": "user", "source": "amethyst"}, timeout=10.0)
            if resp.status_code in (200, 201):
                data = resp.json()
                session_id = str(data.get("id", ""))
                code = str(data.get("code", ""))
                login_url = f"https://dashboard.composio.dev/?cliKey={session_id}"
                return {
                    "session_id": session_id,
                    "code": code,
                    "login_url": login_url,
                    "expires_at": data.get("expiresAt"),
                }
            raise RuntimeError(f"Composio returned status {resp.status_code}: {resp.text}")
        except Exception as exc:
            log.error("Failed to create Composio browser login session: %s", exc)
            raise RuntimeError(f"Could not initialize Composio browser login: {exc}") from exc

    def poll_browser_login(self, session_id: str) -> dict[str, Any]:
        """Poll the Composio CLI authentication session for completion.

        When the user completes Google login on Composio, status transitions to
        'linked' and returns the user API key. Automatically saves the key.
        """
        import httpx

        cleaned_id = session_id.strip()
        if not cleaned_id:
            return {"status": "error", "error": "session_id is required"}

        url = f"https://backend.composio.dev/api/v3/cli/get-session?id={cleaned_id}"
        try:
            resp = httpx.get(url, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                status = str(data.get("status", "pending"))
                if status == "linked":
                    api_key = data.get("api_key")
                    if api_key:
                        self.set_api_key(str(api_key), mode="user")
                        return {
                            "status": "linked",
                            "configured": True,
                            "session_id": cleaned_id,
                        }
                    return {"status": "pending", "session_id": cleaned_id}
                if status in ("expired", "rejected", "failed"):
                    return {"status": status, "session_id": cleaned_id}
                return {"status": "pending", "session_id": cleaned_id}
            if resp.status_code == 404:
                return {"status": "expired", "session_id": cleaned_id}
            return {"status": "pending", "session_id": cleaned_id}
        except Exception as exc:
            log.warning("Composio browser login poll error for %s: %s", cleaned_id, exc)
            return {"status": "pending", "session_id": cleaned_id, "error": str(exc)}

    def _get_fallback_catalog_cards(self) -> list[dict[str, Any]]:
        """Produce catalog cards for all defined toolkits, complete with category and domains."""
        cards = []
        for t in get_toolkits_catalog():
            slug = t["slug"]
            domain = _DOMAIN_MAPPING.get(slug)
            cards.append({
                "slug": slug,
                "label": t.get("name") or slug.title(),
                "blurb": t.get("description") or "",
                "category": t.get("category") or "Productivity",
                "logo": f"https://logos.composio.dev/api/{slug}",
                "noAuth": bool(t.get("no_auth")),
                "domain": domain,
            })
        return cards

    def list_catalog(self, search: str | None = None) -> dict[str, Any]:
        """Fetch marketplace catalog of toolkits with logos, falling back to curated cards.

        Matches OpenMausBot /api/connectors/catalog contract.
        Supports optional search to query live toolkits across the Composio marketplace.
        """
        now = time.monotonic()
        search_query = (search or "").strip().lower()
        if not search_query and self._catalog_cache is not None and now < self._catalog_cache[0]:
            return self._catalog_cache[1]

        cards: list[dict[str, Any]] = []
        source = "curated"
        configured = self.is_configured()

        if configured:
            headers = self._auth_headers()
            if headers:
                try:
                    import httpx
                    from urllib.parse import quote, urlparse

                    if search_query:
                        url = f"https://backend.composio.dev/api/v3/toolkits?search={quote(search_query)}&limit=100"
                    else:
                        url = "https://backend.composio.dev/api/v3/toolkits?limit=500&sort_by=usage"
                    res = httpx.get(url, headers=headers, timeout=12.0)
                    if res.status_code == 200:
                        data = res.json()
                        items = data.get("items") or data.get("data") or []
                        if isinstance(items, list) and items:
                            seen: set[str] = set()
                            for t in items:
                                raw_slug = str(t.get("slug") or t.get("key") or t.get("name") or "")
                                slug = self._canonical_toolkit_slug(raw_slug)
                                if not slug or slug in seen:
                                    continue
                                seen.add(slug)
                                meta = t.get("meta") or {}
                                blurb = (meta.get("description") or t.get("description") or "")[:140]
                                cats = meta.get("categories") or []
                                cat = (
                                    cats[0].get("name")
                                    if (cats and isinstance(cats[0], dict) and cats[0].get("name"))
                                    else (t.get("category") or "Productivity")
                                )
                                app_url = meta.get("app_url") or ""
                                domain = _DOMAIN_MAPPING.get(slug)
                                if not domain and app_url:
                                    try:
                                        domain = urlparse(app_url).netloc or None
                                    except Exception:
                                        pass
                                cards.append({
                                    "slug": slug,
                                    "label": t.get("name") or slug.title(),
                                    "blurb": blurb,
                                    "category": cat.title() if isinstance(cat, str) else "Productivity",
                                    "logo": meta.get("logo") or t.get("logo") or f"https://logos.composio.dev/api/{slug}",
                                    "noAuth": bool(t.get("no_auth")),
                                    "domain": domain,
                                })
                            source = "api"
                except Exception as exc:
                    log.debug("Live toolkits catalog fetch failed: %s; falling back to curated", exc)

        all_local_cards = self._get_fallback_catalog_cards()
        if not cards:
            if search_query:
                cards = [
                    c for c in all_local_cards
                    if search_query in c["slug"].lower()
                    or search_query in c["label"].lower()
                    or search_query in (c.get("blurb") or "").lower()
                    or search_query in (c.get("category") or "").lower()
                ]
            else:
                cards = all_local_cards
            source = "curated"
        else:
            existing_slugs = {c["slug"] for c in cards}
            for loc in all_local_cards:
                if loc["slug"] not in existing_slugs:
                    if not search_query or (
                        search_query in loc["slug"].lower()
                        or search_query in loc["label"].lower()
                        or search_query in (loc.get("blurb") or "").lower()
                        or search_query in (loc.get("category") or "").lower()
                    ):
                        cards.append(loc)

        pagination = {
            "items": len(cards),
            "stalled": False,
            "complete": True,
        }
        res_data = {
            "configured": configured,
            "mode": "self-hosted" if configured else "unavailable",
            "setup": "ready" if configured else "needs-setup",
            "source": source,
            "cards": cards,
            "pagination": pagination,
        }
        if not search_query:
            self._catalog_cache = (now + 600.0, res_data)
        return res_data

    def get_connected_services_state(self, force: bool = False) -> dict[str, Any]:
        """Enumerate user's connected accounts and toolkits matching OpenMausBot contract."""
        configured = self.is_configured()
        if not configured:
            return {
                "configured": False,
                "credentialStore": "ok",
                "services": {},
            }

        headers = self._auth_headers()
        user_id = self._get_stable_user_id()
        services: dict[str, dict[str, Any]] = {}

        # Add non-auth toolkits if configured
        for t in NON_OAUTH_TOOLKITS:
            slug = t["slug"]
            services[slug] = {
                "connected": True,
                "pending": False,
                "status": "ACTIVE",
                "accounts": [],
            }

        if headers:
            try:
                import httpx

                params = {
                    "limit": "100",
                    "user_ids": user_id,
                    "order_by": "updated_at",
                    "order_direction": "desc",
                }
                res = httpx.get(
                    "https://backend.composio.dev/api/v3.1/connected_accounts",
                    headers=headers,
                    params=params,
                    timeout=10.0,
                )
                if res.status_code == 200:
                    data = res.json()
                    for item in data.get("items", []):
                        tk = item.get("toolkit") or {}
                        slug = tk.get("slug") if isinstance(tk, dict) else tk
                        if not slug:
                            continue
                        canonical_slug = self._canonical_toolkit_slug(str(slug))
                        status = (item.get("status") or "ACTIVE").upper()
                        account_id = str(item.get("id", ""))
                        alias = item.get("alias")
                        acc_entry: dict[str, Any] = {
                            "id": account_id,
                            "status": status,
                        }
                        if alias:
                            acc_entry["alias"] = str(alias)

                        if canonical_slug not in services:
                            services[canonical_slug] = {
                                "connected": status == "ACTIVE",
                                "pending": status in ("INITIATED", "INITIALIZING", "PENDING"),
                                "status": status,
                                "accounts": [],
                            }
                        services[canonical_slug]["accounts"].append(acc_entry)
                        if status == "ACTIVE":
                            services[canonical_slug]["connected"] = True
                            services[canonical_slug]["status"] = "ACTIVE"
            except Exception as exc:
                log.debug("HTTP connected accounts query failed: %s", exc)

        return {
            "configured": True,
            "credentialStore": "ok",
            "services": services,
        }

    def get_service_status(self, slugs: list[str]) -> dict[str, Any]:
        """Query status for specific service slugs."""
        all_state = self.get_connected_services_state()
        if not all_state.get("configured"):
            return {
                "configured": False,
                "credentialStore": "ok",
                "services": {},
            }
        services = all_state.get("services", {})
        res: dict[str, Any] = {}
        for s in slugs:
            c_slug = self._canonical_toolkit_slug(s)
            res[s] = services.get(c_slug, {
                "connected": False,
                "pending": False,
                "status": "not_connected",
                "accounts": [],
            })
        return {
            "configured": True,
            "services": res,
        }

    def authorize_service(self, slug: str, alias: str | None = None) -> dict[str, Any]:
        """Authorize a service and return { url }."""
        url = self.initiate_connection(slug, alias=alias)
        return {"url": url}

    def remove_account(self, slug: str, account_id: str) -> dict[str, Any]:
        """Remove a single connected account."""
        removed = self.remove_connected_account(account_id)
        return {"removed": 1 if removed else 0}

    def remove_service(self, slug: str) -> dict[str, Any]:
        """Disconnect all accounts for a service."""
        removed = self.disconnect_toolkit(slug)
        return {"removed": 1 if removed else 0}

    def list_connector_tools(self) -> dict[str, Any]:
        """List grantable connector tools grouped by service slug."""
        now = time.monotonic()
        if self._tools_cache is not None and now < self._tools_cache[0]:
            return self._tools_cache[1]
        
        tools_map: dict[str, list[dict[str, str]]] = {}
        # Fetch enabled/connected toolkits catalog tools
        catalog = get_toolkits_catalog()
        for t in catalog:
            slug = t["slug"]
            tools_map[slug] = [
                {"name": f"{slug.upper()}_ACTION", "description": t.get("description", "")}
            ]
        self._tools_cache = (now + 60.0, tools_map)
        return tools_map


composio_service = ComposioService()
