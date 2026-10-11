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
      DOWNLOAD_URL="https://github.com/wayn-wayn/amethyst/releases/latest/download/Amethyst-0.1.0.AppImage"
    else
      DOWNLOAD_URL=$(echo "$LATEST_JSON" | grep -o 'https://[^"]*AppImage' | head -n 1 || echo "")
      if [ -z "$DOWNLOAD_URL" ]; then
        DOWNLOAD_URL="https://github.com/wayn-wayn/amethyst/releases/latest/download/Amethyst-0.1.0.AppImage"
      fi
    fi

    TARGET_FILE="${BIN_DIR}/amethyst"
    echo "==> Downloading Amethyst from $DOWNLOAD_URL ..."
    curl -fSL "$DOWNLOAD_URL" -o "$TARGET_FILE"
    chmod +x "$TARGET_FILE"

    echo "==> Creating desktop launcher..."
    cat > "${APP_DIR}/amethyst.desktop" <<EOF
[Desktop Entry]
Name=Amethyst
Comment=Amethyst Personal Intelligence Operating System
Exec=${TARGET_FILE}
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=Utility;Development;
EOF

    echo "==> Amethyst installed successfully to ${TARGET_FILE}!"
    echo "    Run 'amethyst' or open Amethyst from your application menu."
    ;;

  Darwin*)
    echo "==> Detected macOS. Downloading Amethyst DMG..."
    DMG_PATH="/tmp/Amethyst.dmg"
    curl -fSL "https://github.com/wayn-wayn/amethyst/releases/latest/download/Amethyst-0.1.0.dmg" -o "$DMG_PATH"
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
