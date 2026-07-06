#!/usr/bin/env sh

set -eu

if command -v gradle >/dev/null 2>&1; then
  exec gradle "$@"
fi

CACHED_GRADLE="$HOME/.gradle/wrapper/dists/gradle-8.14.3-bin/cv11ve7ro1n3o1j4so8xd9n66/gradle-8.14.3/bin/gradle"
if [ -x "$CACHED_GRADLE" ]; then
  exec "$CACHED_GRADLE" "$@"
fi

echo "Gradle is not installed and the cached Gradle 8.14.3 distribution was not found." >&2
echo "Open this project in Android Studio or install Gradle 8.14.3, then rerun ./gradlew." >&2
exit 1
