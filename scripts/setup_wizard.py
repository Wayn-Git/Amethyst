#!/usr/bin/env python3
# ruff: noqa: E402
"""PSOK Interactive Setup Wizard.

Guides users and collaborators through configuring:
1. AI Models & Providers (Ollama, Anthropic, OpenAI, Groq, etc.)
2. App Connectors & OAuth (Google Workspace, Microsoft To Do, GitHub, Spotify)
3. Cloudflare Workers AI & Embeddings
4. Cloudflare Relay & Instagram Capture (for 24/7 Library ingest)
5. Library & Social Bookmarks (X, browser bookmarks)
6. System Diagnostics (PSOK Doctor)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure repo root is on sys.path
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.mcp import commands as mcp_cmds
from backend.secrets import get_secret, set_secret

ENV_PATH = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"


def read_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        if ENV_EXAMPLE.exists():
            import shutil
            shutil.copy(ENV_EXAMPLE, ENV_PATH)
        else:
            ENV_PATH.touch()
    out = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip("\"'")
    return out


def write_env_key(key: str, value: str) -> None:
    lines = []
    found = False
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(f"{key}=") or line.strip() == key:
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def prompt_input(prompt: str, default: str = "") -> str:
    if default:
        p = f"{prompt} [{default}]: "
    else:
        p = f"{prompt}: "
    val = input(p).strip()
    return val if val else default


def print_header(title: str) -> None:
    print("\n" + "=" * 64)
    print(f"  {title}")
    print("=" * 64)


# ----------------------------------------------------------------------
# 1. AI Models Setup
# ----------------------------------------------------------------------
def setup_models() -> None:
    print_header("1. AI Model Providers Configuration")
    print("PSOK supports 100% free local models (Ollama) and cloud APIs.\n")
    print("Select an option:")
    print("  1) Configure Ollama (100% Free & Local - No API keys needed)")
    print("  2) Set Anthropic Claude API Key")
    print("  3) Set OpenAI API Key")
    print("  4) Set Groq API Key (Ultra-fast inference)")
    print("  5) Set Google Gemini API Key")
    print("  6) Set OpenRouter API Key (Access to 300+ models)")
    print("  7) Return to Main Menu")

    choice = prompt_input("Enter choice (1-7)", "1")
    env = read_env()

    if choice == "1":
        print("\n[Ollama Local Setup]")
        print("1. Install Ollama from https://ollama.ai")
        print("2. Run in a terminal: ollama run llama3.2 (or qwen2.5)")
        print("3. PSOK connects automatically to http://127.0.0.1:11434.")
        input("Press Enter to continue...")

    elif choice == "2":
        current = env.get("ANTHROPIC_API_KEY", "") or (get_secret("psok/anthropic") or "")
        display = (current[:8] + "..." + current[-4:]) if len(current) > 12 else (current or "None")
        print(f"\nCurrent Anthropic Key: {display}")
        key = prompt_input("Enter Anthropic API Key (sk-ant-...) [leave blank to keep]")
        if key:
            write_env_key("ANTHROPIC_API_KEY", key)
            set_secret("psok/anthropic", key)
            print("✓ Saved Anthropic API Key.")

    elif choice == "3":
        current = env.get("OPENAI_API_KEY", "") or (get_secret("psok/openai") or "")
        display = (current[:8] + "..." + current[-4:]) if len(current) > 12 else (current or "None")
        print(f"\nCurrent OpenAI Key: {display}")
        key = prompt_input("Enter OpenAI API Key (sk-...) [leave blank to keep]")
        if key:
            write_env_key("OPENAI_API_KEY", key)
            set_secret("psok/openai", key)
            print("✓ Saved OpenAI API Key.")

    elif choice == "4":
        current = env.get("GROQ_API_KEY", "") or (get_secret("psok/groq") or "")
        display = (current[:8] + "..." + current[-4:]) if len(current) > 12 else (current or "None")
        print(f"\nCurrent Groq Key: {display}")
        key = prompt_input("Enter Groq API Key (gsk_...) [leave blank to keep]")
        if key:
            write_env_key("GROQ_API_KEY", key)
            set_secret("psok/groq", key)
            print("✓ Saved Groq API Key.")

    elif choice == "5":
        current = env.get("GEMINI_API_KEY", "") or (get_secret("psok/google") or "")
        display = (current[:8] + "..." + current[-4:]) if len(current) > 12 else (current or "None")
        print(f"\nCurrent Gemini Key: {display}")
        key = prompt_input("Enter Google Gemini API Key (AIzaSy...) [leave blank to keep]")
        if key:
            write_env_key("GEMINI_API_KEY", key)
            set_secret("psok/google", key)
            print("✓ Saved Google Gemini API Key.")

    elif choice == "6":
        current = env.get("OPENROUTER_API_KEY", "") or (get_secret("psok/openrouter") or "")
        display = (current[:8] + "..." + current[-4:]) if len(current) > 12 else (current or "None")
        print(f"\nCurrent OpenRouter Key: {display}")
        key = prompt_input("Enter OpenRouter API Key (sk-or-...) [leave blank to keep]")
        if key:
            write_env_key("OPENROUTER_API_KEY", key)
            set_secret("psok/openrouter", key)
            print("✓ Saved OpenRouter API Key.")


# ----------------------------------------------------------------------
# 2. App Connectors & OAuth Setup
# ----------------------------------------------------------------------
def setup_connectors() -> None:
    print_header("2. App Connectors & OAuth Configuration")
    print("Connect your external apps so the assistant can act on your behalf.")
    print("\nSelect a connector to configure:")
    print("  1) Microsoft To Do (Zero-config public device code flow)")
    print("  2) Google Workspace (Gmail, Calendar, Drive, Docs, Sheets)")
    print("  3) GitHub (Repositories, Issues, Code Search)")
    print("  4) Spotify (Playback, Playlists, Search)")
    print("  5) Web Search (Tavily / Exa API keys)")
    print("  6) Return to Main Menu")

    choice = prompt_input("Enter choice (1-6)", "1")

    if choice == "1":
        print("\n[Microsoft To Do]")
        print("Microsoft To Do uses Microsoft's public device-code client.")
        print("No developer registration is required! You simply sign in with your account.")
        do_add = prompt_input("Add Microsoft To Do connector now? (y/n)", "y").lower() == "y"
        if do_add:
            try:
                mcp_cmds.add_from_catalogue("microsoft-todo")
                print("✓ Microsoft To Do connector added!")
                print("To complete sign-in, open the web app (Connectors tab) or run:")
                print("  psok mcp login microsoft-todo")
            except Exception as e:
                print(f"Note: {e}")

    elif choice == "2":
        print("\n[Google Workspace - Gmail, Calendar, Drive]")
        print("Google OAuth requires an OAuth Client ID & Secret from Google Cloud Console.")
        print("Steps:")
        print("  1. Visit: https://console.cloud.google.com/apis/credentials")
        print("  2. Create OAuth client ID -> Application type: Desktop app")
        print("  3. Set redirect URI (if asked): http://127.0.0.1:33418/oauth/callback")
        print("  4. Enable Gmail, Calendar, and Drive APIs in API Library.")
        client_id = prompt_input("Enter Google Client ID (or leave blank to skip)")
        if client_id:
            client_secret = prompt_input("Enter Google Client Secret")
            write_env_key("PSOK_DEFAULT_GOOGLE_CLIENT_ID", client_id)
            write_env_key("PSOK_DEFAULT_GOOGLE_CLIENT_SECRET", client_secret)
            set_secret("psok/google-client-id", client_id)
            set_secret("psok/google-client-secret", client_secret)
            try:
                mcp_cmds.add_from_catalogue("google-workspace")
                print("✓ Google Workspace connector added with your OAuth credentials!")
                print("To sign in to your Google account, open the Connectors tab in PSOK or run:")
                print("  psok mcp login google-workspace")
            except Exception as e:
                print(f"Note: {e}")

    elif choice == "3":
        print("\n[GitHub Connector]")
        print("1. Generate a Personal Access Token at: https://github.com/settings/tokens")
        print("   (Scopes needed: repo, read:user)")
        token = prompt_input("Enter GitHub Personal Access Token (or leave blank to skip)")
        if token:
            set_secret("psok/github-token", token)
            try:
                mcp_cmds.add_from_catalogue("github")
                mcp_cmds.set_env("github", "GITHUB_PERSONAL_ACCESS_TOKEN", token)
                print("✓ GitHub connector configured and enabled!")
            except Exception as e:
                print(f"Note: {e}")

    elif choice == "4":
        print("\n[Spotify Connector]")
        print("1. Create an app in https://developer.spotify.com/dashboard")
        print("2. Set Redirect URI to: http://127.0.0.1:33418/oauth/callback")
        client_id = prompt_input("Enter Spotify Client ID (or leave blank to skip)")
        if client_id:
            client_secret = prompt_input("Enter Spotify Client Secret")
            write_env_key("PSOK_DEFAULT_SPOTIFY_CLIENT_ID", client_id)
            write_env_key("PSOK_DEFAULT_SPOTIFY_CLIENT_SECRET", client_secret)
            try:
                mcp_cmds.add_from_catalogue("spotify")
                print("✓ Spotify connector configured!")
            except Exception as e:
                print(f"Note: {e}")

    elif choice == "5":
        print("\n[Search Connectors: Tavily & Exa]")
        print("1. Tavily: https://tavily.com (Fast AI web search)")
        tavily = prompt_input("Enter Tavily API Key (or leave blank to skip)")
        if tavily:
            set_secret("psok/tavily", tavily)
            try:
                mcp_cmds.add_from_catalogue("tavily")
                print("✓ Tavily search connector added!")
            except Exception as e:
                print(f"Note: {e}")


# ----------------------------------------------------------------------
# 3. Cloudflare Workers AI & Embeddings
# ----------------------------------------------------------------------
def setup_cloudflare() -> None:
    print_header("3. Cloudflare Workers AI & Embeddings Configuration")
    print("Cloudflare Workers AI gives you zero-cost cloud embeddings and inference.\n")
    print("Steps to get credentials:")
    print("  1. Cloudflare Dashboard: https://dash.cloudflare.com/")
    print("  2. Account ID: Found in your dashboard URL or right sidebar")
    print("  3. API Token: Create token with 'Workers AI - Read' template at:")
    print("     https://dash.cloudflare.com/profile/api-tokens\n")

    account_id = prompt_input("Enter Cloudflare Account ID (or leave blank to skip)")
    if account_id:
        token = prompt_input("Enter Cloudflare API Token")
        set_secret("psok/cloudflare", token)
        write_env_key("CLOUDFLARE_ACCOUNT_ID", account_id)
        write_env_key("CLOUDFLARE_API_KEY", token)
        print("✓ Stored Cloudflare credentials.")

        use_emb = (
            prompt_input("Set Cloudflare as default embedding model? (y/n)", "y").lower() == "y"
        )
        if use_emb:
            try:
                from backend.config import save_embeddings

                save_embeddings("cloudflare", "@cf/baai/bge-base-en-v1.5")
                print("✓ Default embedder set to: cloudflare / @cf/baai/bge-base-en-v1.5")
            except Exception as e:
                print(f"Note: {e}")


# ----------------------------------------------------------------------
# 4. Cloudflare Relay & Instagram Setup
# ----------------------------------------------------------------------
def setup_relay() -> None:
    print_header("4. Cloudflare Worker Relay & Instagram Capture")
    print("The relay is a free Cloudflare Worker that catches Instagram reels and")
    print("mobile share links 24/7, holding them until your computer is awake.\n")
    print("Deployment instructions:")
    print("  cd relay")
    print("  npm install")
    print("  npx wrangler d1 create psok-relay      # copy database_id into wrangler.jsonc")
    print("  npm run schema                         # apply D1 tables")
    print("  npx wrangler secret put APP_SECRET     # Meta app secret")
    print("  npx wrangler secret put VERIFY_TOKEN   # your chosen webhook verify string")
    print("  npx wrangler secret put RELAY_TOKEN    # secret token (e.g. openssl rand -hex 32)")
    print("  npm run deploy                         # outputs https://psok-relay.<you>.workers.dev\n")

    relay_url = prompt_input(
        "Enter deployed Relay URL (e.g. https://psok-relay.user.workers.dev) [blank to skip]"
    )
    if relay_url:
        token = prompt_input("Enter RELAY_TOKEN")
        from backend.cli import cmd_instagram

        args = argparse.Namespace(
            action="relay",
            url=relay_url,
            token=token,
            state="on",
            sync=False,
        )
        try:
            cmd_instagram(args)
            print("✓ PSOK connected to Cloudflare Relay!")
        except Exception as e:
            print(f"Note: {e}")


# ----------------------------------------------------------------------
# 5. Library & Social Bookmarks
# ----------------------------------------------------------------------
def setup_library() -> None:
    print_header("5. Library & Bookmarks Configuration")
    print("The Library is your knowledge archive of saved articles, reels, and notes.\n")
    print("Content enters your Library in 5 ways:")
    print("  1. Instagram Reels: DM or comment @your.account -> transcribed & saved.")
    print("  2. Mobile Share Sheet: Send links to POST /share on your relay.")
    print("  3. Browser Bookmarks: Automatically synced into searchable markdown.")
    print("  4. Direct Uploads: Drag PDFs, DOCX, PPTX, or images into Chat or Library.")
    print("  5. In-Chat: Tell the assistant 'Bookmark this URL' or 'Save this to my library'.\n")

    sync_bm = prompt_input("Sync local browser bookmarks now? (y/n)", "n").lower() == "y"
    if sync_bm:
        try:
            from backend.cli import cmd_bookmarks

            args = argparse.Namespace(action="sync", no_enrich=False)
            cmd_bookmarks(args)
            print("✓ Browser bookmarks synced to library.")
        except Exception as e:
            print(f"Note: {e}")


# ----------------------------------------------------------------------
# 6. Diagnostics
# ----------------------------------------------------------------------
def run_diagnostics() -> None:
    print_header("6. Running PSOK Doctor Diagnostics")
    from backend.cli import cmd_doctor

    cmd_doctor(argparse.Namespace())
    input("\nPress Enter to return to menu...")


def main() -> None:
    while True:
        print_header("PSOK Setup & Configuration Assistant")
        print("Configure any feature easily for yourself or your friends:\n")
        print("  1) AI Models & API Keys (Ollama local, Anthropic, OpenAI, Groq)")
        print("  2) App Connectors & OAuth (Google Workspace, Microsoft, GitHub, Spotify)")
        print("  3) Cloudflare Workers AI & Embeddings")
        print("  4) Cloudflare Relay & Instagram Capture (24/7 Library Ingest)")
        print("  5) Library & Bookmarks Overview")
        print("  6) Run System Diagnostics (PSOK Doctor)")
        print("  0) Exit")

        choice = prompt_input("\nEnter selection (0-6)", "6")
        if choice == "1":
            setup_models()
        elif choice == "2":
            setup_connectors()
        elif choice == "3":
            setup_cloudflare()
        elif choice == "4":
            setup_relay()
        elif choice == "5":
            setup_library()
        elif choice == "6":
            run_diagnostics()
        elif choice == "0":
            print("\nExiting Setup Assistant. Run './run.sh' to launch PSOK!")
            break
        else:
            print("Invalid selection.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nAborted.")
        sys.exit(0)
