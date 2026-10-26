"""Bento size vocabulary, without changing any registered widget sizes."""
import pytest
from pydantic import ValidationError

from backend.dashboard.models import Manifest, Position
from backend.dashboard.registry import REGISTRY


def test_bento_sizes_roundtrip():
    manifest = next(iter(REGISTRY.values()))["manifest"]
    for size in ("s", "m", "l", "wide", "tall"):
        assert Position.model_validate({"id": "glance.clock", "size": size}).size == size
    updated = Manifest.model_validate({**manifest, "sizes": ["s", "m", "l", "wide", "tall"]})
    assert updated.sizes[-2:] == ["wide", "tall"]
    with pytest.raises(ValidationError):
        Position(id="glance.clock", size="huge")
