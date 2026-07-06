(function initHistogramModule(root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.HistogramApp = api;
    if (root.document) {
      root.document.addEventListener("DOMContentLoaded", function onReady() {
        api.init(root.document);
      });
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createHistogramModule() {
  "use strict";

  var HISTOGRAM_WIDTH = 256;
  var HISTOGRAM_HEIGHT = 100;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function computeGrayBin(red, green, blue) {
    var gray = red * 0.299 + green * 0.587 + blue * 0.114;
    return clamp(Math.round(gray), 0, 255);
  }

  function createEmptyBins() {
    return new Uint32Array(HISTOGRAM_WIDTH);
  }

  function buildHistogramFromRgba(data) {
    if (!data || data.length % 4 !== 0) {
      throw new Error("RGBA pixel data length must be divisible by 4.");
    }

    var bins = createEmptyBins();
    for (var index = 0; index < data.length; index += 4) {
      var grayBin = computeGrayBin(data[index], data[index + 1], data[index + 2]);
      bins[grayBin] += 1;
    }
    return bins;
  }

  function sumBins(bins) {
    var total = 0;
    for (var index = 0; index < bins.length; index += 1) {
      total += bins[index];
    }
    return total;
  }

  function maxBinCount(bins) {
    var maxCount = 0;
    for (var index = 0; index < bins.length; index += 1) {
      if (bins[index] > maxCount) {
        maxCount = bins[index];
      }
    }
    return maxCount;
  }

  function normalizeHistogram(bins) {
    if (!bins || bins.length !== HISTOGRAM_WIDTH) {
      throw new Error("Histogram bins must contain exactly 256 values.");
    }

    var maxCount = maxBinCount(bins);
    var normalized = new Uint8Array(HISTOGRAM_WIDTH);
    if (maxCount <= 0) {
      return normalized;
    }

    for (var index = 0; index < bins.length; index += 1) {
      normalized[index] = clamp(Math.round((bins[index] / maxCount) * HISTOGRAM_HEIGHT), 0, HISTOGRAM_HEIGHT);
    }
    return normalized;
  }

  function drawHistogram(canvas, normalizedBins) {
    if (!canvas || !canvas.getContext) {
      throw new Error("Histogram canvas is unavailable.");
    }
    if (!normalizedBins || normalizedBins.length !== HISTOGRAM_WIDTH) {
      throw new Error("Normalized histogram must contain exactly 256 values.");
    }

    canvas.width = HISTOGRAM_WIDTH;
    canvas.height = HISTOGRAM_HEIGHT;

    var context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
    context.fillStyle = "#000000";

    for (var x = 0; x < HISTOGRAM_WIDTH; x += 1) {
      var barHeight = normalizedBins[x];
      if (barHeight > 0) {
        context.fillRect(x, HISTOGRAM_HEIGHT - barHeight, 1, barHeight);
      }
    }
  }

  function drawImageToSourceCanvas(canvas, image) {
    if (!canvas || !canvas.getContext) {
      throw new Error("Source canvas is unavailable.");
    }

    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    if (!width || !height) {
      throw new Error("Image dimensions are unavailable.");
    }

    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }

  function generateHistogram(image, sourceCanvas, histogramCanvas, now) {
    var clock = now || (typeof performance !== "undefined" && performance.now
      ? performance.now.bind(performance)
      : Date.now);
    var start = clock();
    var imageData = drawImageToSourceCanvas(sourceCanvas, image);
    var bins = buildHistogramFromRgba(imageData.data);
    var normalized = normalizeHistogram(bins);
    drawHistogram(histogramCanvas, normalized);
    var elapsedMs = clock() - start;

    return {
      bins: bins,
      normalized: normalized,
      elapsedMs: elapsedMs,
      width: imageData.width,
      height: imageData.height,
      maxCount: maxBinCount(bins),
      pixelCount: imageData.width * imageData.height
    };
  }

  function setStatus(elements, message, kind) {
    elements.statusText.textContent = message;
    elements.statusText.classList.toggle("is-error", kind === "error");
    elements.statusText.classList.toggle("is-success", kind === "success");
  }

  function loadImageFromFile(file) {
    return new Promise(function loadImage(resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();

      image.onload = function onImageLoaded() {
        resolve({ image: image, objectUrl: objectUrl });
      };
      image.onerror = function onImageError() {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("图片读取失败，请重新选择"));
      };
      image.src = objectUrl;
    });
  }

  function formatElapsed(ms) {
    return ms.toFixed(ms >= 10 ? 1 : 2);
  }

  function init(documentRef) {
    var elements = {
      imageInput: documentRef.getElementById("imageInput"),
      previewImage: documentRef.getElementById("previewImage"),
      previewPlaceholder: documentRef.getElementById("previewPlaceholder"),
      imageMeta: documentRef.getElementById("imageMeta"),
      sourceCanvas: documentRef.getElementById("sourceCanvas"),
      histogramCanvas: documentRef.getElementById("histogramCanvas"),
      elapsedText: documentRef.getElementById("elapsedText"),
      binCountText: documentRef.getElementById("binCountText"),
      maxCountText: documentRef.getElementById("maxCountText"),
      pixelCountText: documentRef.getElementById("pixelCountText"),
      statusText: documentRef.getElementById("statusText")
    };

    if (!elements.imageInput || !elements.histogramCanvas || !elements.sourceCanvas) {
      return;
    }

    drawHistogram(elements.histogramCanvas, new Uint8Array(HISTOGRAM_WIDTH));

    var currentObjectUrl = "";
    elements.imageInput.addEventListener("change", function onImageSelected(event) {
      var file = event.target.files && event.target.files[0];

      if (!file) {
        setStatus(elements, "未选择图片", "");
        return;
      }
      if (!file.type || file.type.indexOf("image/") !== 0) {
        setStatus(elements, "请选择图片文件", "error");
        elements.imageInput.value = "";
        return;
      }

      setStatus(elements, "正在处理图片", "");
      loadImageFromFile(file)
        .then(function handleLoaded(payload) {
          if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
          }
          currentObjectUrl = payload.objectUrl;
          elements.previewImage.src = payload.objectUrl;
          elements.previewImage.classList.add("is-visible");
          elements.previewPlaceholder.hidden = true;

          var result = generateHistogram(payload.image, elements.sourceCanvas, elements.histogramCanvas);
          elements.imageMeta.textContent = result.width + " x " + result.height;
          elements.elapsedText.textContent = "耗时 " + formatElapsed(result.elapsedMs) + " ms";
          elements.binCountText.textContent = String(HISTOGRAM_WIDTH);
          elements.maxCountText.textContent = String(result.maxCount);
          elements.pixelCountText.textContent = String(result.pixelCount);
          setStatus(elements, "直方图生成完成", "success");
        })
        .catch(function handleError(error) {
          setStatus(elements, error.message || "图像处理失败，请重试", "error");
        })
        .finally(function resetInput() {
          elements.imageInput.value = "";
        });
    });
  }

  return {
    HISTOGRAM_WIDTH: HISTOGRAM_WIDTH,
    HISTOGRAM_HEIGHT: HISTOGRAM_HEIGHT,
    computeGrayBin: computeGrayBin,
    buildHistogramFromRgba: buildHistogramFromRgba,
    normalizeHistogram: normalizeHistogram,
    sumBins: sumBins,
    maxBinCount: maxBinCount,
    drawHistogram: drawHistogram,
    generateHistogram: generateHistogram,
    init: init
  };
});
