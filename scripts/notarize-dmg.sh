#!/bin/bash
# Notarize and staple the DMG after electron-builder creates it.
# electron-builder only notarizes the .app; this script handles the DMG.
set -euo pipefail

DMG=$(ls dist/*-arm64.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "No DMG found in dist/"
  exit 1
fi

echo "Submitting $DMG for notarization..."
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$DMG"

echo "Done. DMG notarized and stapled: $DMG"
