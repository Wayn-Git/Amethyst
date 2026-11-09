# Wiring: Unanswered Mentions (`need.mentions`)

## Overview
Connects the `@tugan/widgets` template for Unanswered Mentions to live aggregated mentions across Slack and GitHub.

## Data Source
- Backend provider: `backend/dashboard/mentions.py:provide("need.mentions")`
- Endpoint: `GET /api/widgets/need.mentions/data`
- Returns: `{ "items": [ { "id": str, "title": str, "url": str, "at": iso_str, "source": "Slack" | "GitHub" } ], "limited": boolean, "unavailable": list[str] }`

## Design Compositions
1. **Minimal**: Spotlight on latest unanswered mention with platform badge, sender, time, and preview.
2. **Unified inbox**: Combined chronological list across Slack and GitHub with sender initials and context.
3. **Grouped by platform**: Dedicated section per platform (Slack and GitHub) with platform counters.
4. **Timeline**: Visual chronological feed connected by vertical status dots.
5. **Priority-focused**: Highlighted waiting card for items over 24 hours with recent mentions feed.

## Footprints
- **Medium**: 356 × 170
- **Large**: 356 × 356
