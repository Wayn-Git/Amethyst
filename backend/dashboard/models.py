"""Day 1 widget contracts. The exported schema is the manifest source of truth."""

from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(StrictModel):
    type: Literal["local", "library", "director", "git", "api", "rss", "composio", "llm"]
    toolkit: str | None = None


class Refresh(StrictModel):
    mode: Literal["poll", "push", "manual"]
    interval_s: int | None = Field(default=None, ge=10, le=86400)

    @model_validator(mode="after")
    def polling_interval(self):
        if self.mode == "poll" and self.interval_s is None:
            raise ValueError("Polling requires interval_s")
        return self


class Action(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    label: str = Field(min_length=1, max_length=80)
    gate: bool


class Manifest(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$")
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=200)
    icon: str = Field(default="grid", pattern=r"^[a-z][a-z0-9-]*$", max_length=60)
    group: Literal[
        "dashboard",
        "glance",
        "needs-you",
        "communication",
        "agent",
        "library",
        "tasks",
        "developer",
        "student",
        "feed",
        "life",
        "system",
        "proactive",
    ]
    tier: Literal["mvp", "v2", "later"]
    sizes: list[Literal["s", "m", "l", "wide", "tall"]] = Field(min_length=1, max_length=5)
    source: Source | list[Source]
    refresh: Refresh
    requires: list[str] = Field(default_factory=list)
    actions: list[Action] = Field(default_factory=list)
    empty: str = Field(min_length=1, max_length=200)


class Position(StrictModel):
    id: str
    size: Literal["s", "m", "l", "wide", "tall"]
    height: int = Field(default=3, ge=2, le=8)


class Layout(StrictModel):
    widgets: list[Position] = Field(max_length=50)

    @model_validator(mode="after")
    def unique(self):
        ids = [item.id for item in self.widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate widget id")
        return self


class QuietSettings(StrictModel):
    enabled: bool = False
    start: str = Field(default="22:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(default="07:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: str = "UTC"
    snoozed_until: str | None = None


class ClockSettings(StrictModel):
    zones: list[Annotated[str, Field(max_length=100)]] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def valid_zones(self):
        self.zones = [zone.strip() for zone in self.zones]
        if len(set(self.zones)) != len(self.zones):
            raise ValueError("This timezone is already shown")
        for zone in self.zones:
            try:
                ZoneInfo(zone)
            except (ValueError, ZoneInfoNotFoundError) as exc:
                raise ValueError("Use a timezone such as Europe/London") from exc
        return self
