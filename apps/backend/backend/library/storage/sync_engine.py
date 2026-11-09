"""Two-way synchronization and ingestion engine for Library cloud storage.

Discovers existing items in Google Drive, deduplicates against local database,
ingests and indexes new cloud items, and synchronizes unmigrated local items to Drive.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime
import hashlib
import json
import logging
import mimetypes
from pathlib import Path
import re
from typing import Any
from urllib.parse import unquote

from backend.db.connection import get_connection
from backend.library.storage.base import StorageError, StorageUnavailableError
from backend.library.storage.gdrive_bridge import GoogleDriveBridge, MARKER_FILE_NAME
from backend.library.store import LibraryStore, library_dir

log = logging.getLogger(__name__)

STANDARD_SUBFOLDERS = ("articles", "books", "notes", "media", "other")


class LibrarySyncEngine:
    """Orchestrates two-way sync between Google Drive and Amethyst Library."""

    _is_running: bool = False
    _cancelled: bool = False
    _status: dict[str, Any] = {
        "is_running": False,
        "stage": "idle",
        "found_drive_items": 0,
        "inbound_imported": 0,
        "uploaded_outbound": 0,
        "skipped_duplicates": 0,
        "errors": [],
        "last_error": None,
    }

    def __init__(self, bridge: GoogleDriveBridge | None = None) -> None:
        self.bridge = bridge or GoogleDriveBridge()

    def get_status(self) -> dict[str, Any]:
        """Get live synchronization metrics."""
        st = dict(self._status)
        st["is_running"] = self._is_running
        return st

    def cancel(self) -> None:
        """Signal running synchronization to cancel."""
        LibrarySyncEngine._cancelled = True

    async def scan_drive_items(self, root_folder_id: str) -> list[dict[str, Any]]:
        """Discover all files in Drive root and subfolders."""
        discovered: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        # 1. Inspect all items directly under root
        root_files = await self.bridge.list_files_in_folder(root_folder_id)
        subfolders_to_scan: list[tuple[str, str]] = []  # (folder_id, folder_name)

        for f in root_files:
            fid = f.get("id")
            fname = f.get("name", "")
            if not fid or fid in seen_ids or fname == MARKER_FILE_NAME:
                continue

            if f.get("mimeType") == "application/vnd.google-apps.folder":
                subfolders_to_scan.append((str(fid), fname))
            else:
                item = dict(f)
                item["parent_folder"] = ""
                discovered.append(item)
                seen_ids.add(fid)

        # 2. Also ensure standard subfolders are scanned if not already found in root_files
        found_subfolder_names = {name.lower() for _, name in subfolders_to_scan}
        for sub in STANDARD_SUBFOLDERS:
            if sub.lower() not in found_subfolder_names:
                sub_id = await self.bridge._find_folder(sub, root_folder_id)
                if sub_id and sub_id not in [fid for fid, _ in subfolders_to_scan]:
                    subfolders_to_scan.append((sub_id, sub))

        # 3. Scan each discovered subfolder
        for sub_id, sub_name in subfolders_to_scan:
            sub_files = await self.bridge.list_files_in_folder(sub_id)
            for sf in sub_files:
                sfid = sf.get("id")
                sfname = sf.get("name", "")
                if sfid and sfid not in seen_ids and sfname != MARKER_FILE_NAME:
                    if sf.get("mimeType") != "application/vnd.google-apps.folder":
                        item = dict(sf)
                        item["parent_folder"] = sub_name.lower()
                        discovered.append(item)
                        seen_ids.add(sfid)

        # Sort discovered files so library-catalog.json is processed first
        catalog_files = [f for f in discovered if f.get("name") in ("library-catalog.json", ".amethyst-catalog.json")]
        other_files = [f for f in discovered if f.get("name") not in ("library-catalog.json", ".amethyst-catalog.json")]
        return catalog_files + other_files

    async def ingest_inbound_item(self, drive_file: dict[str, Any]) -> dict[str, Any]:
        """Ingest a single Google Drive file into Amethyst Library with deduplication."""
        drive_id = drive_file.get("id")
        if not drive_id:
            return {"status": "error", "error": "Missing file ID"}

        name = drive_file.get("name", "Untitled")
        ext = Path(name).suffix.lower()
        parent_folder = drive_file.get("parent_folder", "")
        file_checksum = drive_file.get("md5Checksum") or drive_file.get("sha256Checksum") or ""

        conn = get_connection()
        store = LibraryStore(conn)

        # Special case: library-catalog.json from Google Drive
        if name in ("library-catalog.json", ".amethyst-catalog.json"):
            try:
                content = await self.bridge.download_file(drive_id)
                catalog_data = json.loads(content.decode("utf-8"))
                await self.import_catalog_data(catalog_data)
                return {"status": "imported", "item_id": 0, "title": "Library Catalog"}
            except Exception as cat_err:
                log.warning("Could not import catalog from Drive: %s", cat_err)
                return {"status": "error", "error": str(cat_err)}

        # Special case: thumbnail files (e.g. 000010-thumb.jpg, 000010-thumb-opt.jpg)
        if ext in (".jpg", ".jpeg", ".png", ".webp") and ("thumb" in name or "-thumb" in name):
            m_id = re.search(r"(\d{6})", name)
            if m_id:
                num = int(m_id.group(1))
                from backend.library.store import media_dir
                m_dir = media_dir()
                m_dir.mkdir(parents=True, exist_ok=True)
                dest = m_dir / name
                if not dest.exists() or dest.stat().st_size < 500:
                    try:
                        content = await self.bridge.download_file(drive_id)
                        dest.write_bytes(content)
                    except Exception as err:
                        log.warning("Could not download thumbnail %s: %s", name, err)
                cand = conn.execute(
                    "SELECT id, text_path, thumbnail_path FROM library_items WHERE id = ? OR text_path LIKE ?",
                    (num, f"%{num:06d}%"),
                ).fetchone()
                if cand:
                    store.update(cand["id"], thumbnail_path=str(dest))
                    conn.commit()
                    return {"status": "merged_thumbnail", "item_id": cand["id"]}
                return {"status": "saved_thumbnail", "path": str(dest)}

        # 1. Match by external_id
        existing = conn.execute(
            "SELECT id, title, checksum FROM library_items WHERE external_id = ?",
            (drive_id,),
        ).fetchone()
        if existing:
            return {"status": "skipped", "reason": "already_synced", "item_id": existing["id"]}

        # 2. Match by checksum
        if file_checksum:
            existing_sum = conn.execute(
                "SELECT id, title FROM library_items WHERE checksum = ?",
                (file_checksum,),
            ).fetchone()
            if existing_sum:
                store.update(
                    existing_sum["id"],
                    external_id=drive_id,
                    storage_provider="google_drive",
                    sync_state="synced",
                )
                conn.commit()
                return {"status": "skipped", "reason": "checksum_match", "item_id": existing_sum["id"]}

        # 3. Match by normalized title & kind
        title_candidate = Path(name).stem.replace("-", " ").replace("_", " ").strip()
        existing_title = conn.execute(
            "SELECT id FROM library_items WHERE LOWER(title) = LOWER(?)",
            (title_candidate,),
        ).fetchone()
        if existing_title:
            store.update(
                existing_title["id"],
                external_id=drive_id,
                storage_provider="google_drive",
                sync_state="synced",
            )
            conn.commit()
            return {"status": "skipped", "reason": "title_match", "item_id": existing_title["id"]}

        # Determine item kind
        if parent_folder == "articles":
            kind = "article"
        elif parent_folder == "books":
            kind = "book"
        elif parent_folder == "notes":
            kind = "note"
        elif parent_folder == "media":
            kind = "music" if ext in (".mp3", ".m4a", ".wav", ".flac") else "video"
        else:
            if ext in (".md", ".txt"):
                kind = "note"
            elif ext in (".pdf", ".epub"):
                kind = "book"
            elif ext in (".mp3", ".m4a", ".wav"):
                kind = "music"
            elif ext in (".mp4", ".mov", ".webm"):
                kind = "video"
            else:
                kind = "article"

        # Check if this media file corresponds to an existing text item (e.g. 000339.mp4)
        if ext in (".mp4", ".mov", ".webm", ".mp3", ".m4a", ".wav"):
            m_id = re.search(r"(\d{6})", name)
            if m_id:
                num = int(m_id.group(1))
                from backend.library.store import media_dir
                m_dir = media_dir()
                m_dir.mkdir(parents=True, exist_ok=True)
                dest = m_dir / name
                if not dest.exists() or dest.stat().st_size < 1000:
                    try:
                        content = await self.bridge.download_file(drive_id)
                        dest.write_bytes(content)
                    except Exception as err:
                        log.warning("Could not download media %s: %s", name, err)
                cand = conn.execute(
                    "SELECT id, text_path, media_path FROM library_items WHERE id = ? OR text_path LIKE ?",
                    (num, f"%{num:06d}%"),
                ).fetchone()
                if cand:
                    store.update(cand["id"], media_path=str(dest), kind="video", sync_state="synced")
                    conn.commit()
                    return {"status": "merged_media", "item_id": cand["id"]}
                return {"status": "saved_media", "path": str(dest)}

        # Download file payload
        content = await self.bridge.download_file(drive_id)
        computed_checksum = hashlib.sha256(content).hexdigest()

        # Cache file locally
        cache_dir = Path("~/.amethyst/cache/library").expanduser()
        cache_dir.mkdir(parents=True, exist_ok=True)
        cached_file_path = cache_dir / f"{drive_id}_{name}"
        cached_file_path.write_bytes(content)

        # For text markdown, parse metadata and write to library_dir
        local_text_path: Path | None = None
        extracted_title = title_candidate
        parsed_summary: str | None = None
        parsed_tags: list[str] = []
        parsed_resources: list[dict[str, Any]] = []
        real_url: str | None = None

        if ext in (".md", ".txt", ".html"):
            lib_dir = library_dir()
            lib_dir.mkdir(parents=True, exist_ok=True)
            local_text_path = lib_dir / (name if re.match(r"^\d{6}-", name) else f"{drive_id[:8]}-{name}")
            local_text_path.write_bytes(content)

            try:
                text_str = content.decode("utf-8", errors="replace")
                lines = text_str.splitlines()

                # Title
                for line in lines:
                    trimmed = line.strip()
                    if trimmed.startswith("# "):
                        extracted_title = trimmed[2:].strip()
                        break
                if extracted_title and extracted_title.endswith(" - Google Drive"):
                    extracted_title = extracted_title[:-15].strip()

                # Summary
                sum_lines = []
                for line in lines[1:]:
                    sline = line.strip()
                    if sline.startswith("## ") or sline.startswith("Tags:") or sline == "---":
                        break
                    if sline:
                        sum_lines.append(sline)
                if sum_lines:
                    parsed_summary = " ".join(sum_lines)

                # Tags
                tags_m = re.search(r"Tags:\s*([^\n]+)", text_str)
                if tags_m:
                    parsed_tags = [t.strip().lstrip("#").lower() for t in tags_m.group(1).split(",") if t.strip()]
                if not parsed_tags:
                    hashtags = re.findall(r"#([a-zA-Z0-9_-]+)", text_str)
                    parsed_tags = list(set([h.lower() for h in hashtags if len(h) > 2 and h.lower() not in ("ad", "link")]))[:5]

                # Resources
                mentioned_match = re.search(r"## Mentioned\s*\n(.*?)(?=\n##|\n---|\Z)", text_str, re.DOTALL)
                if mentioned_match:
                    for line in mentioned_match.group(1).splitlines():
                        m = re.match(r"^-\s*([a-zA-Z0-9_-]+)\s*[—-]\s*([^:]+):\s*(.*?)\s*\((https?://[^\)]+)\)", line.strip())
                        if m:
                            rtype, rname, rdetail, rurl = m.groups()
                            rurl = rurl.strip()
                            if not any(x in rurl for x in ["drive.google.com", "support.google.com", "google.com/search", "aistudio.google.com"]):
                                parsed_resources.append({
                                    "type": rtype.strip(),
                                    "name": rname.strip(),
                                    "detail": rdetail.strip(),
                                    "url": rurl,
                                })

                # Real URL
                for r in parsed_resources:
                    if r["type"] in ("link", "article", "post", "video"):
                        real_url = r["url"]
                        break

                if not real_url:
                    for pattern in [
                        r"https?://(?:www\.)?reddit\.com/r/[^\s\)\"\'>]+",
                        r"https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_-]{11}",
                        r"https?://(?:www\.)?youtu\.be/[a-zA-Z0-9_-]{11}",
                        r"https?://(?:www\.)?x\.com/[a-zA-Z0-9_]+/status/[0-9]+",
                        r"https?://(?:www\.)?twitter\.com/[a-zA-Z0-9_]+/status/[0-9]+",
                        r"https?://(?:www\.)?instagram\.com/(?:reel|p)/[a-zA-Z0-9_-]+",
                        r"https?://(?:www\.)?threads\.net/@[a-zA-Z0-9_.]+/post/[a-zA-Z0-9_-]+",
                        r"https?://l\.threads\.com/\?u=([^&]+)",
                    ]:
                        m = re.search(pattern, text_str)
                        if m:
                            real_url = unquote(m.group(1)) if "l.threads.com" in m.group(0) else m.group(0)
                            break

                if not real_url:
                    ig_m = re.search(r"instagram-reel-([a-zA-Z0-9_-]{10,})", name.lower()) or (re.search(r"instagram reel ([a-zA-Z0-9_-]{10,})", (extracted_title or "").lower()))
                    if ig_m:
                        real_url = f"https://www.instagram.com/reel/{ig_m.group(1)}/"

                if not real_url and extracted_title:
                    x_m = re.match(r"^(?:Post|Thread)?\s*(?:by\s*)?@([a-zA-Z0-9_]+)", extracted_title, re.IGNORECASE)
                    if x_m:
                        real_url = f"https://x.com/{x_m.group(1)}"

                if not real_url and parsed_resources:
                    real_url = parsed_resources[0]["url"]

            except Exception as parse_err:
                log.warning("Markdown parse error for %s: %s", name, parse_err)

        # Kind inference from real_url
        if real_url:
            u_lower = real_url.lower()
            if any(k in u_lower for k in ["youtube.com", "youtu.be", "/reel/", "/shorts/"]):
                kind = "video"
            elif any(k in u_lower for k in ["reddit.com", "x.com", "twitter.com", "threads.net"]):
                kind = "post"

        # Date from drive_file createdTime or modifiedTime
        consumed_on: str | None = None
        if drive_file.get("createdTime"):
            consumed_on = str(drive_file["createdTime"])[:10]
        elif drive_file.get("modifiedTime"):
            consumed_on = str(drive_file["modifiedTime"])[:10]

        # Check target_id from filename or text_path to preserve original item ID
        target_id: int | None = None
        m_id = re.search(r"(\d{6})", name)
        if m_id:
            target_id = int(m_id.group(1))

        existing_item = None
        if target_id is not None:
            existing_item = conn.execute("SELECT id FROM library_items WHERE id = ?", (target_id,)).fetchone()

        if existing_item:
            item_id = existing_item["id"]
            store.update(
                item_id,
                kind=kind,
                title=extracted_title or title_candidate,
                url=real_url,
                consumed_on=consumed_on or date.today().isoformat(),
            )
        else:
            item_id = store.create(
                item_id=target_id,
                kind=kind,
                title=extracted_title or title_candidate,
                category="general",
                url=real_url,  # NEVER drive.google.com!
                consumed_on=consumed_on or date.today().isoformat(),
            )

        update_kwargs: dict[str, Any] = {
            "storage_provider": "google_drive",
            "external_id": drive_id,
            "checksum": computed_checksum,
            "cached_locally": 1,
            "sync_state": "synced",
        }
        if parsed_summary:
            update_kwargs["summary"] = parsed_summary
        if parsed_tags:
            update_kwargs["tags"] = json.dumps(parsed_tags)
        if parsed_resources:
            update_kwargs["resources"] = json.dumps(parsed_resources)
        if local_text_path:
            update_kwargs["text_path"] = str(local_text_path)
        else:
            update_kwargs["media_path"] = str(cached_file_path)

        # Check if thumbnail or video media already exists on disk for this ID
        from backend.library.store import media_dir
        m_dir = media_dir()
        thumb_candidate = m_dir / f"{item_id:06d}-thumb.jpg"
        if thumb_candidate.is_file() and thumb_candidate.stat().st_size > 500:
            update_kwargs["thumbnail_path"] = str(thumb_candidate)

        for v_ext in (".mp4", ".mov", ".webm", ".mkv"):
            media_candidate = m_dir / f"{item_id:06d}{v_ext}"
            if media_candidate.is_file() and media_candidate.stat().st_size > 1000:
                update_kwargs["media_path"] = str(media_candidate)
                break

        store.update(item_id, **update_kwargs)
        conn.commit()

        # Try fetching real thumbnail if real_url is present
        if real_url and not any(d in real_url for d in ("drive.google.com", "localhost", "127.0.0.1")):
            try:
                from backend.library.service import LibraryService
                asyncio.create_task(LibraryService(store).fetch_thumbnail_for_item(item_id))
            except Exception as exc:
                log.debug("Thumbnail fetch skipped for item %s: %s", item_id, exc)

        # Background indexing (non-blocking)
        try:
            from backend.retrieval.indexer import Indexer
            indexer = Indexer()
            if local_text_path and hasattr(indexer, "index_item"):
                asyncio.create_task(indexer.index_item(item_id))
        except Exception as exc:
            log.debug("Indexing dispatch skipped for item %s: %s", item_id, exc)

        return {"status": "imported", "item_id": item_id, "title": extracted_title}

    async def import_catalog_data(self, catalog_data: dict[str, Any]) -> None:
        """Import full library catalog data from Google Drive."""
        conn = get_connection()
        store = LibraryStore(conn)

        items = catalog_data.get("items", [])
        for item in items:
            item_id = item.get("id")
            if not item_id:
                continue
            existing = conn.execute("SELECT id FROM library_items WHERE id = ?", (item_id,)).fetchone()
            if not existing:
                store.create(
                    item_id=item_id,
                    kind=item.get("kind") or "article",
                    title=item.get("title") or "Untitled",
                    category=item.get("category"),
                    url=item.get("url"),
                    author=item.get("author"),
                    site=item.get("site"),
                    published_on=item.get("published_on"),
                    consumed_on=item.get("consumed_on"),
                    notes=item.get("notes"),
                    rating=item.get("rating"),
                    source_ref=item.get("source_ref"),
                )

            update_fields: dict[str, Any] = {}
            for col in (
                "title", "url", "author", "site", "published_on", "consumed_on",
                "notes", "rating", "summary", "tags", "resources", "category",
                "progress", "is_pinned", "position", "duration_seconds", "status"
            ):
                if col in item and item[col] is not None:
                    val = item[col]
                    if col in ("tags", "resources") and not isinstance(val, str):
                        val = json.dumps(val)
                    update_fields[col] = val

            from backend.library.store import media_dir
            m_dir = media_dir()
            thumb = m_dir / f"{item_id:06d}-thumb.jpg"
            if thumb.is_file() and thumb.stat().st_size > 500:
                update_fields["thumbnail_path"] = str(thumb)
            for ext in (".mp4", ".mov", ".webm"):
                v = m_dir / f"{item_id:06d}{ext}"
                if v.is_file() and v.stat().st_size > 1000:
                    update_fields["media_path"] = str(v)
                    break

            if update_fields:
                store.update(item_id, **update_fields)

        # Restore lists
        lists = catalog_data.get("lists", [])
        for l in lists:
            lid = l.get("id")
            if not lid:
                continue
            cur = conn.execute("SELECT id FROM library_lists WHERE id = ?", (lid,)).fetchone()
            now_iso = datetime.now().isoformat()
            if not cur:
                conn.execute(
                    "INSERT INTO library_lists (id, title, description, icon, is_smart, uuid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (lid, l.get("title") or "List", l.get("description") or "", l.get("icon") or "bookmark", 1 if l.get("is_smart") else 0, l.get("uuid"), l.get("created_at") or now_iso, l.get("updated_at") or now_iso),
                )
            else:
                conn.execute(
                    "UPDATE library_lists SET title = ?, description = ?, icon = ?, is_smart = ? WHERE id = ?",
                    (l.get("title") or "List", l.get("description") or "", l.get("icon") or "bookmark", 1 if l.get("is_smart") else 0, lid),
                )

        # Restore list members
        members = catalog_data.get("list_members", [])
        for m in members:
            lid = m.get("list_id")
            iid = m.get("item_id")
            link_id = m.get("link_id")
            pos = m.get("position", 0)
            if lid and iid:
                conn.execute("INSERT OR IGNORE INTO library_list_members (list_id, item_id, position) VALUES (?, ?, ?)", (lid, iid, pos))
            elif lid and link_id:
                conn.execute("INSERT OR IGNORE INTO library_list_members (list_id, link_id, position) VALUES (?, ?, ?)", (lid, link_id, pos))

        conn.commit()

    async def export_catalog_to_drive(self, root_folder_id: str) -> None:
        """Export full library catalog to Google Drive as library-catalog.json."""
        conn = get_connection()
        rows = conn.execute("SELECT * FROM library_items ORDER BY id ASC").fetchall()
        items: list[dict[str, Any]] = []
        import base64
        for r in rows:
            d = dict(r)
            d.pop("document_id", None)
            d.pop("text_path", None)
            th_path = d.pop("thumbnail_path", None)
            d.pop("media_path", None)

            # Preserve & populate thumbnail_url for mobile off-LAN access
            thumb_url = None
            raw_res = d.get("resources")
            parsed_res = []
            if raw_res:
                try:
                    parsed_res = json.loads(raw_res) if isinstance(raw_res, str) else raw_res
                except Exception:
                    parsed_res = []

            # 1. YouTube direct thumbnail
            if d.get("url"):
                yt_m = re.search(r"(?:watch\?v=|shorts/|youtu\.be/)([\w-]{11})", d["url"])
                if yt_m:
                    thumb_url = f"https://img.youtube.com/vi/{yt_m.group(1)}/hqdefault.jpg"

            # 2. External thumbnail, avatar, or slide from resources
            if not thumb_url and parsed_res:
                for res in parsed_res:
                    if not isinstance(res, dict):
                        continue
                    r_type = res.get("type")
                    r_url = res.get("url") or ""
                    r_remote = res.get("remote_url") or ""
                    if r_type in ("slide", "image", "avatar") and r_url.startswith("http"):
                        thumb_url = r_url
                        break
                    if r_remote.startswith("http"):
                        thumb_url = r_remote
                        break

            # 3. Local disk thumbnail embedded as compact base64 data URI for instant offline display
            if not thumb_url and (th_path or d.get("id")):
                cand_path = None
                if th_path:
                    p = Path(th_path).expanduser()
                    if p.is_file():
                        cand_path = p
                    else:
                        opt = p.parent / f"{int(d['id']):06d}-thumb-opt.jpg"
                        if opt.is_file():
                            cand_path = opt
                        else:
                            reg = p.parent / f"{int(d['id']):06d}-thumb.jpg"
                            if reg.is_file():
                                cand_path = reg
                if not cand_path and d.get("id"):
                    from backend.library.store import thumbnail_path
                    try:
                        p = thumbnail_path(d["id"])
                        if p and p.is_file():
                            cand_path = p
                    except Exception:
                        pass

                if cand_path and cand_path.is_file():
                    try:
                        import io
                        from PIL import Image
                        im = Image.open(cand_path)
                        im.thumbnail((320, 240))
                        buf = io.BytesIO()
                        im.convert("RGB").save(buf, format="JPEG", quality=75, optimize=True)
                        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                        thumb_url = f"data:image/jpeg;base64,{b64}"
                    except Exception:
                        try:
                            if cand_path.stat().st_size <= 200 * 1024:
                                b64 = base64.b64encode(cand_path.read_bytes()).decode("ascii")
                                mime = "image/jpeg" if cand_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                                thumb_url = f"data:{mime};base64,{b64}"
                        except Exception:
                            pass

            # 4. Fallback to API endpoint
            if not thumb_url and (th_path or d.get("id")):
                thumb_url = f"/api/library/{d['id']}/thumbnail"

            d["thumbnail_url"] = thumb_url
            d["has_thumbnail"] = bool(thumb_url or th_path)
            items.append(d)

        lists = [dict(r) for r in conn.execute("SELECT * FROM library_lists ORDER BY id ASC").fetchall()]
        members = [dict(r) for r in conn.execute("SELECT * FROM library_list_members").fetchall()]

        catalog = {
            "version": 1,
            "app": "amethyst",
            "exported_at": datetime.now().isoformat(),
            "items": items,
            "lists": lists,
            "list_members": members,
        }
        catalog_bytes = json.dumps(catalog, indent=2).encode("utf-8")
        try:
            existing = await self.bridge._execute(
                "GOOGLEDRIVE_FIND_FILE",
                {"q": f"'{root_folder_id}' in parents and name = 'library-catalog.json' and trashed = false"},
            )
            file_id = None
            if isinstance(existing, dict) and existing.get("files"):
                file_id = existing["files"][0]["id"]

            if file_id:
                try:
                    await self.bridge.delete_file(file_id)
                except Exception:
                    pass
            await self.bridge.upload_file(
                name="library-catalog.json",
                content=catalog_bytes,
                mime_type="application/json",
                parent_id=root_folder_id,
            )
        except Exception as exc:
            log.warning("Could not export library-catalog.json to Drive: %s", exc)

    async def run_two_way_sync(self, root_folder_id: str | None = None) -> dict[str, Any]:
        """Execute complete two-way synchronization."""
        if LibrarySyncEngine._is_running:
            return self.get_status()

        LibrarySyncEngine._is_running = True
        LibrarySyncEngine._cancelled = False
        LibrarySyncEngine._status = {
            "is_running": True,
            "stage": "scanning",
            "found_drive_items": 0,
            "inbound_imported": 0,
            "uploaded_outbound": 0,
            "skipped_duplicates": 0,
            "errors": [],
            "last_error": None,
        }

        try:
            # 1. Resolve root folder ID
            root_id = root_folder_id
            from backend.library.storage.config import StorageConfigStore

            cfg_store = StorageConfigStore()
            cfg = cfg_store.get_config()

            if not root_id:
                root_id = cfg.get("gdrive_root_id")

            if not root_id:
                custom_path = cfg.get("gdrive_root_name")
                detect = await self.bridge.detect_library_root(
                    mode="custom" if custom_path else "auto",
                    custom_path=custom_path,
                )
                root_id = detect.get("folder_id")
                if not root_id:
                    target_name = custom_path or "Amethyst/library"
                    root_id = await self.bridge.ensure_verified_root(target_name, write_marker=True)

            if root_id:
                cfg_store.update_config(gdrive_root_id=root_id)

            if LibrarySyncEngine._cancelled:
                LibrarySyncEngine._status["stage"] = "cancelled"
                return self.get_status()

            # 2. Inbound Discovery
            drive_files = await self.scan_drive_items(root_id)
            LibrarySyncEngine._status["found_drive_items"] = len(drive_files)
            LibrarySyncEngine._status["stage"] = "importing"

            # Inbound ingestion
            for df in drive_files:
                if LibrarySyncEngine._cancelled:
                    break
                try:
                    res = await self.ingest_inbound_item(df)
                    if res.get("status") == "imported":
                        LibrarySyncEngine._status["inbound_imported"] += 1
                    elif res.get("status") == "skipped":
                        LibrarySyncEngine._status["skipped_duplicates"] += 1
                except Exception as exc:
                    log.warning("Inbound sync item failed: %s", exc)
                    LibrarySyncEngine._status["errors"].append(str(exc))
                    LibrarySyncEngine._status["last_error"] = str(exc)

            if LibrarySyncEngine._cancelled:
                LibrarySyncEngine._status["stage"] = "cancelled"
                return self.get_status()

            # 3. Outbound Migration of Local Items
            LibrarySyncEngine._status["stage"] = "uploading"
            from backend.library.storage.migration import MigrationEngine

            mig = MigrationEngine()
            await mig.build_manifest()

            while not LibrarySyncEngine._cancelled:
                batch = await mig.step(batch_size=5)
                completed = batch.get("completed", 0)
                failed = batch.get("failed", 0)
                LibrarySyncEngine._status["uploaded_outbound"] += completed
                if batch.get("error"):
                    LibrarySyncEngine._status["last_error"] = batch["error"]
                    break
                if completed == 0 and failed == 0:
                    break

            # 4. Export full catalog to Google Drive as library-catalog.json
            if root_id and not LibrarySyncEngine._cancelled:
                try:
                    await self.export_catalog_to_drive(root_id)
                except Exception as cat_export_err:
                    log.warning("Could not export catalog to Drive: %s", cat_export_err)

            LibrarySyncEngine._status["stage"] = "complete" if not LibrarySyncEngine._cancelled else "cancelled"

        except Exception as exc:
            err_str = str(exc).lower()
            is_offline = any(term in err_str for term in ("connect", "network", "offline", "unreachable", "name resolution", "timeout", "ehostunreach", "enotfound"))
            if is_offline:
                log.info("Two-way library sync paused (offline): %s", exc)
                LibrarySyncEngine._status["stage"] = "offline_paused"
                LibrarySyncEngine._status["last_error"] = "Offline: Sync paused until internet reconnected"
            else:
                log.exception("Two-way library sync failed: %s", exc)
                LibrarySyncEngine._status["stage"] = "failed"
                LibrarySyncEngine._status["last_error"] = str(exc)
                LibrarySyncEngine._status["errors"].append(str(exc))
        finally:
            LibrarySyncEngine._is_running = False
            LibrarySyncEngine._status["is_running"] = False

        return self.get_status()


_EXPORT_TASK: asyncio.Task | None = None


def schedule_catalog_export(delay: float = 3.0) -> None:
    """Schedule background catalog export to Google Drive with debounce."""
    global _EXPORT_TASK
    try:
        from backend.pairing.service import load_drive_inbox_settings
        cfg = load_drive_inbox_settings()
        root_id = cfg.root_folder_id
        if not root_id:
            return
    except Exception:
        return

    async def _debounced_export():
        try:
            await asyncio.sleep(delay)
            bridge = GoogleDriveBridge()
            if bridge.is_connected():
                engine = LibrarySyncEngine(bridge=bridge)
                await engine.export_catalog_to_drive(root_id)
        except Exception as exc:
            log.debug("Debounced catalog export skipped: %s", exc)

    try:
        loop = asyncio.get_running_loop()
        if _EXPORT_TASK and not _EXPORT_TASK.done():
            _EXPORT_TASK.cancel()
        _EXPORT_TASK = loop.create_task(_debounced_export())
    except RuntimeError:
        pass
