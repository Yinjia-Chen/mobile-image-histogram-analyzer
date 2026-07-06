---
name: mobile-webview-shell
lane: mobile_shell
---

# Mobile WebView Shell Skill

Use this when touching Android project setup, WebView loading, APK packaging,
permissions, local file selection, or native-to-H5 handoff.

## Project Boundary

Android owns the installable shell. H5 owns the histogram algorithm.

The Android layer should:

- package and load local H5 assets;
- initialize WebView safely for offline use;
- provide local image selection when needed;
- keep the APK demo path stable;
- avoid adding network or backend dependencies.

## Offline Guardrails

- The core demo must work with no network.
- Local H5 assets should be bundled with the APK or otherwise available from
  trusted local paths.
- Do not make histogram generation depend on remote scripts, CDN assets, remote
  images, analytics, or server APIs.

## Acceptance Checks

When Android code exists, verify:

- APK installs on the target Android device or emulator;
- the first screen loads without network;
- image selection works;
- selected image reaches the H5 processing path;
- app can generate and display a histogram.

