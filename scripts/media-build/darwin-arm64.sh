#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This build must run natively on macOS arm64." >&2
  exit 1
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
LOCK="$ROOT/resources/media-binaries/source-lock.json"
MANIFEST_ROOT="$ROOT/resources/media-binaries/vcpkg"
WORK=${SERPENT_MEDIA_BUILD_DIR:-"$ROOT/.media-build/darwin-arm64"}
VCPKG_ROOT="$WORK/vcpkg"
OVERLAY_ROOT="$WORK/overlay-ports"
INSTALLED_ROOT="$WORK/vcpkg-installed"
HOST_TOOLS_ROOT="$WORK/host-tools"
ARTIFACT_ROOT="$ROOT/artifacts/media-binaries"
TRIPLET=serpent-arm64-osx-static
export VCPKG_ROOT

VCPKG_REPOSITORY=$(node -p "require('$LOCK').registry.repository")
VCPKG_TAG=$(node -p "require('$LOCK').registry.tag")
VCPKG_COMMIT=$(node -p "require('$LOCK').registry.commit")

mkdir -p "$WORK" "$ARTIFACT_ROOT"
if [ ! -d "$VCPKG_ROOT/.git" ]; then
  git clone --filter=blob:none --no-checkout "$VCPKG_REPOSITORY" "$VCPKG_ROOT"
fi
git -C "$VCPKG_ROOT" fetch --force --depth 1 origin "refs/tags/$VCPKG_TAG:refs/tags/$VCPKG_TAG"
git -C "$VCPKG_ROOT" checkout --detach --force "$VCPKG_COMMIT"
test "$(git -C "$VCPKG_ROOT" rev-parse HEAD)" = "$VCPKG_COMMIT"

"$VCPKG_ROOT/bootstrap-vcpkg.sh" -disableMetrics
node "$ROOT/scripts/media-build/prepare-vcpkg-overlay.mjs" \
  --vcpkg-root "$VCPKG_ROOT" \
  --output "$OVERLAY_ROOT"

rm -rf "$INSTALLED_ROOT"
export VCPKG_DISABLE_METRICS=1
export VCPKG_FEATURE_FLAGS=manifests,versions
export VCPKG_BINARY_SOURCES=clear
"$VCPKG_ROOT/vcpkg" install pkgconf:arm64-osx \
  --x-install-root="$HOST_TOOLS_ROOT"
export PKG_CONFIG="$HOST_TOOLS_ROOT/arm64-osx/tools/pkgconf/pkgconf"
test -x "$PKG_CONFIG"
"$VCPKG_ROOT/vcpkg" install \
  --x-manifest-root="$MANIFEST_ROOT" \
  --x-install-root="$INSTALLED_ROOT" \
  --triplet="$TRIPLET" \
  --overlay-ports="$OVERLAY_ROOT"

node "$ROOT/scripts/media-build/stage-vcpkg-bundle.mjs" \
  --platform darwin-arm64 \
  --triplet "$TRIPLET" \
  --installed-root "$INSTALLED_ROOT" \
  --vcpkg-root "$VCPKG_ROOT" \
  --resource-root "$ROOT/resources"

BUNDLE_ROOT="$WORK/bundle-root"
ARCHIVE="$ARTIFACT_ROOT/serpent-media-darwin-arm64.zip"
MANIFEST_CHECKSUM="$ARTIFACT_ROOT/serpent-media-darwin-arm64.manifest.sha256"
rm -rf "$BUNDLE_ROOT" "$ARCHIVE" "$ARCHIVE.sha256" "$MANIFEST_CHECKSUM"
mkdir -p "$BUNDLE_ROOT/ffmpeg" "$BUNDLE_ROOT/oiio" "$BUNDLE_ROOT/media-binaries"
cp -R "$ROOT/resources/ffmpeg/darwin-arm64" "$BUNDLE_ROOT/ffmpeg/"
cp -R "$ROOT/resources/oiio/darwin-arm64" "$BUNDLE_ROOT/oiio/"
cp -R "$ROOT/resources/media-binaries/darwin-arm64" "$BUNDLE_ROOT/media-binaries/"
cp "$ROOT/resources/media-binaries/source-lock.json" "$BUNDLE_ROOT/media-binaries/"
(cd "$BUNDLE_ROOT" && zip -q -r -X "$ARCHIVE" .)
(cd "$ARTIFACT_ROOT" && shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
(cd "$ROOT/resources/media-binaries/darwin-arm64" && \
  shasum -a 256 manifest.json > "$MANIFEST_CHECKSUM")
echo "Built $ARCHIVE"
