---
name: histogram-algorithm
lane: histogram_algorithm
---

# Histogram Algorithm Skill

Use this when touching H5 Canvas image processing, grayscale conversion,
histogram statistics, normalization, or chart drawing.

## Required Algorithm

For every RGB pixel:

```text
gray = red * 0.299 + green * 0.587 + blue * 0.114
```

The implementation must place the result into one of 256 integer bins from
`0` to `255`.

## Expected Pipeline

```text
load selected image
-> draw image to Canvas
-> read RGBA pixels
-> compute grayscale bin for each pixel
-> count 256 bins
-> find max count
-> normalize all bins to 0..100
-> draw a 256x100 black-and-white histogram
-> display elapsed time
```

## Accuracy Guardrails

- Keep exactly 256 bins.
- Normalize by the maximum bin count in the current image.
- Keep the histogram canvas or output bitmap at `256x100` unless a surrounding
  UI scales it for display while preserving the generated data.
- Do not use CSS-only bars as the source of truth if they can drift from the
  required output resolution.
- Do not change the grayscale formula to average RGB or a library default.
- Decide and document rounding behavior for gray values. Prefer a single
  explicit rule in code so tests can match it.

## Suggested Checks

When implementation exists, add small deterministic fixtures:

- pure black image -> bin `0` dominates;
- pure white image -> bin `255` dominates;
- simple RGB samples -> expected gray bin matches the chosen rounding rule;
- known small image -> 256-bin sum equals pixel count.

