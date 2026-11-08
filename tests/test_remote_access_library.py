from __future__ import annotations

import pytest
from backend.security.remote_access import capability, allowed
from backend.sync.devices import Device

def test_capability_mapping_for_library_routes():
    assert capability("/api/library/1/enrich", "POST") == "library"
    assert capability("/api/library/1/reindex", "POST") == "library"
    assert capability("/api/library/1", "PUT") == "library"
    assert capability("/api/library/1", "DELETE") == "library"
    assert capability("/api/library", "POST") == "library"
    assert capability("/api/library/sync/start", "POST") == "library"
    assert capability("/api/library/sync/status", "GET") == "library"
    assert capability("/api/ai/transform", "POST") == "paired"
    assert capability("/api/remote/credentials/bundle", "GET") == "paired"

def test_allowed_checks_device_permissions():
    dev = Device(
        id="phone_1",
        name="Phone",
        role="control",
        permissions={"library": True},
    )
    assert allowed(dev, "library") is True
    assert allowed(dev, "paired") is True
    assert allowed(dev, "system") is False
