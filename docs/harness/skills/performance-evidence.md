---
name: performance-evidence
lane: performance_evidence
---

# Performance Evidence Skill

Use this when touching timing, optimization, benchmark data, or the `300ms`
performance target.

## Timing Boundary

The displayed generation time should cover the meaningful histogram-generation
work:

```text
pixel read
-> grayscale calculation
-> bin counting
-> normalization
-> histogram rendering
```

If a narrower timing boundary is used for comparison, label it clearly.

## Evidence To Record

For each benchmark row, record:

- device or emulator;
- image size or pixel count;
- implementation mode, such as baseline or optimized;
- measured time;
- repeated-run note when available;
- whether the result meets the target.

## Optimization Guardrails

- Do not optimize by changing the formula.
- Do not skip pixels unless the output is explicitly labeled approximate.
- Do not compare baseline and optimized modes with different timing boundaries.
- Prefer simple, explainable optimizations first: typed arrays, loop shape,
  avoiding repeated allocations, offscreen canvas where useful, and Web Worker
  only if supported by the WebView target.

## Suggested Output

Performance work should leave a table suitable for the final test report or
defense PPT.

