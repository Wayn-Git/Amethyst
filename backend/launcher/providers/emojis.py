"""Emoji search provider for Amethyst Damon launcher."""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from backend.launcher.provider import (
    BaseLauncherProvider,
    LauncherAction,
    LauncherResult,
)
from backend.remote.clipboard import set_clipboard

log = logging.getLogger(__name__)

# Curated list of high-frequency emojis with searchable aliases
EMOJI_CATALOG: list[dict[str, Any]] = [
    {"char": "🔥", "name": "Fire", "alias": "fire", "keywords": ["hot", "burn", "lit", "flame"]},
    {"char": "✨", "name": "Sparkles", "alias": "sparkles", "keywords": ["clean", "magic", "stars", "shiny"]},
    {"char": "🚀", "name": "Rocket", "alias": "rocket", "keywords": ["launch", "fast", "space", "ship"]},
    {"char": "🎉", "name": "Party Popper", "alias": "tada", "keywords": ["celebration", "party", "congrats"]},
    {"char": "👍", "name": "Thumbs Up", "alias": "+1", "keywords": ["thumbsup", "approve", "yes", "ok", "good"]},
    {"char": "👎", "name": "Thumbs Down", "alias": "-1", "keywords": ["thumbsdown", "disapprove", "no", "bad"]},
    {"char": "✅", "name": "Check Mark", "alias": "check", "keywords": ["tick", "done", "complete", "success"]},
    {"char": "❌", "name": "Cross Mark", "alias": "x", "keywords": ["cancel", "no", "wrong", "error", "fail"]},
    {"char": "⚠️", "name": "Warning", "alias": "warning", "keywords": ["alert", "caution", "danger"]},
    {"char": "💡", "name": "Light Bulb", "alias": "bulb", "keywords": ["idea", "bright", "smart"]},
    {"char": "❤️", "name": "Red Heart", "alias": "heart", "keywords": ["love", "like", "favorite"]},
    {"char": "💜", "name": "Purple Heart", "alias": "purple_heart", "keywords": ["amethyst", "love", "violet"]},
    {"char": "💙", "name": "Blue Heart", "alias": "blue_heart", "keywords": ["love", "blue"]},
    {"char": "💚", "name": "Green Heart", "alias": "green_heart", "keywords": ["love", "green"]},
    {"char": "⚡", "name": "High Voltage", "alias": "zap", "keywords": ["lightning", "electricity", "fast", "speed"]},
    {"char": "🐛", "name": "Bug", "alias": "bug", "keywords": ["glitch", "error", "defect", "insect"]},
    {"char": "🛠️", "name": "Hammer and Wrench", "alias": "tools", "keywords": ["build", "repair", "fix", "settings"]},
    {"char": "📦", "name": "Package", "alias": "package", "keywords": ["box", "delivery", "bundle", "npm"]},
    {"char": "📝", "name": "Memo", "alias": "memo", "keywords": ["note", "write", "document", "pencil"]},
    {"char": "📌", "name": "Pushpin", "alias": "pin", "keywords": ["save", "marker", "pinned"]},
    {"char": "🔗", "name": "Link", "alias": "link", "keywords": ["url", "chain", "hyperlink"]},
    {"char": "🔒", "name": "Locked", "alias": "lock", "keywords": ["secure", "privacy", "password", "safe"]},
    {"char": "🔓", "name": "Unlocked", "alias": "unlock", "keywords": ["open", "public", "insecure"]},
    {"char": "⏱️", "name": "Stopwatch", "alias": "timer", "keywords": ["time", "clock", "watch", "speed"]},
    {"char": "📅", "name": "Calendar", "alias": "calendar", "keywords": ["date", "schedule", "events"]},
    {"char": "💻", "name": "Laptop", "alias": "laptop", "keywords": ["computer", "pc", "mac", "tech", "work"]},
    {"char": "🖥️", "name": "Desktop Computer", "alias": "desktop", "keywords": ["monitor", "screen", "workstation"]},
    {"char": "📱", "name": "Mobile Phone", "alias": "phone", "keywords": ["iphone", "android", "cell"]},
    {"char": "☕", "name": "Hot Beverage", "alias": "coffee", "keywords": ["tea", "drink", "morning", "cafe"]},
    {"char": "💯", "name": "Hundred Points", "alias": "100", "keywords": ["perfect", "score", "full"]},
    {"char": "⭐", "name": "Star", "alias": "star", "keywords": ["favorite", "gold", "rate"]},
    {"char": "🌟", "name": "Glowing Star", "alias": "glowing_star", "keywords": ["shining", "bright", "star"]},
    {"char": "👀", "name": "Eyes", "alias": "eyes", "keywords": ["look", "see", "watching", "review"]},
    {"char": "👏", "name": "Clapping Hands", "alias": "clap", "keywords": ["applause", "praise", "bravo"]},
    {"char": "🙌", "name": "Raising Hands", "alias": "raised_hands", "keywords": ["yay", "celebrate", "hooray"]},
    {"char": "🙏", "name": "Folded Hands", "alias": "pray", "keywords": ["thanks", "thank you", "please", "hope"]},
    {"char": "💪", "name": "Flexed Biceps", "alias": "muscle", "keywords": ["strong", "power", "flex"]},
    {"char": "🤝", "name": "Handshake", "alias": "handshake", "keywords": ["agreement", "deal", "meeting"]},
    {"char": "👋", "name": "Waving Hand", "alias": "wave", "keywords": ["hello", "bye", "goodbye", "greeting"]},
    {"char": "😀", "name": "Grinning Face", "alias": "grinning", "keywords": ["smile", "happy", "joy"]},
    {"char": "😃", "name": "Grinning Face with Big Eyes", "alias": "smiley", "keywords": ["smile", "happy"]},
    {"char": "😄", "name": "Grinning Face with Smiling Eyes", "alias": "smile", "keywords": ["laugh", "happy"]},
    {"char": "😂", "name": "Face with Tears of Joy", "alias": "joy", "keywords": ["tears", "laugh", "cry", "lol", "funny"]},
    {"char": "🤣", "name": "Rolling on the Floor Laughing", "alias": "rofl", "keywords": ["lol", "lmao", "funny", "laugh"]},
    {"char": "😍", "name": "Smiling Face with Heart-Eyes", "alias": "heart_eyes", "keywords": ["love", "crush", "adore"]},
    {"char": "🤔", "name": "Thinking Face", "alias": "thinking", "keywords": ["ponder", "wonder", "hmm", "question"]},
    {"char": "😎", "name": "Smiling Face with Sunglasses", "alias": "sunglasses", "keywords": ["cool", "chill"]},
    {"char": "🥳", "name": "Partying Face", "alias": "partying_face", "keywords": ["birthday", "party", "celebrate"]},
    {"char": "😅", "name": "Grinning Face with Sweat", "alias": "sweat_smile", "keywords": ["nervous", "relief", "awkward"]},
    {"char": "😭", "name": "Loudly Crying Face", "alias": "sob", "keywords": ["cry", "sad", "unhappy", "tears"]},
    {"char": "😱", "name": "Face Screaming in Fear", "alias": "scream", "keywords": ["shocked", "scared", "fear"]},
    {"char": "🤯", "name": "Exploding Head", "alias": "exploding_head", "keywords": ["mind blown", "shock", "amazing"]},
    {"char": "💀", "name": "Skull", "alias": "skull", "keywords": ["dead", "skeleton", "rip", "died"]},
    {"char": "🤷", "name": "Person Shrugging", "alias": "shrug", "keywords": ["idk", "doubt", "whatever"]},
    {"char": "🎯", "name": "Bullseye", "alias": "dart", "keywords": ["target", "goal", "hit", "accurate"]},
    {"char": "🎨", "name": "Artist Palette", "alias": "art", "keywords": ["paint", "color", "design", "creative"]},
    {"char": "🔔", "name": "Bell", "alias": "bell", "keywords": ["notification", "sound", "ring", "alert"]},
    {"char": "🔕", "name": "Bell with Slash", "alias": "no_bell", "keywords": ["mute", "silent", "quiet"]},
    {"char": "🔍", "name": "Magnifying Glass Left", "alias": "search", "keywords": ["find", "lookup", "explore"]},
    {"char": "🧭", "name": "Compass", "alias": "compass", "keywords": ["navigation", "direction", "travel"]},
    {"char": "🌐", "name": "Globe with Meridians", "alias": "globe", "keywords": ["world", "internet", "web", "online"]},
]


class EmojiProvider(BaseLauncherProvider):
    id = "emoji"
    name = "Emojis"
    priority = 75

    async def search(
        self, query: str, session_id: str
    ) -> AsyncIterator[LauncherResult]:
        raw = query.strip()
        if not raw:
            return

        is_explicit_emoji = False
        term = raw.lower()

        # Check explicit prefixes: :fire or emoji fire
        if term.startswith(":"):
            is_explicit_emoji = True
            term = term[1:].rstrip(":")
        elif term.startswith("emoji "):
            is_explicit_emoji = True
            term = term[6:].strip()

        if not term:
            # Show top recommendations when only ":" or "emoji " typed
            for item in EMOJI_CATALOG[:8]:
                yield self._build_result(item, score=85.0)
            return

        matches = []
        for item in EMOJI_CATALOG:
            alias = item["alias"]
            name = item["name"].lower()
            keywords = item["keywords"]

            score = 0.0
            if term == alias or term == name:
                score = 100.0
            elif alias.startswith(term):
                score = 92.0
            elif name.startswith(term):
                score = 88.0
            elif any(kw == term for kw in keywords):
                score = 85.0
            elif any(kw.startswith(term) for kw in keywords):
                score = 78.0
            elif term in alias or term in name or any(term in kw for kw in keywords):
                score = 65.0

            if score > 0:
                if is_explicit_emoji:
                    score += 20.0
                matches.append((score, item))

        matches.sort(key=lambda x: x[0], reverse=True)
        for score, item in matches[:10]:
            yield self._build_result(item, score)

    def _build_result(self, item: dict[str, Any], score: float) -> LauncherResult:
        ch = item["char"]
        name = item["name"]
        alias = item["alias"]
        return LauncherResult(
            id=f"emoji:{alias}",
            provider_id=self.id,
            title=f"{ch}  {name}",
            subtitle=f"Copy :{alias}: to clipboard",
            icon="sparkles",
            badge="EMOJI",
            score=score,
            preview_type="markdown",
            preview_data={
                "markdown": f"# {ch}\n\n**{name}** (`:{alias}:`)\n\nPress **Enter** to copy `{ch}` directly to clipboard."
            },
            actions=[
                LauncherAction(
                    id="copy_emoji",
                    title=f"Copy {ch} to Clipboard",
                    shortcut="↵",
                    is_primary=True,
                    handler_payload={"char": ch, "name": name},
                )
            ],
        )

    async def execute(
        self, action_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        ch = payload.get("char")
        if not ch:
            return {"ok": False, "error": "Missing emoji character"}

        try:
            set_clipboard(ch)
            return {"ok": True, "copied": ch}
        except Exception as e:
            log.warning("Failed to copy emoji to clipboard: %s", e)
            return {"ok": False, "error": str(e)}
