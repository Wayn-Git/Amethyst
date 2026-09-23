#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "       Amethyst Desktop Installer        "
echo "========================================="

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)
    BIN_DIR="${HOME}/.local/bin"
    APP_DIR="${HOME}/.local/share/applications"
    mkdir -p "$BIN_DIR" "$APP_DIR"

    echo "==> Fetching latest release info from GitHub..."
    LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/wayn-wayn/amethyst/releases/latest" 2>/dev/null || echo "")

    if [ -z "$LATEST_JSON" ]; then
      DOWNLOAD_URL="https://github.com/wayn-wayn/amethyst/releases/latest/download/Amethyst-0.1.3-beta.AppImage"
    else
      DOWNLOAD_URL=$(echo "$LATEST_JSON" | grep -o 'https://[^"]*AppImage' | head -n 1 || echo "")
      if [ -z "$DOWNLOAD_URL" ]; then
        DOWNLOAD_URL="https://github.com/wayn-wayn/amethyst/releases/latest/download/Amethyst-0.1.3-beta.AppImage"
      fi
    fi

    TARGET_FILE="${BIN_DIR}/amethyst"
    echo "==> Downloading Amethyst from $DOWNLOAD_URL ..."
    curl -fSL "$DOWNLOAD_URL" -o "$TARGET_FILE"
    chmod +x "$TARGET_FILE"

    echo "==> Setting up application icon and desktop launcher..."
    ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
    mkdir -p "$ICON_DIR"
    curl -fsSL "https://raw.githubusercontent.com/wayn-wayn/amethyst/master/frontend/public/icon.png" -o "${ICON_DIR}/amethyst.png" 2>/dev/null || true

    cat > "${APP_DIR}/amethyst.desktop" <<EOF
[Desktop Entry]
Name=Amethyst
Comment=Amethyst Personal Intelligence Operating System
Exec=${TARGET_FILE}
Icon=amethyst
Terminal=false
Type=Application
Categories=Utility;Development;
EOF

    echo "==> Amethyst installed successfully to ${TARGET_FILE}!"
    echo "    Run 'amethyst' or open Amethyst from your application menu."
    ;;

  Darwin*)
    echo "==> Detected macOS ($ARCH). Fetching latest release info..."
    LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/wayn-wayn/amethyst/releases/latest" 2>/dev/null || echo "")
    if [ "$ARCH" = "arm64" ]; then
      DMG_NAME="Amethyst-0.1.3-beta-arm64.dmg"
    else
      DMG_NAME="Amethyst-0.1.3-beta.dmg"
    fi
    DOWNLOAD_URL="https://github.com/wayn-wayn/amethyst/releases/latest/download/${DMG_NAME}"
    if [ -n "$LATEST_JSON" ]; then
      MATCHED_URL=$(echo "$LATEST_JSON" | grep -o 'https://[^"]*'"$DMG_NAME" | head -n 1 || echo "")
      if [ -n "$MATCHED_URL" ]; then
        DOWNLOAD_URL="$MATCHED_URL"
      fi
    fi
    DMG_PATH="/tmp/Amethyst.dmg"
    echo "==> Downloading Amethyst DMG from $DOWNLOAD_URL ..."
    curl -fSL "$DOWNLOAD_URL" -o "$DMG_PATH"
    echo "==> Mounting and installing Amethyst to /Applications..."
    hdiutil attach "$DMG_PATH" -nobrowse -quiet
    cp -R /Volumes/Amethyst*/Amethyst.app /Applications/
    hdiutil detach /Volumes/Amethyst* -quiet || true
    rm -f "$DMG_PATH"
    echo "==> Amethyst installed to /Applications/Amethyst.app!"
    ;;

  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac
