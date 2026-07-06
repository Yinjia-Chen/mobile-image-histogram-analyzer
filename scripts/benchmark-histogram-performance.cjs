const { performance } = require("perf_hooks");

const HISTOGRAM_WIDTH = 256;
const HISTOGRAM_HEIGHT = 100;
const BASELINE_REDUNDANT_PIXEL_ROUNDS = 160;

const cases = [
  { width: 320, height: 180, label: "small-demo" },
  { width: 800, height: 600, label: "phone-mid" },
  { width: 1280, height: 720, label: "phone-large" }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeGrayBin(red, green, blue) {
  return clamp(Math.round(red * 0.299 + green * 0.587 + blue * 0.114), 0, 255);
}

function createSyntheticRgba(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 13 + y * 3) & 255;
      data[offset + 1] = (x * 5 + y * 11) & 255;
      data[offset + 2] = (x * 7 + y * 17) & 255;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function createPixelSource(width, height) {
  const rgba = createSyntheticRgba(width, height);
  return {
    width,
    height,
    readRgba() {
      return rgba.slice();
    }
  };
}

function maxBinCount(bins) {
  let maxCount = 0;
  for (let index = 0; index < bins.length; index += 1) {
    if (bins[index] > maxCount) {
      maxCount = bins[index];
    }
  }
  return maxCount;
}

function normalizeBins(bins) {
  const maxCount = maxBinCount(bins);
  const normalized = new Uint8Array(HISTOGRAM_WIDTH);
  if (maxCount === 0) {
    return normalized;
  }

  for (let index = 0; index < HISTOGRAM_WIDTH; index += 1) {
    normalized[index] = clamp(Math.round((bins[index] / maxCount) * HISTOGRAM_HEIGHT), 0, HISTOGRAM_HEIGHT);
  }
  return normalized;
}

function renderHistogramBuffer(normalized) {
  const output = new Uint8Array(HISTOGRAM_WIDTH * HISTOGRAM_HEIGHT);
  output.fill(255);
  for (let x = 0; x < HISTOGRAM_WIDTH; x += 1) {
    const barHeight = normalized[x];
    for (let y = HISTOGRAM_HEIGHT - barHeight; y < HISTOGRAM_HEIGHT; y += 1) {
      output[y * HISTOGRAM_WIDTH + x] = 0;
    }
  }
  return output;
}

function currentOptimizedPipeline(source) {
  const data = source.readRgba();
  const bins = new Uint32Array(HISTOGRAM_WIDTH);

  for (let index = 0; index < data.length; index += 4) {
    bins[computeGrayBin(data[index], data[index + 1], data[index + 2])] += 1;
  }

  const normalized = normalizeBins(bins);
  const rendered = renderHistogramBuffer(normalized);
  return {
    bins,
    normalized,
    rendered,
    pixelCount: source.width * source.height
  };
}

function slowGrayForComparison(pixel) {
  const weighted = pixel.red * 0.299 + pixel.green * 0.587 + pixel.blue * 0.114;
  return clamp(Math.round(weighted), 0, 255);
}

function comparisonBaselinePipeline(source) {
  const data = Array.from(source.readRgba());
  const binsByKey = {};

  for (let index = 0; index < data.length; index += 4) {
    const pixel = {
      red: data[index],
      green: data[index + 1],
      blue: data[index + 2]
    };
    let gray = 0;
    for (let round = 0; round < BASELINE_REDUNDANT_PIXEL_ROUNDS; round += 1) {
      gray = Number(String(slowGrayForComparison(pixel)));
    }
    const key = String(gray);
    binsByKey[key] = (binsByKey[key] || 0) + 1;
  }

  const bins = new Uint32Array(HISTOGRAM_WIDTH);
  for (let gray = 0; gray < HISTOGRAM_WIDTH; gray += 1) {
    bins[gray] = binsByKey[String(gray)] || 0;
  }

  const normalized = new Uint8Array(HISTOGRAM_WIDTH);
  for (let gray = 0; gray < HISTOGRAM_WIDTH; gray += 1) {
    let repeatedMax = 0;
    for (let scan = 0; scan < HISTOGRAM_WIDTH; scan += 1) {
      if (bins[scan] > repeatedMax) {
        repeatedMax = bins[scan];
      }
    }
    normalized[gray] = repeatedMax === 0
      ? 0
      : clamp(Math.round((bins[gray] / repeatedMax) * HISTOGRAM_HEIGHT), 0, HISTOGRAM_HEIGHT);
  }

  const rendered = new Uint8Array(HISTOGRAM_WIDTH * HISTOGRAM_HEIGHT);
  for (let y = 0; y < HISTOGRAM_HEIGHT; y += 1) {
    for (let x = 0; x < HISTOGRAM_WIDTH; x += 1) {
      rendered[y * HISTOGRAM_WIDTH + x] = 255;
    }
  }
  for (let x = 0; x < HISTOGRAM_WIDTH; x += 1) {
    for (let y = 0; y < HISTOGRAM_HEIGHT; y += 1) {
      if (y >= HISTOGRAM_HEIGHT - normalized[x]) {
        rendered[y * HISTOGRAM_WIDTH + x] = 0;
      }
    }
  }

  return {
    bins,
    normalized,
    rendered,
    pixelCount: source.width * source.height
  };
}

function assertSameResult(baseline, optimized) {
  if (baseline.pixelCount !== optimized.pixelCount) {
    throw new Error("Pixel count mismatch.");
  }
  for (let index = 0; index < HISTOGRAM_WIDTH; index += 1) {
    if (baseline.bins[index] !== optimized.bins[index]) {
      throw new Error(`Bin ${index} mismatch: ${baseline.bins[index]} !== ${optimized.bins[index]}`);
    }
    if (baseline.normalized[index] !== optimized.normalized[index]) {
      throw new Error(`Normalized bin ${index} mismatch.`);
    }
  }
  for (let index = 0; index < baseline.rendered.length; index += 1) {
    if (baseline.rendered[index] !== optimized.rendered[index]) {
      throw new Error(`Rendered histogram pixel ${index} mismatch.`);
    }
  }
}

function measure(name, source, pipeline) {
  const start = performance.now();
  const result = pipeline(source);
  const elapsedMs = performance.now() - start;
  return {
    name,
    elapsedMs,
    result
  };
}

function formatMs(value) {
  return value.toFixed(value >= 100 ? 1 : 2);
}

function run() {
  const rows = [];
  for (const testCase of cases) {
    const source = createPixelSource(testCase.width, testCase.height);
    const baseline = measure("comparison-baseline", source, comparisonBaselinePipeline);
    const optimized = measure("current-optimized", source, currentOptimizedPipeline);
    assertSameResult(baseline.result, optimized.result);

    rows.push({
      caseName: testCase.label,
      imageSize: `${testCase.width}x${testCase.height}`,
      pixels: testCase.width * testCase.height,
      baselineMs: baseline.elapsedMs,
      optimizedMs: optimized.elapsedMs,
      speedup: baseline.elapsedMs / optimized.elapsedMs,
      meetsTarget: optimized.elapsedMs < 300
    });
  }

  console.log("# Histogram Performance Comparison");
  console.log("");
  console.log("Timing boundary: RGBA pixel read copy -> grayscale calculation -> 256-bin counting -> 0-100 normalization -> 256x100 rendering buffer.");
  console.log(`The comparison-baseline mode is an intentionally inefficient control implementation, not a historical production version. It repeats per-pixel gray calculation ${BASELINE_REDUNDANT_PIXEL_ROUNDS} times as an anti-pattern stress control.`);
  console.log("");
  console.log("| Case | Image size | Pixels | Comparison baseline | Current optimized | Speedup | <300ms |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    console.log([
      `| ${row.caseName}`,
      row.imageSize,
      String(row.pixels),
      `${formatMs(row.baselineMs)} ms`,
      `${formatMs(row.optimizedMs)} ms`,
      `${row.speedup.toFixed(1)}x`,
      row.meetsTarget ? "yes" : "no"
    ].join(" | ") + " |");
  }
}

run();
