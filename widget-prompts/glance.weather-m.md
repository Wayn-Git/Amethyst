Apple-like desktop personal-AI widget. Glanceable, clean, neutral surfaces.
BASELINE: Single Card. Header row: Caption label + icon left, status right. 1 large Title/Stat for hero, Text for support, Caption for metadata. Built-in color tokens only. Neutral surfaces. Max 1 accent. No hex, no gradients, no glass/glow, no shadows. Follows theme.
RULES: Exactly 1 widget at SIZE. All content from DATA CONTRACT (no hardcoded sample data). Formatted strings arrive in data (no now()). No simulation (no RunInterval, no local state). Buttons only send listed ACTIONS. No hex, no gradients. Branches on data.status. Unknown shows "Not available".

WIDGET: "Weather"
SIZE: Medium (356px width, 170px height)
PURPOSE: Current temperature, conditions, location, and hourly forecast at a glance.
DATA CONTRACT: {
  "status": "ready",
  "message": "",
  "lastUpdated": "12:00",
  "temperature": "28°",
  "condition": "Mostly Clear",
  "location": "Kolkata",
  "feelsLike": "Feels like 31°",
  "wind": "12 km/h",
  "rainAlert": "",
  "hours": [
    {"time": "13:00", "temp": "29°", "rain": "10%"},
    {"time": "14:00", "temp": "30°", "rain": "15%"},
    {"time": "15:00", "temp": "29°", "rain": "10%"},
    {"time": "16:00", "temp": "27°", "rain": "5%"}
  ],
  "labels": {
    "title": "Weather",
    "forecast": "Hourly forecast",
    "loading": "Loading",
    "refreshing": "Refreshing",
    "locationUnset": "Location unset in settings",
    "unavailable": "Weather data unavailable",
    "notAvailable": "Not available"
  }
}
ACTIONS: display only
STATES: loading (skeleton in shape of medium card), ready (temperature, condition, location, and hourly row), refreshing, empty ("Location unset in settings"), offline ("Offline, updated {time}"), stale ("Updated {time}"), error ("Weather data unavailable", Retry).
