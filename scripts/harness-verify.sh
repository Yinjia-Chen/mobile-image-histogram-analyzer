#!/usr/bin/env bash
set -euo pipefail

npm run harness:check-docs

if [ -d "web" ]; then
  if command -v rg >/dev/null 2>&1; then
    remote_refs=$(rg -n "https?://|fetch\\(" web || true)
  else
    remote_refs=$(grep -RInE "https?://|fetch\\(" web || true)
  fi

  if [ -n "$remote_refs" ]; then
    echo "Potential offline-boundary issue in web/:"
    printf '%s\n' "$remote_refs"
    echo "Core histogram demo must not depend on network resources."
    exit 1
  fi
fi

if [ -d "app" ]; then
  echo "Android app directory detected. Add Gradle/APK verification to scripts/harness-verify.sh when build files are ready."
fi

echo "Harness verification passed."

