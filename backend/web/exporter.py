"""Document export service.

Converts structured Markdown responses into DOCX, styled HTML, and plain text
while preserving document hierarchy, headings, tables, code blocks, and formatting.
"""

from __future__ import annotations

import io
import re
from typing import Any

import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls


def _add_inline_runs(p, text: str):
    """Parse inline bold, italic, and inline code and add formatted runs to a paragraph."""
    # Pattern to match bold (**text**), italic (*text*), or inline code (`text`)
    pattern = re.compile(r"(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`|[^*`]+)")
    for part in pattern.findall(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) >= 4:
            run = p.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("*") and part.endswith("*") and len(part) >= 2:
            run = p.add_run(part[1:-1])
            run.italic = True
        elif part.startswith("`") and part.endswith("`") and len(part) >= 2:
            run = p.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
            run.font.color.rgb = RGBColor(180, 40, 90)
        else:
            p.add_run(part)


def markdown_to_docx(markdown_text: str, title: str | None = None) -> bytes:
    """Convert Markdown text into a styled Microsoft Word (.docx) document."""
    doc = docx.Document()

    # Set document margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    # Document title
    if title:
        h = doc.add_heading(title, level=0)
        h.alignment = WD_ALIGN_PARAGRAPH.LEFT

    lines = markdown_text.splitlines()
    i = 0
    in_code_block = False
    code_lines = []

    while i < len(lines):
        line = lines[i]

        # 1. Code blocks (```lang ... ```)
        if line.strip().startswith("```"):
            if in_code_block:
                # End of code block
                table = doc.add_table(rows=1, cols=1)
                table.autofit = False
                table.columns[0].width = Inches(6.5)
                cell = table.cell(0, 0)
                # Apply light gray background
                shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F4F4F5"/>')
                cell._tc.get_or_add_tcPr().append(shading)
                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(4)
                p.paragraph_format.space_after = Pt(4)
                run = p.add_run("\n".join(code_lines))
                run.font.name = "Consolas"
                run.font.size = Pt(9.5)
                run.font.color.rgb = RGBColor(30, 30, 35)
                code_lines = []
                in_code_block = False
            else:
                in_code_block = True
                code_lines = []
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        stripped = line.strip()
        if not stripped:
            i += 1
            continue

        # 2. Markdown Headings (#, ##, ###, ####)
        if stripped.startswith("#"):
            level = min(len(stripped) - len(stripped.lstrip("#")), 4)
            heading_text = stripped.lstrip("# ").strip()
            doc.add_heading(heading_text, level=level)
            i += 1
            continue

        # 3. Tables (Markdown pipe tables)
        if stripped.startswith("|") and stripped.endswith("|") and "|" in stripped[1:-1]:
            table_lines = [stripped]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1

            if len(table_lines) >= 2:
                # Parse header, separator, rows
                header_cols = [c.strip() for c in table_lines[0].strip("|").split("|")]
                # Skip separator line if present (e.g. |---|---|)
                data_rows = []
                for row_line in table_lines[1:]:
                    if re.match(r"^\|?[\s\-:|]+\|?$", row_line):
                        continue
                    cols = [c.strip() for c in row_line.strip("|").split("|")]
                    data_rows.append(cols)

                table = doc.add_table(rows=len(data_rows) + 1, cols=len(header_cols))
                table.style = "Table Grid"

                # Style Header Row
                for col_idx, col_name in enumerate(header_cols):
                    cell = table.cell(0, col_idx)
                    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="E4E4E7"/>')
                    cell._tc.get_or_add_tcPr().append(shd)
                    p = cell.paragraphs[0]
                    p.paragraph_format.space_before = Pt(3)
                    p.paragraph_format.space_after = Pt(3)
                    run = p.add_run(col_name)
                    run.bold = True

                # Fill Data Rows
                for row_idx, row_data in enumerate(data_rows):
                    for col_idx in range(min(len(row_data), len(header_cols))):
                        cell = table.cell(row_idx + 1, col_idx)
                        p = cell.paragraphs[0]
                        p.paragraph_format.space_before = Pt(2)
                        p.paragraph_format.space_after = Pt(2)
                        _add_inline_runs(p, row_data[col_idx])
            continue

        # 4. Bullet lists (- or *)
        if stripped.startswith("- ") or stripped.startswith("* "):
            bullet_text = stripped[2:].strip()
            p = doc.add_paragraph(style="List Bullet")
            p.paragraph_format.space_after = Pt(2)
            _add_inline_runs(p, bullet_text)
            i += 1
            continue

        # 5. Numbered lists (1. , 2. )
        num_match = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if num_match:
            num_text = num_match.group(2).strip()
            p = doc.add_paragraph(style="List Number")
            p.paragraph_format.space_after = Pt(2)
            _add_inline_runs(p, num_text)
            i += 1
            continue

        # 6. Blockquotes (> text)
        if stripped.startswith(">"):
            quote_text = stripped.lstrip("> ").strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.4)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(4)
            run = p.add_run(quote_text)
            run.italic = True
            run.font.color.rgb = RGBColor(100, 100, 110)
            i += 1
            continue

        # 7. Standard Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        _add_inline_runs(p, stripped)
        i += 1

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def markdown_to_html(markdown_text: str, title: str | None = None) -> str:
    """Convert Markdown to a standalone, styled HTML document."""
    doc_title = title or "Amethyst Document"
    lines = markdown_text.splitlines()
    html_body = []
    in_code = False
    code_lines = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Code block
        if stripped.startswith("```"):
            if in_code:
                code_content = "\n".join(code_lines)
                html_body.append(f"<pre><code>{code_content}</code></pre>")
                code_lines = []
                in_code = False
            else:
                in_code = True
                code_lines = []
            i += 1
            continue

        if in_code:
            code_lines.append(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        # Tables
        if stripped.startswith("|") and stripped.endswith("|") and "|" in stripped[1:-1]:
            table_lines = [stripped]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1

            if len(table_lines) >= 2:
                header_cols = [c.strip() for c in table_lines[0].strip("|").split("|")]
                data_rows = []
                for row_line in table_lines[1:]:
                    if re.match(r"^\|?[\s\-:|]+\|?$", row_line):
                        continue
                    cols = [c.strip() for c in row_line.strip("|").split("|")]
                    data_rows.append(cols)

                tbl_html = ["<table>", "<thead><tr>"]
                for h in header_cols:
                    tbl_html.append(f"<th>{h}</th>")
                tbl_html.append("</tr></thead>")
                tbl_html.append("<tbody>")
                for row in data_rows:
                    tbl_html.append("<tr>")
                    for col in row:
                        tbl_html.append(f"<td>{col}</td>")
                    tbl_html.append("</tr>")
                tbl_html.append("</tbody></table>")
                html_body.append("".join(tbl_html))
            continue

        # Headings
        if stripped.startswith("# "):
            html_body.append(f"<h1>{stripped[2:]}</h1>")
            i += 1
            continue
        elif stripped.startswith("## "):
            html_body.append(f"<h2>{stripped[3:]}</h2>")
            i += 1
            continue
        elif stripped.startswith("### "):
            html_body.append(f"<h3>{stripped[4:]}</h3>")
            i += 1
            continue
        elif stripped.startswith("- ") or stripped.startswith("* "):
            html_body.append(f"<li>{stripped[2:]}</li>")
            i += 1
            continue
        else:
            p_text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", stripped)
            p_text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", p_text)
            p_text = re.sub(r"`([^`]+)`", r"<code>\1</code>", p_text)
            html_body.append(f"<p>{p_text}</p>")
            i += 1

    joined_body = "\n".join(html_body)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{doc_title}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1e;
      background: #fafafa;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 24px;
    }}
    h1, h2, h3, h4 {{ color: #111; margin-top: 1.5em; }}
    h1 {{ border-bottom: 1px solid #eaeaea; padding-bottom: 8px; }}
    pre {{
      background: #f4f4f5;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: Consolas, Monaco, monospace;
      font-size: 14px;
    }}
    code {{
      background: #f0f0f2;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }}
    li {{ margin-bottom: 6px; }}
    table {{
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }}
    th, td {{
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }}
    th {{ background: #f4f4f5; font-weight: 600; }}
  </style>
</head>
<body>
  {joined_body}
</body>
</html>"""
