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
