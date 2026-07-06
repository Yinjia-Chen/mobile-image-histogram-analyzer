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

for (let index = 0; index < optimized.HISTOGRAM_WIDTH; index += 1) {
  assert.strictEqual(
    baselineNormalized[index],
    optimizedNormalized[index],
    `baseline normalized bin ${index} must match optimized output`
  );
}

console.log("Baseline histogram fixture passed.");
