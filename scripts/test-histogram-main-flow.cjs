const assert = require("assert");
const histogram = require("../app/src/main/assets/app.js");

const fixtureRgba = new Uint8ClampedArray([
  0, 0, 0, 255,
  255, 255, 255, 255,
  255, 0, 0, 255,
  0, 255, 0, 255
]);

const sourceCalls = [];
const sourceCanvas = {
  width: 0,
  height: 0,
  getContext(type) {
    assert.strictEqual(type, "2d", "source canvas must request a 2d context");
    return {
      clearRect(x, y, width, height) {
        sourceCalls.push({ op: "clearRect", x, y, width, height });
      },
      drawImage(image, x, y, width, height) {
        sourceCalls.push({ op: "drawImage", imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, x, y, width, height });
      },
      getImageData(x, y, width, height) {
        sourceCalls.push({ op: "getImageData", x, y, width, height });
        return {
          data: fixtureRgba,
          width,
          height
        };
      }
    };
  }
};

const histogramCalls = [];
const histogramCanvas = {
  width: 0,
  height: 0,
  getContext(type) {
    assert.strictEqual(type, "2d", "histogram canvas must request a 2d context");
    return {
      set fillStyle(value) {
        this.currentFillStyle = value;
      },
      get fillStyle() {
        return this.currentFillStyle;
      },
      fillRect(x, y, width, height) {
        histogramCalls.push({ x, y, width, height, fillStyle: this.currentFillStyle });
      }
    };
  }
};

const fakeImage = {
  naturalWidth: 2,
  naturalHeight: 2
};

const times = [20, 27.5];
const result = histogram.generateHistogram(fakeImage, sourceCanvas, histogramCanvas, () => times.shift());

assert.deepStrictEqual(
  sourceCalls,
  [
    { op: "clearRect", x: 0, y: 0, width: 2, height: 2 },
    { op: "drawImage", imageWidth: 2, imageHeight: 2, x: 0, y: 0, width: 2, height: 2 },
    { op: "getImageData", x: 0, y: 0, width: 2, height: 2 }
  ],
  "main flow must draw the image and read real pixel data from source canvas"
);

assert.strictEqual(result.width, 2, "result records image width");
assert.strictEqual(result.height, 2, "result records image height");
assert.strictEqual(result.pixelCount, 4, "result records pixel count");
assert.strictEqual(result.elapsedMs, 7.5, "elapsed time covers the full generateHistogram flow");
assert.strictEqual(result.maxCount, 1, "fixture max count is 1");
assert.ok(result.metrics, "result includes acceptance and interpretation metrics");
assert.strictEqual(result.metrics.acceptance.binsLength, true, "self-check confirms 256 bins");
assert.strictEqual(result.metrics.acceptance.binsSumMatchesPixelCount, true, "self-check confirms sum(bins) equals pixel count");
assert.strictEqual(result.metrics.acceptance.pixelCountMatchesDimensions, true, "self-check confirms pixel count equals width x height");
assert.strictEqual(result.metrics.acceptance.canvasSize, true, "self-check confirms histogram canvas is 256x100");
assert.strictEqual(result.metrics.acceptance.normalizedRange, true, "self-check confirms normalized bins stay in 0..100");
assert.strictEqual(result.metrics.acceptance.elapsedUnderThreshold, true, "fixture elapsed time is under 300ms");
assert.strictEqual(result.metrics.performance.thresholdMs, 300, "performance threshold is the course target");
assert.strictEqual(result.metrics.performance.status, "达标", "fixture elapsed time is marked as passing");
assert.strictEqual(result.metrics.performance.performanceMargin, 97.5, "performance margin follows the requested formula");
assert.strictEqual(result.metrics.consistency.baselineElapsedMs, 407.1, "optimized page keeps the documented slow control reference");
assert.strictEqual(result.metrics.consistency.currentElapsedMs, 7.5, "optimized page compares the current generated result time");
assert.strictEqual(result.metrics.consistency.consistencyPassed, true, "consistency card passes when bins, pixels and normalization pass");
assert.strictEqual(result.metrics.consistency.checks.binsTotalConsistent, true, "consistency card confirms bin total");
assert.strictEqual(result.metrics.consistency.checks.pixelCountConsistent, true, "consistency card confirms pixel count");
assert.strictEqual(result.metrics.consistency.checks.normalizedConsistent, true, "consistency card confirms normalized output");
assert.strictEqual(result.metrics.consistency.checks.currentFaster, true, "current implementation is faster than the documented slow control reference");
assert.strictEqual(result.metrics.distribution.averageGray, 120.25, "average gray is weighted by bins");
assert.strictEqual(result.metrics.distribution.peakGray, 0, "first equal-count peak gray is reported");
assert.strictEqual(result.metrics.distribution.darkRatio, 0.25, "dark ratio covers bins 0-63");
assert.strictEqual(result.metrics.distribution.midRatio, 0.5, "mid ratio covers bins 64-191");
assert.strictEqual(result.metrics.distribution.brightRatio, 0.25, "bright ratio covers bins 192-255");
assert.strictEqual(result.metrics.distribution.conclusion, "亮度分布较均衡", "balanced fixture keeps a neutral rule conclusion");
assert.strictEqual(histogram.sumBins(result.bins), 4, "all pixels are counted once");
assert.strictEqual(result.bins[0], 1, "black fixture pixel reaches bin 0");
assert.strictEqual(result.bins[255], 1, "white fixture pixel reaches bin 255");
assert.strictEqual(result.bins[76], 1, "red fixture pixel reaches rounded gray bin 76");
assert.strictEqual(result.bins[150], 1, "green fixture pixel reaches rounded gray bin 150");
assert.strictEqual(result.normalized[0], 100, "non-empty equal-count bins normalize to 100");
assert.strictEqual(result.normalized[1], 0, "empty bins normalize to 0");
assert.strictEqual(histogramCanvas.width, 256, "histogram canvas source width is 256");
assert.strictEqual(histogramCanvas.height, 100, "histogram canvas source height is 100");
assert.ok(
  histogramCalls.some((call) => call.x === 0 && call.y === 0 && call.width === 1 && call.height === 100 && call.fillStyle === "#000000"),
  "drawn histogram includes the black bin column"
);

console.log("Histogram main-flow fixture passed.");
