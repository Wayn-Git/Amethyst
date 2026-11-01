You are designing one widget in a set that must look like it belongs to the same product: a desktop personal-AI app, clean and Apple-like, Linear/Raycast-level polish. It sits on a dashboard next to other small widgets, so it must be glanceable.

SHARED BASELINE
- Structure: a single Card. A header row with a small Caption label (and a small icon if it helps) on the left, and a status or one quiet action on the right. Then the content. Use the same header pattern in every widget.
- Type: one large Title or Stat for the single most important value, Text for supporting content, Caption for labels and metadata. At most three type sizes in one widget.
- Spacing: use the default Card padding and do not override it. Gap 3 between groups, gap 1 inside a group. Use whitespace instead of dividers and nested boxes.
- Color: built-in color tokens only. Neutral surfaces. At most one accent, used only for the primary action or the one thing that needs attention. Success, warning and danger colors only for real status, always together with words.
- Buttons: at most one primary action (solid, pill). Everything else is ghost or soft. Icon-only buttons have an aria label.
- Icons: built-in icons, small, one size everywhere.
- Avoid: gradients, glow, glassmorphism, decorative shadows, nested cards, heavy borders, decorative imagery, stock-looking filler.
- Theme: the widget follows the app's light or dark theme. Never force a theme on the Card.

PRODUCTION RULES
This is a real app widget, not a gallery demo.
1. Design exactly ONE widget at exactly the SIZE given. No tabs or pickers for choosing between designs, no collection titles, intro text, numbering or "study" labels, and no second design in the same template.
2. Everything shown comes from the DATA CONTRACT. Do not hardcode sample names, numbers, times or titles in the template. Fixed UI words (button labels, small captions) go in a "labels" object in the data.
3. Times, durations, dates and counts with units arrive as ready-to-show strings in the data. Do not compute them in the template and do not use now().
4. The data is the single source of truth. Do not simulate anything: no RunInterval, no timers, no local state that fakes a result (flipping a playing or done flag, advancing a progress bar, counting up). Buttons only send the actions listed under ACTIONS, as plain actions with a payload, and change nothing locally. Local state is allowed only for purely visual choices, such as a section opened or closed.
5. Only the actions listed exist. Do not add any other control: no extra buttons, skip or seek steps, toggles, sliders or selects. Never show a control disabled or faded to hint at a missing feature.
6. Do not write the words demo, preview, sample, illustrative, example or placeholder anywhere.
7. Images come only from the data field named under IMAGES. Never hardcode a URL and never use availableImages.
8. No hex colors, no gradients, no forced theme. Built-in tokens only.
9. No decorative animation. Motion only where it shows real activity from the data, for example a small indicator while status is "refreshing".
10. Use the data field names exactly as given. Do not rename, add or drop fields. If you think a field is missing, say so in designSpec instead of inventing it.

WIDGET: "Air quality"

PURPOSE
Current air quality reading (European AQI) and particulate matter levels (PM2.5, PM10) at a glance.

SIZE: Compact
Target width 170px. Single Card. Top Caption "Air quality" with small wind icon on the left. Large Hero Stat for the European AQI value and qualitative category label (e.g. "Good", "Moderate"). Below: PM2.5 and PM10 values with units.

DATA CONTRACT
The widget receives exactly this data. Use these field names and types.
{
  "status": "ready",
  "message": "",
  "lastUpdated": "12:30",
  "aqi": 32,
  "category": "Good",
  "pm2_5": "8.4 µg/m³",
  "pm10": "15.2 µg/m³",
  "labels": {
    "title": "Air quality",
    "pm25Label": "PM2.5",
    "pm10Label": "PM10",
    "setLocation": "Set location in settings"
  }
}

ACTIONS
display only, no controls

STATES
The data has a "status" field and the template must branch on it. Design every state listed below at this size. Keep the layout the same size in all states.
Status values for this widget:
- loading: skeleton in the shape of the ready layout, no bare spinner
- ready: normal view showing AQI and particulate readings
- refreshing: ready view plus a small quiet indicator
- empty: "Set location in settings" with a quiet hint
- offline: last known data marked "Offline, updated {lastUpdated}", or a short message if no data
- stale: data with "Updated {lastUpdated}" clearly visible
- error: "Air quality data unavailable" with a Retry action
Unknown values show "Not available", never 0. Do not claim "Live" or "Synced" unless the data says so.

IMAGES
no images, use initials or icons
