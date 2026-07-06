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
  asset_dir="app/src/main/assets"

  if [ -d "$asset_dir" ]; then
    if command -v rg >/dev/null 2>&1; then
      remote_refs=$(rg -n "https?://|fetch\\(" "$asset_dir" || true)
    else
      remote_refs=$(grep -RInE "https?://|fetch\\(" "$asset_dir" || true)
    fi

    if [ -n "$remote_refs" ]; then
      echo "Potential offline-boundary issue in Android assets:"
      printf '%s\n' "$remote_refs"
      echo "Core histogram demo must not depend on network resources."
      exit 1
    fi
  fi

  npm run test:histogram
  npm run test:offline

  if [ "${RUN_ANDROID_BUILD_VERIFY:-}" = "1" ]; then
    if [ -z "${JAVA_HOME:-}" ] || [ -z "${ANDROID_HOME:-}" ]; then
      echo "RUN_ANDROID_BUILD_VERIFY=1 requires JAVA_HOME and ANDROID_HOME."
      exit 1
    fi
    ./gradlew --offline assembleDebug
  else
    echo "Android build verification skipped. Set RUN_ANDROID_BUILD_VERIFY=1 with JAVA_HOME and ANDROID_HOME to build the APK."
  fi
fi

echo "Harness verification passed."
