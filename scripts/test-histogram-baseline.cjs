const assert = require("assert");
const optimized = require("../app/src/main/assets/app.js");
const baseline = require("../app/src/main/assets/baseline-app.js");

const fixtureRgba = new Uint8ClampedArray([
  0, 0, 0, 255,
  255, 255, 255, 255,
  255, 0, 0, 255,
  0, 255, 0, 255
]);

const optimizedBins = optimized.buildHistogramFromRgba(fixtureRgba);
const baselineBins = baseline.buildHistogramFromRgbaBaseline(fixtureRgba);

assert.strictEqual(baseline.BASELINE_REDUNDANT_PIXEL_ROUNDS, 160, "baseline should keep the expected slow-path pressure");
assert.strictEqual(optimized.sumBins(optimizedBins), 4, "optimized fixture counts all pixels");
assert.strictEqual(baseline.sumBins(baselineBins), 4, "baseline fixture counts all pixels");

for (let index = 0; index < optimized.HISTOGRAM_WIDTH; index += 1) {
  assert.strictEqual(baselineBins[index], optimizedBins[index], `baseline bin ${index} must match optimized bin`);
}

const optimizedNormalized = optimized.normalizeHistogram(optimizedBins);
const baselineNormalized = baseline.normalizeHistogramBaseline(baselineBins);
const optimizedDistribution = optimized.analyzeGrayDistribution(optimizedBins, 4);
const baselineDistribution = baseline.analyzeGrayDistribution(baselineBins, 4);

assert.deepStrictEqual(
  baselineDistribution,
  optimizedDistribution,
  "baseline distribution analysis must match optimized analysis for identical bins"
);
assert.strictEqual(
  baseline.createHistogramCompareInsight(baselineDistribution, optimizedDistribution),
  optimized.createHistogramCompareInsight(optimizedDistribution, baselineDistribution),
  "baseline and optimized compare helpers keep the same wording for identical distributions"
);
assert.strictEqual(baseline.normalizedBinsInRange(baselineNormalized), true, "baseline normalized bins stay in 0..100");

const baselineConsistency = baseline.createConsistencyComparison(
  { bins: baselineBins, pixelCount: 4 },
  {
    binsLength: true,
    binsSumMatchesPixelCount: true,
    pixelCountMatchesDimensions: true,
    normalizedRange: true
  },
  407.1,
  2.30
);

assert.strictEqual(baselineConsistency.consistencyPassed, true, "baseline comparison card passes identical-result checks");
assert.strictEqual(baselineConsistency.checks.currentFaster, true, "comparison card confirms the optimized reference is faster");

for (let index = 0; index < optimized.HISTOGRAM_WIDTH; index += 1) {
  assert.strictEqual(
    baselineNormalized[index],
    optimizedNormalized[index],
    `baseline normalized bin ${index} must match optimized output`
  );
}

console.log("Baseline histogram fixture passed.");
