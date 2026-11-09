Apple-like desktop personal-AI widget. Glanceable, clean, neutral surfaces.
BASELINE: Single Card. Header row: Caption label + icon left, status right. 1 large Title/Stat for hero, Text for support, Caption for metadata. Built-in color tokens only. Neutral surfaces. Max 1 accent. No hex, no gradients, no glass/glow, no shadows. Follows theme.
RULES: Exactly 1 widget at SIZE. All content from DATA CONTRACT (no hardcoded sample data). Formatted strings arrive in data (no now()). No simulation (no RunInterval, no local state). Buttons only send listed ACTIONS. No hex, no gradients. Branches on data.status. Unknown shows "Not available".

WIDGET: "Sunrise and Sunset"
SIZE: Compact (170px width)
PURPOSE: Shows today's sunrise and sunset times clearly side by side.
DATA CONTRACT: {
  "status": "ready",
  "message": "",
  "lastUpdated": "06:00",
  "sunrise": "06:24 AM",
  "sunset": "05:42 PM",
  "dayLength": "11h 18m",
  "timezone": "Asia/Kolkata",
  "labels": {
    "title": "Sun",
    "sunrise": "Sunrise",
    "sunset": "Sunset",
    "dayLength": "Daylight",
    "loading": "Loading",
    "refreshing": "Refreshing",
    "locationUnset": "Location unset",
    "unavailable": "Solar times unavailable",
    "notAvailable": "Not available"
  }
}
ACTIONS: display only
STATES: loading (skeleton), ready (normal view), refreshing, empty ("Location unset"), offline ("Offline, updated {time}"), stale ("Updated {time}"), error ("Solar times unavailable", Retry).
