## glance.weather
```prompt
Design an expressive macOS Weather widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: storm canvas with hourly strip, navy split with five forecasts, cobalt stacked ranges, inset humidity/wind cards, or teal dot-matrix. Select one family and adapt it consistently to all sizes. Small: live location, icon, current temperature as a 44px+ hero, condition, and exactly one detail; no forecast rows. Medium: small content plus exactly one forecast block. Large: medium content plus one useful forecast block. Use only supplied live data fields (location, current readings, 12 hourly readings, seven daily readings); never invent city, values, forecast entries or artwork. Keep every label legible, at least 11px except the hero, and unclipped. Use 24px outer corners, 16px small/20px other padding, 8px spacing grid, 12px group gaps, accessible light/dark contrast, and theme-compatible colors. Preserve the chosen composition; no gallery or selector.
```

## glance.clock
```prompt
Design an expressive macOS Clock widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: complication dial, daylight arc chrono, neon ring, cobalt world-time rows, or dual-zone inset cards. Select one family and adapt it consistently to all sizes. Small: live local time or dial, local timezone label and one date detail; no world rows. Medium: small content plus either three saved world zones or one inset metric block. Large: medium content plus up to five saved zones with live local times and day offsets. Use only the saved world zones and timezone settings supplied at runtime; do not invent cities, zones or times. Keep text at least 11px except the hero, use 24px outer corners, 16px small/20px other padding, 8px spacing grid and 12px group gaps, with accessible light/dark contrast. No repeated rows, clipping, gallery or selector.
```

## glance.music
```prompt
Create a premium collection of native Apple-style Now Playing Music widgets for a macOS desktop dashboard based on the attached visual reference. Generate 4 genuinely different compositions across Small (160x160), Medium (340x160), and Large (340x340).

DESIGN PHILOSOPHY:
Apple Music native design language. Natural materials, 24px squircles, thoughtful spacing, beautiful typography, balanced compositions.

COMPOSITIONS:
1. Minimal: Restrained whitespace, focus on track metadata, discreet playback badge.
2. Artwork-Immersive: Dominant artwork presence, subtle dark scrim or tinted wash, floating transport.
3. Control-Rich: Refined transport controls (skip-back, play/pause, skip-forward), progress scrubber bar with timestamps, volume or device pill.
4. Editorial: Elegant asymmetric layout, flush artwork, refined typographic hierarchy.

CONTENT LIMITS:
Small (160x160): Cover art, track title, artist, playback control. No scrubber.
Medium (340x160): Small content plus progress bar, elapsed/remaining time, full playback controls.
Large (340x340): Medium content plus queue preview snippet or rich track info, quiet "Nothing playing" fallback.

All text >= 11px, 24px corners, 16px padding on Small, 20px on Medium/Large. Accessible contrast.
```

## glance.next-event
```prompt
Design an expressive macOS Next Event widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: split calendar, neon countdown, teal dot-matrix date, cobalt agenda, or inset time block. Select one family and adapt it consistently to all sizes. Small: live event title, start time, and exactly one countdown/date detail; no agenda. Medium: small content plus one block with the live event's time range and real location or meeting link if available. Large: medium content plus up to three real upcoming events. Use only calendar payload values. Never fabricate events, dates, join controls, location, or meeting links. Keep text at least 11px except the hero, use 24px outer corners, 16px small/20px other padding, 8px spacing grid and 12px group gaps, accessible light/dark contrast, and no clipping. No gallery or selector.
```

## glance.sun
```prompt
Design an expressive macOS Sunrise and Sunset widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: horizon arc dial, twilight countdown, dual-time inset cards, dark daylight ring, or terracotta dawn. Select one family and adapt it consistently to all sizes. Small: next sun event label, time and one simple visual; no metric grid. Medium: small content plus live sunrise/sunset times and daylight duration. Large: medium content plus metrics only when present in live data. Current backend supplies sunrise, sunset, and timezone only, so do not invent solar noon, golden hour, UV, history, or daylight percentage. Keep text at least 11px except the hero, use 24px outer corners, 16px small/20px other padding, 8px spacing grid and 12px group gaps, accessible light/dark contrast, and no clipping. No gallery or selector.
```

## glance.air
```prompt
Design an expressive macOS Air Quality widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: segmented spectrum, vertical pollutant pills, bordered trend, dark purity ring, or teal dot-matrix. Select one family and adapt it consistently to all sizes. Small: live AQI value, category, location and one simple visual; no pollutant list. Medium: small content plus exactly one block using available live pollutants. Large: medium content plus a four-pollutant breakdown and health note only if derivable from provided readings. The provider supplies current US/EU AQI, PM2.5, PM10, carbon monoxide, nitrogen dioxide, ozone and time; it does not supply history/trend. Never invent missing readings or health claims. Keep text at least 11px except the hero, use 24px outer corners, 16px small/20px other padding, 8px spacing grid and 12px group gaps, accessible contrast, and no clipping. No gallery or selector.
```

## glance.travel
```prompt
Design an expressive macOS Travel Time widget using all attached images as visual references. Generate one coherent composition with Small (160x160), Medium (340x160), and Large (340x340) layouts for light and dark themes. Use the provided ideas as composition options: split-flap map, route nodes, mode stepper, dark street scrim, or cobalt stack. Select one family and adapt it consistently to all sizes. Small: live travel duration, event name, and one simple detail. Medium: small content plus the real destination and event start time. Large: medium content plus only additional route information supplied at runtime. Current provider supplies one Google Maps driving duration for the next located calendar event, home and destination; it does not supply map tiles, traffic, leave-by time, or other travel modes. Never invent route details or estimates. Keep text at least 11px except the hero, use 24px outer corners, 16px small/20px other padding, 8px spacing grid and 12px group gaps, accessible contrast, and no clipping. No gallery or selector.
```
