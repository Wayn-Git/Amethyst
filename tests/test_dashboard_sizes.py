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


def test_grid_coordinates_are_optional_atomic_and_match_widget_footprint():
    from backend.dashboard.models import Layout

    legacy = Layout.model_validate({"widgets": [{"id": "glance.clock", "size": "s", "height": 250}]})
    assert legacy.widgets[0].h is None
    layout = Layout.model_validate({"widgets": [
        {"id": "glance.clock", "size": "s", "x": 0, "y": 0, "w": 1, "h": 1},
        {"id": "glance.weather", "size": "m", "x": 1, "y": 0, "w": 2, "h": 1},
    ]})
    assert layout.widgets[1].h == 1
    with pytest.raises(ValidationError):
        Layout.model_validate({"widgets": [{"id": "glance.clock", "size": "s", "x": 0, "y": 0}]})
    with pytest.raises(ValidationError):
        Layout.model_validate({"widgets": [
            {"id": "glance.clock", "size": "s", "x": 0, "y": 0, "w": 1, "h": 1},
            {"id": "glance.weather", "size": "m", "x": 0, "y": 0, "w": 2, "h": 1},
        ]})
    with pytest.raises(ValidationError):
        Position.model_validate({"id": "glance.clock", "size": "s", "x": 0, "y": 0, "w": 1, "h": 2})
    with pytest.raises(ValidationError):
        Position.model_validate({"id": "glance.clock", "size": "s", "x": 0.5, "y": 0, "w": 1, "h": 1})
