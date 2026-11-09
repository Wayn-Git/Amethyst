"""Email-safe HTML templates for Amethyst Notifier.

Zero runtime dependencies. Pure Python standard library.
Ensures maximum compatibility across Outlook (Word engine), Gmail, Yahoo, Apple Mail.
Avoids broken CSS (box-shadow, CSS variables, flexbox, external fonts).
Uses table layouts, inline styles, and graceful border-radius degradation.
"""

from __future__ import annotations

import base64
import html
import re
from pathlib import Path
from typing import Any


def _escape(text: str) -> str:
    return html.escape(str(text))


def _format_inline_markdown(text: str) -> str:
    """Safely format inline markdown (links and bold) into email-safe HTML."""
    escaped = html.escape(text)

    # Convert markdown links [Label](url) -> <a> tag
    def link_repl(match: re.Match[str]) -> str:
        label = match.group(1)
        url = match.group(2)
        # Verify scheme to avoid javascript: urls
        safe_url = url if url.startswith(("http://", "https://", "mailto:")) else "#"
        return f'<a href="{safe_url}" style="color: #0E131F; text-decoration: underline; font-weight: 500;">{label}</a>'

    escaped = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link_repl, escaped)

    # Convert bold **text** -> <strong>
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong style="color: #0E131F; font-weight: 600;">\1</strong>', escaped)

    # Convert italic *text* or _text_ -> <em>
    escaped = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em style="color: #64748B;">\1</em>', escaped)

    return escaped


def render_base_card(
    *,
    badge: str,
    title: str,
    subtitle: str = "",
    preheader: str = "",
    content_html: str = "",
    footer_note: str = "Amethyst Notifier",
) -> str:
    """Render base responsive table card with email-safe styles."""
    safe_badge = _escape(badge)
    safe_title = _escape(title)
    safe_subtitle = _escape(subtitle)
    safe_preheader = _escape(preheader or title)
    safe_footer = _escape(footer_note)

    subtitle_block = (
        f'<p style="margin: 6px 0 0 0; font-size: 13px; line-height: 1.4; color: #64748B; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">{safe_subtitle}</p>'
        if safe_subtitle
        else ""
    )

    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{safe_title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F7F7F5; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <!-- Preheader preview text for email clients -->
  <div style="display: none !important; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    {safe_preheader}
  </div>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#F7F7F5" style="background-color: #F7F7F5; width: 100%;">
    <tr>
      <td align="center" style="padding: 36px 16px 44px 16px;">
        <!-- Card container -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; border-collapse: separate; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #F1F5F9; background-color: #FFFFFF;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 4px 10px; background-color: #F5F3FF; border: 1px solid #EDE9FE; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #7C3AED;">
                    {safe_badge}
                  </td>
                </tr>
              </table>
              <h1 style="margin: 12px 0 0 0; font-size: 22px; font-weight: 700; line-height: 1.3; color: #0E131F; letter-spacing: -0.02em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                {safe_title}
              </h1>
              {subtitle_block}
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 24px 32px 32px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; font-size: 14px; line-height: 1.6;">
              {content_html}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 16px 32px; background-color: #FAFAFA; border-top: 1px solid #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; color: #94A3B8; line-height: 1.5;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="color: #94A3B8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; letter-spacing: 0.04em;">
                    {safe_footer}
                  </td>
                  <td align="right" style="color: #94A3B8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; letter-spacing: 0.04em;">
                    AMETHYST AUTOMATED NOTIFIER
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def get_library_batch_attachments(items: list[dict[str, Any]]) -> list[Any]:
    """Build inline image attachments for AgentMail: logo, hero graphic, and item thumbnails."""
    attachments = []
    try:
        from agentmail.attachments.types.send_attachment import SendAttachment
    except ImportError:
        return []

    assets_dir = Path(__file__).resolve().parent / "assets"

    # 1. Brand logo
    logo_path = assets_dir / "icon.png"
    if logo_path.is_file():
        try:
            b64_logo = base64.b64encode(logo_path.read_bytes()).decode("utf-8")
            attachments.append(
                SendAttachment(
                    filename="icon.png",
                    content_type="image/png",
                    content_disposition="inline",
                    content_id="amethyst_logo",
                    content=b64_logo,
                )
            )
        except Exception:
            pass

    # 2. Item thumbnails
    for it in items:
        item_id = it.get("id")
        thumb_path_str = it.get("thumbnail_path")
        if not item_id or not thumb_path_str:
            continue
        p = Path(thumb_path_str)
        if p.is_file() and p.stat().st_size > 0:
            try:
                b64_content = base64.b64encode(p.read_bytes()).decode("utf-8")
                mime_type = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
                attachments.append(
                    SendAttachment(
                        filename=p.name,
                        content_type=mime_type,
                        content_disposition="inline",
                        content_id=f"thumb_{item_id}",
                        content=b64_content,
                    )
                )
            except Exception:
                pass
    return attachments


def render_library_batch_html(items: list[dict[str, Any]]) -> str:
    """Render clean, functional Library batch notification card matching user specification."""
    count = len(items)
    item_str = "item" if count == 1 else "items"
    preheader = f"You saved {count} {item_str} — Want to look at them on your laptop? Here is your batch."

    rows = []
    total = len(items)
    for idx, it in enumerate(items):
        item_id = it.get("id")
        raw_title = it.get("title") or "Untitled item"
        url = it.get("url") or "#"
        kind = (it.get("kind") or "link").lower()
        author = it.get("author")
        site = it.get("site")
        thumb_path_str = it.get("thumbnail_path")

        # Determine domain
        domain = ""
        if url and url != "#":
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc
                if domain.startswith("www."):
                    domain = domain[4:]
            except Exception:
                pass
        if not domain and site:
            domain = site

        # Check local thumbnail
        has_local_thumb = False
        if item_id and thumb_path_str:
            p = Path(thumb_path_str)
            if p.is_file() and p.stat().st_size > 0:
                has_local_thumb = True

        # Left media cell: high visibility 72x72 squircle thumbnail
        if has_local_thumb:
            media_cell = f"""
            <td style="width: 76px; vertical-align: middle; padding-right: 14px;">
              <a href="{_escape(url)}" style="text-decoration: none; display: block;">
                <img src="cid:thumb_{item_id}" width="72" height="72" style="width: 72px; height: 72px; border-radius: 8px; object-fit: cover; display: block; border: 1px solid #E5E7EB;" alt="" />
              </a>
            </td>
            """
        elif domain:
            media_cell = f"""
            <td style="width: 76px; vertical-align: middle; padding-right: 14px;">
              <a href="{_escape(url)}" style="text-decoration: none; display: block;">
                <div style="width: 72px; height: 72px; border-radius: 8px; border: 1px solid #E5E7EB; background-color: #F9FAFB; text-align: center; vertical-align: middle;">
                  <img src="https://www.google.com/s2/favicons?domain={_escape(domain)}&sz=64" width="28" height="28" style="width: 28px; height: 28px; border-radius: 4px; display: inline-block; margin-top: 22px;" alt="" />
                </div>
              </a>
            </td>
            """
        else:
            media_cell = ""

        # Title with arrow
        title_html = f'<a href="{_escape(url)}" style="color: #111827; text-decoration: none; font-weight: 600; font-size: 14px; line-height: 1.4; display: inline;">{_escape(raw_title)} &rarr;</a>'

        # Meta line: by Author • domain.com
        meta_parts = []
        if author:
            meta_parts.append(f"by {_escape(author)}")
        if domain:
            meta_parts.append(f'<a href="{_escape(url)}" style="color: #2563EB; text-decoration: underline;">{_escape(domain)}</a>')

        meta_line = (
            f'<div style="font-size: 12px; color: #6B7280; margin-top: 5px; line-height: 1.4;">{" &bull; ".join(meta_parts)}</div>'
            if meta_parts
            else ""
        )

        # Right badge: VIDEO / ARTICLE / KIND
        badge_label = kind.upper()
        badge_html = f'<span style="font-size: 11px; font-weight: 700; letter-spacing: 0.05em; padding: 4px 8px; background-color: #F3F4F6; color: #4B5563; border-radius: 4px; display: inline-block; white-space: nowrap; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;">{_escape(badge_label)}</span>'

        border_bottom_style = "border-bottom: 1px solid #F1F3F5;" if idx < total - 1 else ""

        rows.append(f"""
        <tr>
          <td style="padding: 14px 16px; {border_bottom_style} font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                {media_cell}
                <td style="vertical-align: middle;">
                  {title_html}
                  {meta_line}
                </td>
                <td align="right" style="vertical-align: middle; width: 65px; padding-left: 10px;">
                  {badge_html}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        """)

    items_table = "".join(rows)

    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You saved {count} {item_str}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F4F5F1; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <!-- Preheader text -->
  <div style="display: none !important; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    {_escape(preheader)}
  </div>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#F4F5F1" style="background-color: #F4F5F1; width: 100%;">
    <tr>
      <td align="center" style="padding: 36px 16px 44px 16px;">
        <!-- Card Container -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; border-collapse: separate; overflow: hidden;">
          <tr>
            <td style="padding: 32px 32px 28px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <!-- Top Brand Header (Logo + Title) -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td align="left" style="vertical-align: middle;">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 8px;">
                          <img src="cid:amethyst_logo" width="22" height="22" style="width: 22px; height: 22px; border-radius: 4px; display: block;" alt="Amethyst" />
                        </td>
                        <td style="vertical-align: middle; font-size: 15px; font-weight: 700; color: #111827; letter-spacing: -0.01em;">
                          Amethyst
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Library Badge Tag -->
              <div style="margin-bottom: 12px;">
                <span style="display: inline-block; padding: 3px 8px; background-color: #EDF0E8; color: #374151; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">
                  LIBRARY
                </span>
              </div>

              <!-- Main Title -->
              <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700; line-height: 1.25; color: #111827; letter-spacing: -0.02em;">
                You saved {count} {item_str}
              </h1>

              <!-- Subtitle -->
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5; color: #6B7280;">
                Want to look at them on your laptop? Here is your batch.
              </p>

              <!-- Inner Items Container (Bordered card containing items) -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 10px; border-collapse: separate; overflow: hidden; margin-bottom: 20px;">
                {items_table}
              </table>

              <!-- Device Mirror Note -->
              <div style="font-size: 13px; color: #6B7280; line-height: 1.5; margin-bottom: 28px;">
                Saved items are mirrored to your local library and available across your devices.
              </div>

              <!-- Divider Line -->
              <div style="border-top: 1px solid #E5E7EB; margin-bottom: 16px;"></div>

              <!-- Footer -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="font-size: 12px; color: #9CA3AF;">
                    Batch window: 10m
                  </td>
                  <td align="right" style="font-size: 12px; color: #9CA3AF;">
                    Amethyst Automated Agent
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def render_briefing_html(briefing_text: str, today_str: str) -> str:
    """Render Daily Morning Briefing markdown into clean email card."""
    lines = briefing_text.splitlines()

    notices: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current_section_title = "Summary"
    current_section_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("> ⚠️") or stripped.startswith(">"):
            notices.append(stripped.lstrip("> ").strip())
        elif stripped.startswith("### ") or stripped.startswith("## "):
            if current_section_lines:
                sections.append((current_section_title, list(current_section_lines)))
                current_section_lines = []
            current_section_title = stripped.lstrip("#").strip()
        elif stripped.startswith("# "):
            # Top-level title already in header
            continue
        else:
            current_section_lines.append(stripped)

    if current_section_lines:
        sections.append((current_section_title, list(current_section_lines)))

    content_blocks: list[str] = []

    # 1. Warning notices banner
    if notices:
        notice_items = "".join([f'<li style="margin-bottom: 4px;">{_escape(n)}</li>' for n in notices])
        content_blocks.append(f"""
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 12px 16px; color: #92400E; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <strong style="display: block; margin-bottom: 4px; color: #78350F;">Service Notices</strong>
              <ul style="margin: 0; padding-left: 18px;">
                {notice_items}
              </ul>
            </td>
          </tr>
        </table>
        """)

    # 2. Render each section as an email-safe table card
    for sec_title, sec_lines in sections:
        items_html = []
        for l in sec_lines:
            if l.startswith("- ") or l.startswith("* "):
                bullet_content = _format_inline_markdown(l[2:].strip())
                items_html.append(f"""
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; line-height: 1.5; color: #334155;">
                    <span style="display: inline-block; width: 4px; height: 4px; border-radius: 1px; background-color: #7C3AED; vertical-align: middle; margin-right: 8px;"></span>
                    {bullet_content}
                  </td>
                </tr>
                """)
            else:
                para_content = _format_inline_markdown(l)
                items_html.append(f"""
                <tr>
                  <td style="padding: 10px 14px; font-size: 13px; line-height: 1.5; color: #64748B;">
                    {para_content}
                  </td>
                </tr>
                """)

        content_blocks.append(f"""
        <div style="margin-bottom: 22px;">
          <h3 style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #0E131F; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; border-bottom: 2px solid #0E131F; padding-bottom: 6px;">
            {_escape(sec_title)}
          </h3>
          <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; border-collapse: separate;">
            {''.join(items_html)}
          </table>
        </div>
        """)

    return render_base_card(
        badge="Daily Brief",
        title=f"Morning Briefing",
        subtitle=today_str,
        preheader=f"Your morning summary for {today_str}",
        content_html="".join(content_blocks),
        footer_note="Amethyst Morning Briefing",
    )


def render_digest_html(items: list[dict[str, Any]], digest_text: str, week_str: str) -> str:
    """Render Weekly Library Digest card."""
    lines = [l.strip() for l in digest_text.splitlines() if l.strip()]

    items_html = []
    for l in lines:
        if l.startswith("#"):
            continue
        if l.startswith("---") or "Tip:" in l:
            continue
        if l.startswith("- ") or l.startswith("* "):
            content = _format_inline_markdown(l[2:].strip())
            items_html.append(f"""
            <tr>
              <td style="padding: 10px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; line-height: 1.5; color: #334155;">
                <span style="display: inline-block; width: 4px; height: 4px; border-radius: 1px; background-color: #7C3AED; vertical-align: middle; margin-right: 8px;"></span>
                {content}
              </td>
            </tr>
            """)

    content = f"""
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748B; line-height: 1.55;">
        Here are the items you saved recently that you haven't opened yet:
      </p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; border-collapse: separate; margin-bottom: 20px;">
        {''.join(items_html)}
      </table>
      <p style="margin: 0; font-size: 12px; color: #94A3B8; font-style: italic;">
        Tip: Open these on your desktop or laptop when you have downtime.
      </p>
    """

    return render_base_card(
        badge="Weekly Digest",
        title=f"Weekly Library Digest",
        subtitle=f"{len(items)} unread items &bull; {week_str}",
        preheader=f"Your weekly reading digest ({len(items)} unread items)",
        content_html=content,
        footer_note="Amethyst Library Digest",
    )


def render_test_verification_html() -> str:
    """Render System Test Verification card."""
    content = """
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.55;">
        Your automated notification system is properly connected and verified.
      </p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; border-collapse: separate; margin-bottom: 20px;">
        <tr>
          <td style="padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; color: #0E131F;">
            <strong style="color: #059669;">&#10003; AgentMail:</strong> Outbound email delivery operational
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; color: #0E131F;">
            <strong style="color: #059669;">&#10003; Turso Cloud DB:</strong> Deduplication and daily send quota active
          </td>
        </tr>
        <tr>
          <td style="padding: 12px 14px; font-size: 13px; color: #0E131F;">
            <strong style="color: #059669;">&#10003; Quiet Hours:</strong> Automatic batching and queue management enabled
          </td>
        </tr>
      </table>
      <p style="margin: 0; font-size: 13px; color: #64748B; line-height: 1.5;">
        You're all set to receive your automated daily morning briefings and weekly library digests.
      </p>
    """

    return render_base_card(
        badge="System Test",
        title="Amethyst Notifier Connected",
        subtitle="Verification delivery",
        preheader="Your automated notification system is verified and connected.",
        content_html=content,
        footer_note="System Connectivity Test",
    )
