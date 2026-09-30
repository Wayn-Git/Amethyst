"""Tests for local converter service addressing issues #47, #48, #49, #50, #51, #52."""
from __future__ import annotations

import tarfile
import zipfile

import pytest
from PIL import Image, ImageDraw

from backend.converter.service import (
    ConverterService,
    _get_category,
    _probe_media,
)


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv("AMETHYST_HOME", str(tmp_path / "home"))
    srv = ConverterService()
    srv.base_dir = tmp_path / "converter"
    srv.uploads_dir = srv.base_dir / "uploads"
    srv.outputs_dir = srv.base_dir / "outputs"
    srv.uploads_dir.mkdir(parents=True, exist_ok=True)
    srv.outputs_dir.mkdir(parents=True, exist_ok=True)
    return srv


def test_categories_include_archives_and_media():
    assert _get_category("zip") == "archive"
    assert _get_category("tar.gz") == "archive"
    assert _get_category("png") == "image"
    assert _get_category("pdf") == "pdf"
    assert _get_category("docx") == "document"
    assert _get_category("mp4") == "video"
    assert _get_category("avi") == "video"
    assert _get_category("mkv") == "video"
    assert _get_category("mp3") == "audio"


@pytest.mark.asyncio
async def test_archive_convert_zip_to_targz_and_back(service, tmp_path):
    """Addresses #47: converting archive files."""
    # Create sample zip file
    zip_source = tmp_path / "test_archive.zip"
    with zipfile.ZipFile(zip_source, "w") as zf:
        zf.writestr("hello.txt", "hello world content")
        zf.writestr("sub/nested.txt", "nested content")

    job_dir = tmp_path / "job_archive"
    job_dir.mkdir()

    # Convert zip -> tar.gz
    targz_dest = job_dir / "test_archive.tar.gz"
    res = service._archive_convert(zip_source, targz_dest, "tar.gz")
    assert res.exists()
    assert res.stat().st_size > 0

    with tarfile.open(res, "r:gz") as tf:
        names = tf.getnames()
        assert "hello.txt" in names
        assert "sub/nested.txt" in names

    # Convert tar.gz -> zip
    zip_dest = job_dir / "repacked.zip"
    res_zip = service._archive_convert(res, zip_dest, "zip")
    assert res_zip.exists()
    with zipfile.ZipFile(res_zip, "r") as zf:
        assert "hello.txt" in zf.namelist()


@pytest.mark.asyncio
async def test_ocr_extracts_real_text_from_image(service, tmp_path):
    """Addresses #52: OCR returns actual extracted text instead of garbled binary string."""
    img_path = tmp_path / "test_receipt.png"
    img = Image.new("RGB", (320, 80), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 30), "Invoice Total: $42.50", fill=(0, 0, 0))
    img.save(img_path)

    job_dir = tmp_path / "job_ocr"
    job_dir.mkdir()

    out_file = await service._extract_text(img_path, job_dir, {})
    assert out_file.exists()
    text = out_file.read_text(encoding="utf-8")
    assert "\ufffd" not in text, "Must never return replacement character garbage"
    assert "Invoice" in text or "42" in text or "Total" in text


@pytest.mark.asyncio
async def test_audio_extraction_rejects_silent_video_cleanly(service, tmp_path):
    """Addresses #50: Video without audio stream fails with a clean descriptive error."""
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not available")

    silent_video = tmp_path / "silent_test.mp4"
    # Create 1s silent test video
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x120:d=1", str(silent_video)],
        check=True,
        capture_output=True,
    )

    probe = _probe_media(silent_video)
    assert probe["has_video"] is True
    assert probe["has_audio"] is False

    job_dir = tmp_path / "job_audio"
    job_dir.mkdir()

    with pytest.raises(ValueError, match="does not contain an audio track"):
        await service._video_to_audio(silent_video, "mp3", job_dir, {})


@pytest.mark.asyncio
async def test_video_compress_handles_silent_video(service, tmp_path):
    """Addresses #51: Video compression succeeds without crashing on silent video."""
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not available")

    silent_video = tmp_path / "silent_compress.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x120:d=1", str(silent_video)],
        check=True,
        capture_output=True,
    )

    job_dir = tmp_path / "job_compress"
    job_dir.mkdir()

    compressed = await service._video_compress(silent_video, job_dir, {"crf": 32})
    assert compressed.exists()
    assert compressed.stat().st_size > 0


@pytest.mark.asyncio
async def test_pdf_to_docx_conversion(service, tmp_path):
    """Addresses #48: Converting PDF to DOCX uses writer_pdf_import."""
    import shutil

    if not shutil.which("soffice") and not shutil.which("libreoffice"):
        pytest.skip("LibreOffice not available")

    import fitz

    pdf_path = tmp_path / "sample_doc.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((50, 50), "Amethyst PDF to Word Test Document")
    doc.save(str(pdf_path))
    doc.close()

    job_dir = tmp_path / "job_docx"
    job_dir.mkdir()
    dest_path = job_dir / "sample_doc.docx"

    out = await service._libreoffice_convert(pdf_path, dest_path, "docx")
    assert out.exists()
    assert out.stat().st_size > 0
    assert out.suffix == ".docx"


@pytest.mark.asyncio
async def test_txt_conversion_from_various_formats(service, tmp_path):
    """Addresses #47: converting PDF or document to TXT uses _extract_text cleanly."""
    import fitz

    pdf_path = tmp_path / "hello_source.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Extracted Text Content From PDF")
    doc.save(str(pdf_path))
    doc.close()

    job_dir = tmp_path / "job_txt"
    job_dir.mkdir()

    res = await service._convert_file(pdf_path, "txt", job_dir, {})
    assert res.exists()
    content = res.read_text(encoding="utf-8")
    assert "Extracted Text Content From PDF" in content


@pytest.mark.asyncio
async def test_video_thumbnail_generation(service, tmp_path):
    """Addresses #49: generating a thumbnail frame for video formats like AVI / MP4."""
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not available")

    avi_path = tmp_path / "test_clip.avi"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1", str(avi_path)],
        check=True,
        capture_output=True,
    )

    thumb_path = tmp_path / "thumb.jpg"
    ok = service.generate_thumbnail(avi_path, thumb_path)
    assert ok is True
    assert thumb_path.exists()
    assert thumb_path.stat().st_size > 0

