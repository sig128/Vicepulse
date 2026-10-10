#!/usr/bin/env bash
# Downloads every GTADB "yanis,16" basemap tile (z0–z6, ~34k files, ~185 MB) from the pinned
# CC BY 4.0 repository commit in a single sparse git checkout, then merges them into the local
# tile cache the server reads. One bulk transfer instead of tens of thousands of HTTP requests.
set -euo pipefail
COMMIT=76d44848850222ab5051bc8f561316989b5c3570
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/data/cache"
TMP="$CACHE/gtadb-git"
mkdir -p "$CACHE/tiles/yanis,16"
rm -rf "$TMP"
git clone --filter=blob:none --no-checkout --sparse https://github.com/rolux/gtadb.org.git "$TMP"
git -C "$TMP" sparse-checkout set --no-cone '/maps/tiles/6/yanis,16/'
git -C "$TMP" checkout --quiet "$COMMIT"
for z in 0 1 2 3 4 5 6; do
  mkdir -p "$CACHE/tiles/yanis,16/$z"
  rsync -a --ignore-existing "$TMP/maps/tiles/6/yanis,16/$z/" "$CACHE/tiles/yanis,16/$z/"
  echo "z$z: $(ls "$CACHE/tiles/yanis,16/$z" | wc -l | tr -d ' ') tiles"
done
rm -rf "$TMP"
