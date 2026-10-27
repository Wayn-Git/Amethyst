"""Provider auto-detection package."""
from backend.detectors.registry import (
    BaseDetector,
    DetectedProvider,
    get_cached_detection,
    register_detector,
    scan_all_detectors,
)

__all__ = [
    "BaseDetector",
    "DetectedProvider",
    "get_cached_detection",
    "register_detector",
    "scan_all_detectors",
]
