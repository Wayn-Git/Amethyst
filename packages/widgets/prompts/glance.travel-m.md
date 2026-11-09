Apple-like desktop personal-AI widget. Glanceable, clean, neutral surfaces.
BASELINE: Single Card. Header row: Caption label + icon left, status right. 1 large Title/Stat for hero, Text for support, Caption for metadata. Built-in color tokens only. Neutral surfaces. Max 1 accent. No hex, no gradients, no glass/glow, no shadows. Follows theme.
RULES: Exactly 1 widget at SIZE. All content from DATA CONTRACT (no hardcoded sample data). Formatted strings arrive in data (no now()). No simulation (no RunInterval, no local state). Buttons only send listed ACTIONS. No hex, no gradients. Branches on data.status. Unknown shows "Not available".

WIDGET: "Travel time"
SIZE: Medium (356px width, 170px height)
PURPOSE: Driving duration and route to your next calendar event at a glance.
DATA CONTRACT: {
  "status": "ready",
  "message": "",
  "lastUpdated": "14:15",
  "duration": "25 min",
  "eventTitle": "Product Design Sync",
  "eventTime": "in 45 min",
  "route": "18 km via Main Expressway",
  "origin": "Home",
  "labels": {
    "title": "Travel time",
    "nextEvent": "Next event",
    "origin": "From",
    "loading": "Loading",
    "refreshing": "Refreshing",
    "noEvent": "No upcoming events with a location",
    "setLocation": "Set trip origin in settings",
    "notConnected": "Connect Calendar & Maps in settings",
    "unavailable": "Travel estimate unavailable",
    "notAvailable": "Not available"
  }
}
ACTIONS: display only
STATES: loading (skeleton), ready (prominent duration stat, event title, time, and route detail), refreshing, empty ("No upcoming events with a location"), not_connected ("Connect Calendar & Maps in settings"), offline ("Offline, updated {time}"), stale ("Updated {time}"), error ("Travel estimate unavailable", Retry).
