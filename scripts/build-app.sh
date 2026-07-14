#!/usr/bin/env bash
#
# build-app.sh — Build the Portiq desktop app for the current OS.
#
# Runs the web bundle (vite) and then packages a distributable desktop app
# (electron-builder) using the targets configured under "build" in
# package.json. The final step prints the absolute path(s) to the produced
# artifacts so you know exactly what to install/run.
#
# Usage:
#   ./scripts/build-app.sh
#
set -euo pipefail

# Always run from the repo root, regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$REPO_ROOT"

# Output directory (matches build.directories.output in package.json).
RELEASE_DIR="$REPO_ROOT/release"

# Map the current OS to the electron-builder platform flag. The concrete
# targets (dmg/zip, nsis/portable, AppImage/deb/rpm) come from package.json.
case "$(uname -s)" in
    Darwin)  PLATFORM_FLAG="--mac"   ; OS_NAME="macOS"   ;;
    Linux)   PLATFORM_FLAG="--linux" ; OS_NAME="Linux"   ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_FLAG="--win" ; OS_NAME="Windows" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2 ; exit 1 ;;
esac

APP_VERSION="$(node -p "require('./package.json').version")"

echo "==> Building Portiq v${APP_VERSION} for ${OS_NAME}"

echo "==> [1/2] Building web bundle (vite)"
npm run build

echo "==> [2/2] Packaging desktop app (electron-builder ${PLATFORM_FLAG})"
npx electron-builder build "$PLATFORM_FLAG" --publish never

# ---------------------------------------------------------------------------
# Final step: report where the usable build lives.
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " BUILD COMPLETE — Portiq v${APP_VERSION} (${OS_NAME})"
echo "============================================================"

if [ ! -d "$RELEASE_DIR" ]; then
    echo "WARNING: expected output directory not found: $RELEASE_DIR" >&2
    exit 1
fi

echo "Output directory: $RELEASE_DIR"
echo ""

# Report only the artifacts from THIS build. Installer files embed the version
# in their name (see build.artifactName in package.json), so filter to the
# current version — the release/ dir may also hold stale files from older
# versions, which electron-builder does not delete. The .app bundle path is
# not version-stamped but is regenerated on every run, so always include it.
FOUND=0
while IFS= read -r artifact; do
    echo "  • $artifact"
    FOUND=1
done < <(
    {
        find "$RELEASE_DIR" -maxdepth 2 -type f \
            \( -name "*${APP_VERSION}*.dmg" -o -name "*${APP_VERSION}*.zip" \
               -o -name "*${APP_VERSION}*.exe" -o -name "*${APP_VERSION}*.AppImage" \
               -o -name "*${APP_VERSION}*.deb" -o -name "*${APP_VERSION}*.rpm" \)
        find "$RELEASE_DIR" -maxdepth 2 -type d -name '*.app'
    } | sort -u
)

if [ "$FOUND" -eq 0 ]; then
    echo "  (no recognized artifacts found — check $RELEASE_DIR)"
    exit 1
fi

echo ""
echo "Use the path(s) above to install or run the app."
