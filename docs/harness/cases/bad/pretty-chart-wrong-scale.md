---
type: bad
lanes:
  - histogram_algorithm
---

# Pretty Chart Wrong Scale

## Failure Mode

The UI shows an attractive histogram-like chart, but it is not generated from
256 grayscale bins normalized to a `0-100` height.

## Why It Hurts

The course task explicitly requires a `256x100` black-and-white histogram. A
pretty chart with arbitrary bars does not prove algorithm correctness.

## Avoid By

- Keeping the computed data as a 256-length array.
- Normalizing by the image's max bin count.
- Rendering to a `256x100` output before any display scaling.
- Adding fixture checks for obvious images.

