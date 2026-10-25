from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.capabilities import CapabilityService, Kind
from backend.config import paths
from backend.dashboard import skills
from backend.dashboard.items import decide
from backend.skills.loader import forget_scan_cache


async def test_installed_skills_toggle_existing_capabilities(db, monkeypatch):
    folder = paths().skills_dir / "fixture-skill"
    folder.mkdir(parents=True)
    skill_file = folder / "SKILL.md"
    text = "---\nname: fixture-skill\ndescription: Test fixture\n---\nFixture instructions.\n"
    skill_file.write_text(text)
    forget_scan_cache()
    monkeypatch.setattr(skills, "tools", AsyncMock(return_value={"fixture_read": object()}))
    payload = await skills.provide()
    item = next(i for i in payload["items"] if i["id"] == "fixture-skill")
    assert item["tools"] == ["fixture_read"]
    body = skills.SkillInput(name="fixture-skill", enabled=not item["enabled"])
    draft = skills.draft("toggle", body)
    await decide("agent.skills", draft["draft_id"], False)
    assert CapabilityService().is_enabled(Kind.SKILL, body.name) == item["enabled"]
    draft = skills.draft("toggle", body)
    await decide("agent.skills", draft["draft_id"], True)
    assert CapabilityService().is_enabled(Kind.SKILL, body.name) == body.enabled
    assert skill_file.read_text() == text
    assert db.execute("SELECT count(*) FROM dashboard_permission_rules").fetchone()[0] == 0
    with pytest.raises(HTTPException):
        skills.draft("toggle", skills.SkillInput(name="../missing", enabled=True))
