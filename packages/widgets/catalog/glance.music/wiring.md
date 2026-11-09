# Wiring: `glance.music`

`Music.jsx` maps the live local MPRIS session from `backend/dashboard/music.py`
to the generated inset audio-card template. No sample track, artwork, lyrics,
queue or history is loaded at runtime.

| Template field | Live source | Missing value |
|---|---|---|
| `playback.title/artist/state` | Current player metadata and playback state | “Nothing playing” |
| `playback.elapsedSeconds` | MPRIS player position | Hidden when unavailable |
| `playback.durationSeconds` | MPRIS track duration | Hidden when unavailable |
| `playback.metadata` | Current album when provided | Empty list |
| `*Action` | Advertised MPRIS control, current player and track id | Control omitted |

Transport buttons create a playback draft through the widget action endpoint;
the user must approve it before the system applies the command.
