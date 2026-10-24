#!/usr/bin/env bash
set -euo pipefail

REPO="Wayn-Git/Amethyst"

echo "Creating GitHub releases for $REPO..."

gh release create v0.1.0 \
  --repo "$REPO" \
  --title "0.1.0-beta" \
  --notes "Release for tag v0.1.0" \
  --prerelease || true

gh release create v0.1.1 \
  --repo "$REPO" \
  --title "0.1.1-beta" \
  --notes "Release for tag v0.1.1" \
  --prerelease || true

gh release create v0.1.2 \
  --repo "$REPO" \
  --title "0.1.2-beta" \
  --notes "Release for tag v0.1.2" \
  --prerelease || true

gh release create v0.1.3-beta \
  --repo "$REPO" \
  --title "0.1.3-beta" \
  --notes "Release 0.1.3-beta: Onboarding splash wizard, library bento grid & inline video playback, multi-facet filter desk, Composio connectors overhaul, turn metrics tracing, and fact memory restoration with Wayn squircle geometry." \
  --prerelease || true

echo "GitHub releases synced successfully!"
