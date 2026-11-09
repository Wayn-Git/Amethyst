# Wiring: Unreplied Slack DMs (`need.lor-slack`)

## Overview
Connects the `@tugan/widgets` template for Unreplied Slack DMs to live Slack direct messages via Composio connector.

## Data Source
- Backend provider: `backend/dashboard/communication.py:provide("need.lor-slack")`
- Endpoint: `GET /api/widgets/need.lor-slack/data`
- Returns: `{ "items": [ { "id": channel_id, "title": message_text, "url": permalink, "source": "Slack", "person": user_id, "ts": slack_timestamp } ], "limited": boolean }`

## Design Directions
1. **Minimal**: Spotlight on latest unreplied message with avatar, preview, wait duration badge.
2. **Conversation**: Message excerpts with chat bubble styling and response indicators.
3. **Inbox**: Clean organized list with count, avatars, timestamps, and message previews.
4. **Timeline**: Chronological vertical feed connected by a time rail.
5. **Priority**: Longest waiting highlighted callout banner with hourglass indicator and ranked queue.

## Footprints
- **Medium**: 356 × 170
- **Large**: 356 × 356
