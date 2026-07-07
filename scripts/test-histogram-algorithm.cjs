const assert = require("assert");
const histogram = require("../app/src/main/assets/app.js");

function assertEqual(actual, expected, message) {
  assert.strictEqual(actual, expected, message);
}

function assertArrayValue(array, index, expected, message) {
  assert.strictEqual(array[index], expected, message);
}

assertEqual(histogram.HISTOGRAM_WIDTH, 256, "histogram width must be 256 bins");
assertEqual(histogram.HISTOGRAM_HEIGHT, 100, "histogram height must normalize to 100");

assertEqual(histogram.computeGrayBin(0, 0, 0), 0, "pure black maps to bin 0");
assertEqual(histogram.computeGrayBin(255, 255, 255), 255, "pure white maps to bin 255");
assertEqual(histogram.computeGrayBin(255, 0, 0), 76, "pure red uses weighted formula and round");
assertEqual(histogram.computeGrayBin(0, 255, 0), 150, "pure green uses weighted formula and round");
assertEqual(histogram.computeGrayBin(0, 0, 255), 29, "pure blue uses weighted formula and round");

const rgba = new Uint8ClampedArray([
  0, 0, 0, 255,
  255, 255, 255, 255,
  255, 0, 0, 255,
  0, 255, 0, 255
]);
const bins = histogram.buildHistogramFromRgba(rgba);

assertEqual(bins.length, 256, "computed histogram must contain 256 bins");
assertEqual(histogram.sumBins(bins), 4, "every pixel must be counted once");
assertArrayValue(bins, 0, 1, "black pixel increments bin 0");
assertArrayValue(bins, 255, 1, "white pixel increments bin 255");
assertArrayValue(bins, 76, 1, "red pixel increments rounded formula bin");
assertArrayValue(bins, 150, 1, "green pixel increments rounded formula bin");

const manualBins = new Uint32Array(256);
manualBins[10] = 5;
manualBins[20] = 10;
const normalized = histogram.normalizeHistogram(manualBins);

assertEqual(normalized.length, 256, "normalized histogram must contain 256 bins");
assertArrayValue(normalized, 10, 50, "half of max count normalizes to 50");
assertArrayValue(normalized, 20, 100, "max count normalizes to 100");
assertArrayValue(normalized, 30, 0, "empty bins normalize to 0");
assertEqual(histogram.normalizedBinsInRange(normalized), true, "normalized bins must pass the 0-100 range helper");

const darkBins = new Uint32Array(256);
darkBins[20] = 3;
darkBins[180] = 1;
const darkDistribution = histogram.analyzeGrayDistribution(darkBins, 4);
assertEqual(darkDistribution.peakGray, 20, "peak gray reports the highest-count bin");
assertEqual(darkDistribution.conclusion, "图片偏暗", "dark-heavy distribution uses the simple rule conclusion");
assertEqual(histogram.exposureLabel(darkDistribution), "曝光不足", "dark-heavy distribution is labeled underexposed for compare");

const brightBins = new Uint32Array(256);
brightBins[230] = 3;
brightBins[80] = 1;
const brightDistribution = histogram.analyzeGrayDistribution(brightBins, 4);
assertEqual(brightDistribution.conclusion, "图片偏亮", "bright-heavy distribution uses the simple rule conclusion");
assertEqual(histogram.exposureLabel(brightDistribution), "曝光偏高", "bright-heavy distribution is labeled overexposed for compare");

const normalBins = new Uint32Array(256);
normalBins[118] = 2;
normalBins[138] = 2;
const normalDistribution = histogram.analyzeGrayDistribution(normalBins, 4);
assertEqual(histogram.exposureLabel(normalDistribution), "曝光正常", "mid-tone distribution is labeled normal exposure");
assertEqual(
  histogram.createHistogramCompareInsight(darkDistribution, normalDistribution),
  "曝光不足 -> 曝光正常，整体变亮，平均灰度变化 68.0。",
  "compare insight summarizes exposure transition and average gray delta"
);

const drawCalls = [];
const fakeCanvas = {
  width: 0,
  height: 0,
  getContext() {
    return {
      set fillStyle(value) {
        this.currentFillStyle = value;
      },
      get fillStyle() {
        return this.currentFillStyle;
      },
      fillRect(x, y, width, height) {
        drawCalls.push({ x, y, width, height, fillStyle: this.currentFillStyle });
      }
    };
  }
};
const drawableBins = new Uint8Array(256);
drawableBins[0] = 100;
drawableBins[1] = 50;
histogram.drawHistogram(fakeCanvas, drawableBins);

assertEqual(fakeCanvas.width, 256, "drawn histogram canvas width must be 256");
assertEqual(fakeCanvas.height, 100, "drawn histogram canvas height must be 100");
assert.deepStrictEqual(
  drawCalls[0],
  { x: 0, y: 0, width: 256, height: 100, fillStyle: "#ffffff" },
  "drawHistogram clears a 256x100 white background"
);
assert.deepStrictEqual(
  drawCalls[1],
  { x: 0, y: 0, width: 1, height: 100, fillStyle: "#000000" },
  "height 100 bin fills the full first column"
);
assert.deepStrictEqual(
  drawCalls[2],
  { x: 1, y: 50, width: 1, height: 50, fillStyle: "#000000" },
  "height 50 bin is drawn from the bottom upward"
);

assert.throws(
  () => histogram.buildHistogramFromRgba(new Uint8ClampedArray([0, 0, 0])),
  /divisible by 4/,
  "invalid RGBA data must be rejected"
);

console.log("Histogram algorithm fixture passed.");
