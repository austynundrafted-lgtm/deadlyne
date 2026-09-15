#!/bin/bash
# Builds Deadlyne.app into ./build (release, signed with the best available certificate).
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release

APP=build/Deadlyne.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Deadlyne "$APP/Contents/MacOS/Deadlyne"

# App icon: rebuilt from the 1024×1024 artwork whenever the artwork changes.
ICON_SRC=Resources/AppIcon-source.png
if [ -f "$ICON_SRC" ] && { [ ! -f Resources/AppIcon.icns ] || [ "$ICON_SRC" -nt Resources/AppIcon.icns ]; }; then
  swift scripts/make_icon.swift "$ICON_SRC" Resources
fi
[ -f Resources/AppIcon.icns ] || { echo "Missing $ICON_SRC (square 1024×1024 artwork)"; exit 1; }
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Badge artwork (optional): Resources/Badges/<id>.png — see Resources/Badges/README.md.
if compgen -G "Resources/Badges/*.png" > /dev/null; then
  mkdir -p "$APP/Contents/Resources/Badges"
  cp Resources/Badges/*.png "$APP/Contents/Resources/Badges/"
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Deadlyne</string>
  <key>CFBundleDisplayName</key><string>Deadlyne</string>
  <key>CFBundleIdentifier</key><string>app.deadlyne.Deadlyne</string>
  <key>CFBundleExecutable</key><string>Deadlyne</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.photography</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Deadlyne — fast photo culling.</string>
  <key>NSDesktopFolderUsageDescription</key><string>Deadlyne browses and culls the photos in folders you open.</string>
  <key>NSDocumentsFolderUsageDescription</key><string>Deadlyne browses and culls the photos in folders you open.</string>
  <key>NSDownloadsFolderUsageDescription</key><string>Deadlyne browses and culls the photos in folders you open.</string>
  <key>NSRemovableVolumesUsageDescription</key><string>Deadlyne ingests photos from your memory cards.</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Folder</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSItemContentTypes</key><array><string>public.folder</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# Signing: a stable identity lets macOS remember Deadlyne's folder permissions across rebuilds.
# Preference: $DEADLYNE_SIGN_IDENTITY > Developer ID Application (distribution) > Apple Development > ad-hoc.
find_identity() {
  security find-identity -v -p codesigning | grep "\"$1" | head -1 | awk '{print $2}' || true
}
identity_name() {
  security find-identity -v -p codesigning | grep "$1" | head -1 | sed -E 's/.*"(.*)"/\1/' || true
}
IDENTITY="${DEADLYNE_SIGN_IDENTITY:-}"
[ -z "$IDENTITY" ] && IDENTITY=$(find_identity "Developer ID Application")
[ -z "$IDENTITY" ] && IDENTITY=$(find_identity "Apple Development")

if [ -n "$IDENTITY" ]; then
  NAME=$(identity_name "$IDENTITY")
  EXTRA=()
  [[ "$NAME" == Developer\ ID* ]] && EXTRA=(--timestamp)
  codesign --force --options runtime ${EXTRA[@]+"${EXTRA[@]}"} --sign "$IDENTITY" "$APP"
  echo "Signed with: $NAME"
else
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "Signed ad-hoc (no certificate found — permissions may re-prompt after rebuilds)"
fi
echo "Built $(pwd)/$APP"
