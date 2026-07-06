# Mobile Image Histogram Analyzer

Android WebView + H5 Canvas mobile app for image histogram calculation and performance optimization.

## Project Decision

- Topic: image histogram calculation and performance optimization.
- App form: Android APK with a WebView shell.
- Core implementation: HTML, CSS, JavaScript, and Canvas.
- Backend: none.
- Runtime mode: offline local image processing after installation.

## Core Features

- Select a local image from the phone.
- Preview the selected image.
- Convert pixels to grayscale with:

```text
gray = red * 0.299 + green * 0.587 + blue * 0.114
```

- Count grayscale values from 0 to 255.
- Normalize counts to a 0-100 range.
- Render a 256x100 black-and-white histogram.
- Display histogram calculation time.

## Planned Deliverables

- Android APK.
- Android WebView shell source code.
- H5 Canvas source code.
- Requirements analysis.
- Outline design.
- Test plan and test report.
- User guide.
