"""Day 1 widget contracts. The exported schema is the manifest source of truth."""

from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    design: str | None = Field(default=None, max_length=64, pattern=r"^[a-z]+-(?:sm|md|lg)-[0-9]{2}$")
    size: Literal["s", "m", "l", "wide", "tall"]
    height: int = Field(default=3, ge=1, le=10000)  # Legacy pixel height; grid geometry uses h.
    x: int | None = Field(default=None, ge=0, le=10000, strict=True)
    y: int | None = Field(default=None, ge=0, le=10000, strict=True)
    w: int | None = Field(default=None, ge=1, le=2, strict=True)
    h: int | None = Field(default=None, ge=1, le=2, strict=True)

    @model_validator(mode="after")
    def grid_footprint(self):
        values = (self.x, self.y, self.w, self.h)
        if all(value is None for value in values):
            return self
        if any(value is None for value in values):
            raise ValueError("Grid coordinates x, y, w, and h must be provided together")
        expected = {"s": (1, 1), "m": (2, 1), "l": (2, 2), "wide": (2, 1), "tall": (1, 2)}[self.size]
        if (self.w, self.h) != expected:
            raise ValueError("Grid footprint does not match widget size")
        return self

    @field_validator("design", mode="before")
    @classmethod
    def normalize_design(cls, value):
        if not value or not isinstance(value, str):
            return None
        study_map = {
            "linear": "media-sm-01",
            "signal": "media-sm-02",
            "floating": "media-sm-03",
            "progress": "media-sm-04",
            "equalizer": "media-sm-05",
            "classic": "media-md-01",
            "split": "media-md-02",
            "green": "media-md-03",
            "light": "media-md-04",
            "mono": "media-md-05",
            "studio": "media-lg-01",
            "lyrics": "media-lg-02",
            "queue": "media-lg-03",
            "dashboard": "media-lg-04",
            "album": "media-lg-05",
        }
        if value in study_map:
            return study_map[value]
        if value.startswith("now-playing-"):
            number = value.split("-")[-1]
            return f"media-md-{number.zfill(2)}"
        return value

    @field_validator("design")
    @classmethod
    def known_design(cls, value):
        if value is None:
            return value
        counts = {
            "calendar": {"sm": 9, "md": 6, "lg": 6}, "clock": {"sm": 13},
            "dashboard": {"sm": 6, "md": 2, "lg": 2}, "media": {"sm": 8, "md": 5, "lg": 5},
            "productivity": {"sm": 7, "md": 4}, "sports": {"sm": 7},
            "air": {"sm": 5}, "sun": {"sm": 5}, "travel": {"sm": 5}, "pc": {"sm": 4},
            "stocks": {"sm": 6}, "weather": {"sm": 9, "md": 2},
        }
        category, size, number = value.split("-")
        if not 1 <= int(number) <= counts.get(category, {}).get(size, 0):
            raise ValueError("Unknown Wigggle design")
        return value



class Layout(StrictModel):
    widgets: list[Position] = Field(max_length=50)

    @model_validator(mode="after")
    def unique(self):
        ids = [item.id for item in self.widgets]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate widget id")
        if any(item.x is not None for item in self.widgets):
            if any(item.x is None for item in self.widgets):
                raise ValueError("All widgets must have grid coordinates when any are provided")
            for index, item in enumerate(self.widgets):
                for other in self.widgets[:index]:
                    if item.x < other.x + other.w and item.x + item.w > other.x and item.y < other.y + other.h and item.y + item.h > other.y:
                        raise ValueError("Widget placements overlap")
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
