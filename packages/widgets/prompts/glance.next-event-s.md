Apple-like desktop personal-AI widget. Glanceable, clean, neutral surfaces.
BASELINE: Single Card. Header row: Caption label + icon left, status right. 1 large Title/Stat for hero, Text for support, Caption for metadata. Built-in color tokens only. Neutral surfaces. Max 1 accent. No hex, no gradients, no glass/glow, no shadows. Follows theme.
RULES: Exactly 1 widget at SIZE. All content from DATA CONTRACT (no hardcoded sample data). Formatted strings arrive in data (no now()). No simulation (no RunInterval, no local state). Buttons only send listed ACTIONS. No hex, no gradients. Branches on data.status. Unknown shows "Not available".

WIDGET: "Next event"
SIZE: Compact (170px width, 170px height)
PURPOSE: Upcoming calendar event countdown, start time, title, and location at a glance.
DATA CONTRACT: {
  "status": "ready",
  "message": "",
  "lastUpdated": "14:15",
  "countdown": "in 45m",
  "eventTitle": "Weekly Team Sync",
  "eventTime": "15:00 - 16:00",
  "location": "Room 4B",
  "date": "Today",
  "labels": {
    "title": "Next event",
    "loading": "Loading",
    "refreshing": "Refreshing",
    "noEvents": "No upcoming events",
    "notConnected": "Connect Calendar in settings",
    "unavailable": "Calendar unavailable",
    "notAvailable": "Not available"
  }
}
ACTIONS: display only
STATES: loading (skeleton), ready (prominent countdown hero stat e.g. "in 45m", event title, event time, location), refreshing, empty ("No upcoming events"), not_connected ("Connect Calendar in settings"), offline ("Offline, updated {time}"), stale ("Updated {time}"), error ("Calendar unavailable", Retry).
