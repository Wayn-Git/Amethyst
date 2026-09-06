"""ffmpeg utilities for extracting frames from video for vision models."""

import logging
from pathlib import Path

from backend.media.audio import MediaError, _run, ffmpeg_missing

log = logging.getLogger(__name__)

async def extract_frames(
    source: Path, destination_dir: Path, count: int = 3, *, timeout: float = 60.0
) -> list[Path]:
    """Extract a specified number of frames from a video file.
    
    Frames are evenly spaced across the video duration.
    Returns the paths to the extracted JPEG files.
    """
    missing = ffmpeg_missing()
    if missing:
        raise MediaError(missing)

    destination_dir.mkdir(parents=True, exist_ok=True)
    
    from backend.media.audio import probe_duration
    duration = await probe_duration(source, timeout=timeout)
    
    if not duration or duration <= 0:
        # fallback: 1 frame every 3 seconds
        fps = "1/3"
    else:
        # We want `count` frames.
        fps = f"{count}/{duration}"

    # Extract frames as frame_001.jpg, frame_002.jpg, etc.
    output_pattern = destination_dir / "frame_%03d.jpg"
    
    # Scale width to 720 or 512, maintain aspect ratio. -1 in height maintains AR.
    code, output = await _run(
        [
            "ffmpeg",
            "-y",
            "-i", str(source),
            "-vf", f"fps={fps},scale=720:-1",
            "-vframes", str(count),
            "-q:v", "5",
            str(output_pattern)
        ],
        timeout=timeout,
        workspace=str(destination_dir),
    )
    
    if code != 0:
        log.debug("ffmpeg failed to extract frames: %s", output)
        raise MediaError(f"ffmpeg could not extract frames: {output.strip()[-300:]}")
        
    frames = sorted(destination_dir.glob("frame_*.jpg"))
    if not frames:
        raise MediaError("ffmpeg succeeded but no frames were found")
        
    return frames
