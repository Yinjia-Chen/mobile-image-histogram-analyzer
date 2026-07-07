(function initBaselineHistogramModule(root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.HistogramBaselineApp = api;
    if (root.document) {
      root.document.addEventListener("DOMContentLoaded", function onReady() {
        api.init(root.document);
      });
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createBaselineHistogramModule() {
  "use strict";

  var HISTOGRAM_WIDTH = 256;
  var HISTOGRAM_HEIGHT = 100;
  var BASELINE_REDUNDANT_PIXEL_ROUNDS = 160;
  var EXPORT_MAX_WIDTH = 1600;
  var EXPORT_MIN_WIDTH = 1024;
  var LONG_PRESS_MS = 650;
  var PERFORMANCE_THRESHOLD_MS = 300;
  var CURRENT_OPTIMIZED_REFERENCE_MS = 2.30;
  var PROCESSING_STAGES = [
    { id: "scan", label: "Scanning Pixels...", detail: "读取图像像素矩阵" },
    { id: "compute", label: "Calculating Histogram...", detail: "执行低效 baseline 灰度统计" },
    { id: "normalize", label: "Normalizing...", detail: "按最大计数归一化到 0-100" },
    { id: "render", label: "Rendering...", detail: "提交 256x100 黑白直方图" },
    { id: "done", label: "Done", detail: "Baseline 结果已写入输出矩阵" }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function computeGrayBin(red, green, blue) {
    var gray = red * 0.299 + green * 0.587 + blue * 0.114;
    return clamp(Math.round(gray), 0, 255);
  }

  function computeGrayBinSlow(pixel) {
    var grayBin = 0;
    for (var round = 0; round < BASELINE_REDUNDANT_PIXEL_ROUNDS; round += 1) {
      grayBin = Number(String(computeGrayBin(pixel.red, pixel.green, pixel.blue)));
    }
    return grayBin;
  }

  function buildHistogramFromRgbaBaseline(data) {
    if (!data || data.length % 4 !== 0) {
      throw new Error("RGBA pixel data length must be divisible by 4.");
    }

    var copiedData = Array.prototype.slice.call(data);
    var binsByKey = {};
    for (var index = 0; index < copiedData.length; index += 4) {
      var pixel = {
        red: copiedData[index],
        green: copiedData[index + 1],
        blue: copiedData[index + 2]
      };
      var grayBin = computeGrayBinSlow(pixel);
      var key = String(grayBin);
      binsByKey[key] = (binsByKey[key] || 0) + 1;
    }

    var bins = new Uint32Array(HISTOGRAM_WIDTH);
    for (var gray = 0; gray < HISTOGRAM_WIDTH; gray += 1) {
      bins[gray] = binsByKey[String(gray)] || 0;
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

  function normalizeHistogramBaseline(bins) {
    if (!bins || bins.length !== HISTOGRAM_WIDTH) {
      throw new Error("Histogram bins must contain exactly 256 values.");
    }

    var normalized = new Uint8Array(HISTOGRAM_WIDTH);
    for (var gray = 0; gray < HISTOGRAM_WIDTH; gray += 1) {
      var repeatedMax = 0;
      for (var scan = 0; scan < HISTOGRAM_WIDTH; scan += 1) {
        if (bins[scan] > repeatedMax) {
          repeatedMax = bins[scan];
        }
      }
      normalized[gray] = repeatedMax === 0
        ? 0
        : clamp(Math.round((bins[gray] / repeatedMax) * HISTOGRAM_HEIGHT), 0, HISTOGRAM_HEIGHT);
    }
    return normalized;
  }

  function cloneNormalizedBins(normalizedBins) {
    var clone = new Uint8Array(HISTOGRAM_WIDTH);
    if (!normalizedBins) {
      return clone;
    }
    for (var index = 0; index < HISTOGRAM_WIDTH; index += 1) {
      clone[index] = normalizedBins[index] || 0;
    }
    return clone;
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

  function normalizedBinsInRange(normalizedBins) {
    if (!normalizedBins || normalizedBins.length !== HISTOGRAM_WIDTH) {
      return false;
    }
    for (var index = 0; index < normalizedBins.length; index += 1) {
      if (normalizedBins[index] < 0 || normalizedBins[index] > HISTOGRAM_HEIGHT) {
        return false;
      }
    }
    return true;
  }

  function analyzeGrayDistribution(bins, pixelCount) {
    var weightedTotal = 0;
    var peakGray = 0;
    var peakCount = 0;
    var darkCount = 0;
    var midCount = 0;
    var brightCount = 0;

    for (var gray = 0; gray < HISTOGRAM_WIDTH; gray += 1) {
      var count = bins[gray] || 0;
      weightedTotal += gray * count;
      if (count > peakCount) {
        peakCount = count;
        peakGray = gray;
      }
      if (gray <= 63) {
        darkCount += count;
      } else if (gray <= 191) {
        midCount += count;
      } else {
        brightCount += count;
      }
    }

    var denominator = pixelCount || 1;
    var darkRatio = darkCount / denominator;
    var midRatio = midCount / denominator;
    var brightRatio = brightCount / denominator;
    var conclusion = "亮度分布较均衡";
    if (darkRatio > 0.5) {
      conclusion = "图片偏暗";
    } else if (brightRatio > 0.5) {
      conclusion = "图片偏亮";
    } else if (midRatio > 0.5) {
      conclusion = "灰度集中在中间调";
    }

    return {
      averageGray: pixelCount > 0 ? weightedTotal / pixelCount : 0,
      peakGray: peakGray,
      darkRatio: darkRatio,
      midRatio: midRatio,
      brightRatio: brightRatio,
      conclusion: conclusion
    };
  }

  function exposureLabel(distribution) {
    if (!distribution) {
      return "未分析";
    }
    if (distribution.averageGray < 86 || distribution.darkRatio > 0.5) {
      return "曝光不足";
    }
    if (distribution.averageGray > 170 || distribution.brightRatio > 0.5) {
      return "曝光偏高";
    }
    return "曝光正常";
  }

  function createHistogramCompareInsight(beforeDistribution, afterDistribution) {
    if (!beforeDistribution || !afterDistribution) {
      return "先生成一张图并保存为 A，再选择第二张图完成对比。";
    }

    var beforeLabel = exposureLabel(beforeDistribution);
    var afterLabel = exposureLabel(afterDistribution);
    var delta = afterDistribution.averageGray - beforeDistribution.averageGray;
    var direction = "亮度基本稳定";
    if (delta > 8) {
      direction = "整体变亮";
    } else if (delta < -8) {
      direction = "整体变暗";
    }
    return beforeLabel + " -> " + afterLabel + "，" + direction + "，平均灰度变化 " + delta.toFixed(1) + "。";
  }

  function createResultMetrics(result, histogramCanvas) {
    var binsTotal = sumBins(result.bins);
    var pixelProduct = result.width * result.height;
    var performanceMargin = ((PERFORMANCE_THRESHOLD_MS - result.elapsedMs) / PERFORMANCE_THRESHOLD_MS) * 100;
    var acceptance = {
      binsLength: result.bins.length === HISTOGRAM_WIDTH,
      binsSumMatchesPixelCount: binsTotal === result.pixelCount,
      pixelCountMatchesDimensions: result.pixelCount === pixelProduct,
      canvasSize: histogramCanvas.width === HISTOGRAM_WIDTH && histogramCanvas.height === HISTOGRAM_HEIGHT,
      normalizedRange: normalizedBinsInRange(result.normalized),
      elapsedUnderThreshold: result.elapsedMs < PERFORMANCE_THRESHOLD_MS
    };
    return {
      acceptance: acceptance,
      performance: {
        thresholdMs: PERFORMANCE_THRESHOLD_MS,
        elapsedMs: result.elapsedMs,
        performanceMargin: performanceMargin,
        status: result.elapsedMs < PERFORMANCE_THRESHOLD_MS ? "达标" : "未达标"
      },
      distribution: analyzeGrayDistribution(result.bins, result.pixelCount),
      consistency: createConsistencyComparison(result, acceptance, result.elapsedMs, CURRENT_OPTIMIZED_REFERENCE_MS)
    };
  }

  function createConsistencyComparison(result, acceptance, baselineElapsedMs, currentElapsedMs) {
    var binsTotal = sumBins(result.bins);
    var checks = {
      binsTotalConsistent: acceptance.binsLength && acceptance.binsSumMatchesPixelCount,
      pixelCountConsistent: acceptance.pixelCountMatchesDimensions,
      normalizedConsistent: acceptance.normalizedRange,
      currentFaster: currentElapsedMs < baselineElapsedMs
    };
    return {
      baselineElapsedMs: baselineElapsedMs,
      currentElapsedMs: currentElapsedMs,
      consistencyPassed: checks.binsTotalConsistent && checks.pixelCountConsistent && checks.normalizedConsistent,
      checks: checks,
      binsTotal: binsTotal,
      pixelCount: result.pixelCount
    };
  }

  function generateHistogramBaseline(image, sourceCanvas, histogramCanvas, now) {
    var clock = now || (typeof performance !== "undefined" && performance.now
      ? performance.now.bind(performance)
      : Date.now);
    var start = clock();
    var imageData = drawImageToSourceCanvas(sourceCanvas, image);
    var bins = buildHistogramFromRgbaBaseline(imageData.data);
    var normalized = normalizeHistogramBaseline(bins);
    drawHistogram(histogramCanvas, normalized);
    var elapsedMs = clock() - start;

    var result = {
      bins: bins,
      normalized: normalized,
      elapsedMs: elapsedMs,
      width: imageData.width,
      height: imageData.height,
      maxCount: maxBinCount(bins),
      pixelCount: imageData.width * imageData.height
    };
    result.metrics = createResultMetrics(result, histogramCanvas);
    return result;
  }

  function setStatus(elements, message, kind) {
    elements.statusText.textContent = message;
    elements.statusText.classList.toggle("is-error", kind === "error");
    elements.statusText.classList.toggle("is-success", kind === "success");
  }

  function showToast(elements, message) {
    if (!elements.toast) {
      return;
    }

    if (elements.toastTimer) {
      clearTimeout(elements.toastTimer);
    }
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    elements.toast.classList.add("is-visible");
    elements.toastTimer = setTimeout(function hideToast() {
      elements.toast.classList.remove("is-visible");
      elements.toastTimer = setTimeout(function removeToast() {
        elements.toast.hidden = true;
      }, 220);
    }, 1800);
  }

  function formatPercent(value) {
    return (value * 100).toFixed(1) + "%";
  }

  function formatMargin(value) {
    return value.toFixed(1) + "%";
  }

  function setCheckText(element, passed) {
    if (!element) {
      return;
    }
    element.textContent = passed ? "通过" : "未通过";
    element.classList.toggle("is-pass", passed);
    element.classList.toggle("is-fail", !passed);
  }

  function updateMetricsPanels(elements, result) {
    if (!result.metrics) {
      return;
    }

    var acceptance = result.metrics.acceptance;
    setCheckText(elements.checkBinsText, acceptance.binsLength);
    setCheckText(elements.checkSumText, acceptance.binsSumMatchesPixelCount);
    setCheckText(elements.checkPixelsText, acceptance.pixelCountMatchesDimensions);
    setCheckText(elements.checkCanvasText, acceptance.canvasSize);
    setCheckText(elements.checkNormalizedText, acceptance.normalizedRange);
    setCheckText(elements.checkElapsedText, acceptance.elapsedUnderThreshold);

    var performance = result.metrics.performance;
    elements.currentElapsedText.textContent = formatElapsed(performance.elapsedMs) + "ms";
    elements.performanceMarginText.textContent = formatMargin(performance.performanceMargin);
    elements.performanceStatusText.textContent = performance.status;
    elements.performanceStatusText.classList.toggle("is-pass", performance.status === "达标");
    elements.performanceStatusText.classList.toggle("is-fail", performance.status !== "达标");

    var distribution = result.metrics.distribution;
    elements.averageGrayText.textContent = distribution.averageGray.toFixed(1);
    elements.peakGrayText.textContent = String(distribution.peakGray);
    elements.darkRatioText.textContent = formatPercent(distribution.darkRatio);
    elements.midRatioText.textContent = formatPercent(distribution.midRatio);
    elements.brightRatioText.textContent = formatPercent(distribution.brightRatio);
    elements.distributionConclusionText.textContent = distribution.conclusion;

    var consistency = result.metrics.consistency;
    elements.comparisonBaselineElapsedText.textContent = formatElapsed(consistency.baselineElapsedMs) + "ms";
    elements.comparisonCurrentElapsedText.textContent = formatElapsed(consistency.currentElapsedMs) + "ms";
    setCheckText(elements.comparisonStatusText, consistency.consistencyPassed);
    setCheckText(elements.comparisonBinsText, consistency.checks.binsTotalConsistent);
    setCheckText(elements.comparisonPixelsText, consistency.checks.pixelCountConsistent);
    setCheckText(elements.comparisonNormalizedText, consistency.checks.normalizedConsistent);
    setCheckText(elements.comparisonFasterText, consistency.checks.currentFaster);
  }

  function drawCompareCanvas(canvas, normalizedBins) {
    if (!canvas) {
      return;
    }
    drawHistogram(canvas, normalizedBins || new Uint8Array(HISTOGRAM_WIDTH));
  }

  function createCompareSnapshot(result) {
    if (!result || !result.metrics) {
      return null;
    }
    return {
      normalized: cloneNormalizedBins(result.normalized),
      distribution: result.metrics.distribution,
      width: result.width,
      height: result.height,
      elapsedMs: result.elapsedMs
    };
  }

  function formatCompareLabel(snapshot, fallback) {
    if (!snapshot) {
      return fallback;
    }
    return snapshot.width + "x" + snapshot.height + " / " + formatElapsed(snapshot.elapsedMs) + "ms";
  }

  function updateComparePanel(elements) {
    if (!elements.compareCanvasA || !elements.compareCanvasB || !elements.compareInsightText) {
      return;
    }

    var beforeSnapshot = elements.compareSnapshotA;
    var afterSnapshot = elements.currentResult ? createCompareSnapshot(elements.currentResult) : null;
    drawCompareCanvas(elements.compareCanvasA, beforeSnapshot && beforeSnapshot.normalized);
    drawCompareCanvas(elements.compareCanvasB, afterSnapshot && afterSnapshot.normalized);

    if (elements.compareALabel) {
      elements.compareALabel.textContent = formatCompareLabel(beforeSnapshot, "未保存");
    }
    if (elements.compareBLabel) {
      elements.compareBLabel.textContent = formatCompareLabel(afterSnapshot, "等待第二张");
    }

    if (!beforeSnapshot) {
      elements.compareInsightText.textContent = "先生成一张图并保存为 A，再选择第二张图完成对比。";
      return;
    }
    if (!afterSnapshot) {
      elements.compareInsightText.textContent = "A 已保存，继续选择第二张图作为 Histogram B。";
      return;
    }
    elements.compareInsightText.textContent = createHistogramCompareInsight(beforeSnapshot.distribution, afterSnapshot.distribution);
  }

  function bindHistogramCompare(elements) {
    if (elements.saveCompareButton) {
      elements.saveCompareButton.addEventListener("click", function onSaveCompare() {
        if (!elements.currentResult) {
          showToast(elements, "请先生成一张直方图");
          return;
        }
        elements.compareSnapshotA = createCompareSnapshot(elements.currentResult);
        updateComparePanel(elements);
        showToast(elements, "已保存为 Histogram A");
      });
    }

    if (elements.clearCompareButton) {
      elements.clearCompareButton.addEventListener("click", function onClearCompare() {
        elements.compareSnapshotA = null;
        updateComparePanel(elements);
        showToast(elements, "对比已清空");
      });
    }
  }

  function copyCanvas(sourceCanvas, targetCanvas) {
    if (!sourceCanvas || !targetCanvas || !targetCanvas.getContext) {
      return;
    }

    targetCanvas.width = HISTOGRAM_WIDTH;
    targetCanvas.height = HISTOGRAM_HEIGHT;
    var context = targetCanvas.getContext("2d");
    context.clearRect(0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
    context.drawImage(sourceCanvas, 0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
  }

  function buildCompositeCanvas(documentRef, image, histogramCanvas, result, modeLabel) {
    if (!image || !histogramCanvas || !result) {
      throw new Error("请先接入图片并生成直方图");
    }

    var imageWidth = image.naturalWidth || image.width;
    var imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) {
      throw new Error("原图尺寸不可用，无法保存拼接图");
    }

    var outputWidth = clamp(Math.max(EXPORT_MIN_WIDTH, Math.min(imageWidth, EXPORT_MAX_WIDTH)), HISTOGRAM_WIDTH * 2, EXPORT_MAX_WIDTH);
    var imageOutputHeight = Math.round((imageHeight / imageWidth) * outputWidth);
    var separatorHeight = 72;
    var histogramOutputHeight = Math.round((HISTOGRAM_HEIGHT / HISTOGRAM_WIDTH) * outputWidth);
    var outputCanvas = documentRef.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = imageOutputHeight + separatorHeight + histogramOutputHeight;

    var context = outputCanvas.getContext("2d");
    context.fillStyle = "#f7f7f7";
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.drawImage(image, 0, 0, outputWidth, imageOutputHeight);

    var separatorY = imageOutputHeight;
    context.fillStyle = "#05050c";
    context.fillRect(0, separatorY, outputWidth, separatorHeight);
    context.fillStyle = "#ffc8f1";
    context.font = "600 " + Math.max(22, Math.round(outputWidth / 48)) + "px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      modeLabel + " | 原图 " + result.width + "x" + result.height + " | 直方图 256x100 | gray = 0.299R + 0.587G + 0.114B",
      outputWidth / 2,
      separatorY + separatorHeight / 2,
      outputWidth - 48
    );

    context.imageSmoothingEnabled = false;
    context.drawImage(histogramCanvas, 0, separatorY + separatorHeight, outputWidth, histogramOutputHeight);
    return outputCanvas;
  }

  function saveCompositeImage(documentRef, elements) {
    try {
      var outputCanvas = buildCompositeCanvas(
        documentRef,
        elements.currentImage,
        elements.histogramCanvas,
        elements.currentResult,
        "优化前直方图分析"
      );
      var dataUrl = outputCanvas.toDataURL("image/png");
      var filename = "histogram-baseline-" + Date.now() + ".png";
      var bridge = documentRef.defaultView && documentRef.defaultView.AndroidHistogramBridge;

      if (bridge && bridge.saveCompositeImage) {
        bridge.saveCompositeImage(dataUrl.replace(/^data:image\/png;base64,/, ""), filename);
        showToast(elements, "拼接图已保存到图片库");
        appendLog(elements, "EXPORT: baseline composite image sent to Android gallery bridge.");
        return;
      }

      var link = documentRef.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      link.rel = "noopener";
      documentRef.body.appendChild(link);
      link.click();
      documentRef.body.removeChild(link);
      showToast(elements, "拼接图已生成");
      appendLog(elements, "EXPORT: baseline composite image downloaded by browser fallback.");
    } catch (error) {
      showToast(elements, error.message || "拼接图保存失败");
      appendLog(elements, "EXPORT failed: " + (error.message || "unknown error"));
    }
  }

  function openHistogramZoom(elements) {
    if (!elements.histogramZoom || !elements.histogramZoomCanvas) {
      return;
    }
    if (!elements.currentResult) {
      showToast(elements, "请先接入图片");
      return;
    }

    copyCanvas(elements.histogramCanvas, elements.histogramZoomCanvas);
    elements.histogramZoom.hidden = false;
    elements.histogramZoom.classList.add("is-visible");
  }

  function closeHistogramZoom(elements) {
    if (!elements.histogramZoom) {
      return;
    }
    closeSaveConfirm(elements);
    elements.histogramZoom.classList.remove("is-visible");
    elements.histogramZoom.hidden = true;
  }

  function openSaveConfirm(elements) {
    if (!elements.saveConfirmDialog) {
      return false;
    }
    elements.saveConfirmDialog.hidden = false;
    if (elements.saveConfirmAccept && elements.saveConfirmAccept.focus) {
      elements.saveConfirmAccept.focus();
    }
    return true;
  }

  function closeSaveConfirm(elements) {
    if (elements.saveConfirmDialog) {
      elements.saveConfirmDialog.hidden = true;
    }
  }

  function bindHistogramZoom(documentRef, elements) {
    if (!elements.histogramZoomTrigger || !elements.histogramZoomSurface) {
      return;
    }

    var longPressTimer = 0;
    var longPressFired = false;

    function clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    }

    elements.histogramZoomTrigger.addEventListener("click", function onHistogramClick() {
      openHistogramZoom(elements);
    });

    if (elements.histogramZoomClose) {
      elements.histogramZoomClose.addEventListener("click", function onClose() {
        closeHistogramZoom(elements);
      });
    }

    elements.histogramZoomSurface.addEventListener("pointerdown", function onPressStart(event) {
      longPressFired = false;
      clearLongPress();
      longPressTimer = setTimeout(function onLongPress() {
        longPressFired = true;
        if (!openSaveConfirm(elements)) {
          saveCompositeImage(documentRef, elements);
        }
      }, LONG_PRESS_MS);
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
    });

    elements.histogramZoomSurface.addEventListener("pointerup", function onPressEnd(event) {
      clearLongPress();
      if (longPressFired) {
        event.preventDefault();
      }
    });
    elements.histogramZoomSurface.addEventListener("pointercancel", clearLongPress);
    elements.histogramZoomSurface.addEventListener("pointerleave", clearLongPress);
    elements.histogramZoomSurface.addEventListener("contextmenu", function onContextMenu(event) {
      event.preventDefault();
    });

    if (elements.saveConfirmCancel) {
      elements.saveConfirmCancel.addEventListener("click", function onSaveCancel() {
        closeSaveConfirm(elements);
      });
    }

    if (elements.saveConfirmAccept) {
      elements.saveConfirmAccept.addEventListener("click", function onSaveAccept() {
        closeSaveConfirm(elements);
        saveCompositeImage(documentRef, elements);
      });
    }

    if (elements.saveConfirmDialog) {
      elements.saveConfirmDialog.addEventListener("click", function onConfirmBackdrop(event) {
        if (event.target === elements.saveConfirmDialog) {
          closeSaveConfirm(elements);
        }
      });
    }

    documentRef.addEventListener("keydown", function onZoomKeydown(event) {
      if (event.key === "Escape") {
        if (elements.saveConfirmDialog && !elements.saveConfirmDialog.hidden) {
          closeSaveConfirm(elements);
          return;
        }
        closeHistogramZoom(elements);
      }
    });
  }

  function terminalTime() {
    var now = new Date();
    return [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  function appendLog(elements, message) {
    if (!elements.terminalLog || !elements.terminalLog.ownerDocument) {
      return;
    }

    var line = elements.terminalLog.ownerDocument.createElement("p");
    var timestamp = elements.terminalLog.ownerDocument.createElement("span");
    timestamp.textContent = terminalTime();
    line.appendChild(timestamp);
    line.appendChild(elements.terminalLog.ownerDocument.createTextNode(" " + message));
    elements.terminalLog.appendChild(line);
    elements.terminalLog.scrollTop = elements.terminalLog.scrollHeight;
  }

  function appendBootLogs(elements) {
    appendLog(elements, "ENGINE: baseline comparison pipeline online.");
    appendLog(elements, "RUNTIME: offline H5 Canvas in Android WebView / browser preview, no remote assets required.");
    appendLog(elements, "SPEC: grayscale formula round(0.299R + 0.587G + 0.114B), bins[0..255], output 256x100.");
    appendLog(elements, "TIMER: elapsed time uses the same boundary as optimized mode for fair comparison.");
  }

  function describeFile(file) {
    return "FILE: name=\"" + file.name + "\", type=" + (file.type || "unknown") + ", size=" + Math.round(file.size / 1024) + " KB.";
  }

  function appendImageDecodedLogs(elements, image) {
    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    var pixelCount = width * height;
    appendLog(elements, "DECODE: image bitmap ready, dimensions=" + width + "x" + height + ", pixels=" + pixelCount + ".");
    appendLog(elements, "CANVAS: source canvas resized to " + width + "x" + height + " before getImageData().");
  }

  function appendComputeStartLogs(elements) {
    appendLog(elements, "READ: extracting RGBA buffer with willReadFrequently=true.");
    appendLog(elements, "BASELINE: copying ImageData into Array and creating per-pixel objects.");
    appendLog(elements, "BASELINE: gray bin is recomputed " + BASELINE_REDUNDANT_PIXEL_ROUNDS + " times per pixel for contrast.");
    appendLog(elements, "NORMALIZE: max count is intentionally rescanned for every output bin.");
  }

  function appendResultLogs(elements, result) {
    appendLog(elements, "RESULT: maxBinCount=" + result.maxCount + ", pixelCount=" + result.pixelCount + ", elapsed=" + formatElapsed(result.elapsedMs) + " ms.");
    appendLog(elements, "VERIFY: sum(bins) should match pixelCount; displayed binCount=" + HISTOGRAM_WIDTH + ".");
    appendLog(elements, "RENDER: baseline histogram canvas committed as " + HISTOGRAM_WIDTH + "x" + HISTOGRAM_HEIGHT + " black-white bitmap.");
  }

  function getProcessingStage(stageId) {
    for (var index = 0; index < PROCESSING_STAGES.length; index += 1) {
      if (PROCESSING_STAGES[index].id === stageId) {
        return PROCESSING_STAGES[index];
      }
    }
    return PROCESSING_STAGES[0];
  }

  function inferProcessingStage(percent) {
    if (percent >= 100) {
      return "done";
    }
    if (percent >= 82) {
      return "render";
    }
    if (percent >= 68) {
      return "normalize";
    }
    if (percent >= 40) {
      return "compute";
    }
    return "scan";
  }

  function updateProcessingSteps(nodes, stageId, attributeName) {
    if (!nodes) {
      return;
    }

    var activeIndex = 0;
    for (var index = 0; index < PROCESSING_STAGES.length; index += 1) {
      if (PROCESSING_STAGES[index].id === stageId) {
        activeIndex = index;
        break;
      }
    }

    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      var node = nodes[nodeIndex];
      var nodeStage = node.getAttribute(attributeName);
      var stepIndex = 0;
      for (var stageIndex = 0; stageIndex < PROCESSING_STAGES.length; stageIndex += 1) {
        if (PROCESSING_STAGES[stageIndex].id === nodeStage) {
          stepIndex = stageIndex;
          break;
        }
      }
      node.classList.toggle("is-active", nodeStage === stageId);
      node.classList.toggle("is-complete", stepIndex < activeIndex || stageId === "done");
    }
  }

  function clearProcessingTimers(elements) {
    if (!elements.processingTimers) {
      return;
    }
    for (var index = 0; index < elements.processingTimers.length; index += 1) {
      clearTimeout(elements.processingTimers[index]);
    }
    elements.processingTimers = [];
  }

  function runProcessingSequence(elements, steps) {
    clearProcessingTimers(elements);
    return new Promise(function sequence(resolve) {
      var elapsed = 0;
      for (var index = 0; index < steps.length; index += 1) {
        elapsed += steps[index].delay;
        (function scheduleStep(step, wait) {
          elements.processingTimers.push(setTimeout(function updateStep() {
            setProcessing(elements, true, step.message, step.percent, step.stage);
          }, wait));
        })(steps[index], elapsed);
      }
      elements.processingTimers.push(setTimeout(resolve, elapsed));
    });
  }

  function setProcessing(elements, active, message, percent, stageId) {
    if (!elements.processingPanel || !elements.progressBar || !elements.processingLabel) {
      return;
    }

    var nextPercent = clamp(percent || 0, 0, 100);
    var nextStageId = stageId || inferProcessingStage(nextPercent);
    var stage = getProcessingStage(nextStageId);
    elements.processingPanel.hidden = !active;
    elements.processingLabel.textContent = message || stage.label;
    if (elements.processingDetail) {
      elements.processingDetail.textContent = stage.detail;
    }
    elements.progressBar.style.width = nextPercent + "%";
    updateProcessingSteps(elements.processingSteps, active ? nextStageId : "scan", "data-processing-step");

    if (!active) {
      clearProcessingTimers(elements);
      elements.progressBar.style.width = "0%";
    }

    if (!elements.processingOverlay || !elements.processingOverlayBar || !elements.processingOverlayLabel || !elements.processingOverlayPercent) {
      return;
    }

    if (elements.processingOverlayTimer) {
      clearTimeout(elements.processingOverlayTimer);
      elements.processingOverlayTimer = 0;
    }

    elements.processingOverlayLabel.textContent = message || stage.label;
    if (elements.processingOverlayDetail) {
      elements.processingOverlayDetail.textContent = stage.detail;
    }
    elements.processingOverlayPercent.textContent = Math.round(nextPercent) + "%";
    elements.processingOverlayBar.style.width = nextPercent + "%";
    updateProcessingSteps(elements.processingOverlaySteps, active ? nextStageId : "scan", "data-processing-overlay-step");

    if (active) {
      elements.processingOverlay.hidden = false;
      elements.processingOverlay.classList.remove("is-leaving");
      elements.processingOverlay.classList.add("is-visible");
      return;
    }

    elements.processingOverlay.classList.remove("is-visible");
    elements.processingOverlay.classList.add("is-leaving");
    elements.processingOverlayTimer = setTimeout(function hideProcessingOverlay() {
      elements.processingOverlay.hidden = true;
      elements.processingOverlay.classList.remove("is-leaving");
      elements.processingOverlayBar.style.width = "0%";
      elements.processingOverlayPercent.textContent = "0%";
      if (elements.processingOverlayDetail) {
        elements.processingOverlayDetail.textContent = PROCESSING_STAGES[0].detail;
      }
    }, 260);
  }

  function bindInputModality(documentRef) {
    if (!documentRef.addEventListener || !documentRef.body) {
      return;
    }

    function usePointerInput() {
      documentRef.body.classList.add("is-pointer-input");
    }

    function useKeyboardInput(event) {
      if (event.key === "Tab") {
        documentRef.body.classList.remove("is-pointer-input");
      }
    }

    documentRef.addEventListener("pointerdown", usePointerInput, true);
    documentRef.addEventListener("touchstart", usePointerInput, true);
    documentRef.addEventListener("mousedown", usePointerInput, true);
    documentRef.addEventListener("keydown", useKeyboardInput, true);
  }

  function showScreen(elements, screenId) {
    if (!elements.screens || !elements.screenTabs) {
      return;
    }

    for (var index = 0; index < elements.screens.length; index += 1) {
      var screen = elements.screens[index];
      screen.classList.toggle("is-active", screen.id === screenId);
    }

    for (var tabIndex = 0; tabIndex < elements.screenTabs.length; tabIndex += 1) {
      var tab = elements.screenTabs[tabIndex];
      tab.classList.toggle("is-active", tab.getAttribute("data-screen-target") === screenId);
    }
  }

  function bindNavigation(documentRef, elements) {
    if (!documentRef.querySelectorAll) {
      return;
    }

    elements.screens = documentRef.querySelectorAll("[data-screen]");
    elements.screenTabs = documentRef.querySelectorAll(".screen-tabs [data-screen-target]");
    var triggers = documentRef.querySelectorAll("[data-screen-target]");

    for (var index = 0; index < triggers.length; index += 1) {
      triggers[index].addEventListener("click", function onNavigate(event) {
        showScreen(elements, event.currentTarget.getAttribute("data-screen-target"));
      });
    }
  }

  function runSplash(elements) {
    if (!elements.splashScreen) {
      return;
    }

    setTimeout(function leaveSplash() {
      elements.splashScreen.classList.add("is-leaving");
      setTimeout(function hideSplash() {
        elements.splashScreen.hidden = true;
      }, 280);
    }, 1500);
  }

  function afterPaint(callback) {
    return new Promise(function waitForPaint(resolve) {
      var scheduler = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : function fallback(next) {
          setTimeout(next, 16);
        };
      scheduler(function runCallback() {
        resolve(callback());
      });
    });
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
      processingPanel: documentRef.getElementById("processingPanel"),
      processingLabel: documentRef.getElementById("processingLabel"),
      processingDetail: documentRef.getElementById("processingDetail"),
      processingSteps: documentRef.querySelectorAll("[data-processing-step]"),
      progressBar: documentRef.getElementById("progressBar"),
      processingOverlay: documentRef.getElementById("processingOverlay"),
      processingOverlayLabel: documentRef.getElementById("processingOverlayLabel"),
      processingOverlayDetail: documentRef.getElementById("processingOverlayDetail"),
      processingOverlayPercent: documentRef.getElementById("processingOverlayPercent"),
      processingOverlayBar: documentRef.getElementById("processingOverlayBar"),
      processingOverlaySteps: documentRef.querySelectorAll("[data-processing-overlay-step]"),
      processingOverlayTimer: 0,
      processingTimers: [],
      elapsedText: documentRef.getElementById("elapsedText"),
      binCountText: documentRef.getElementById("binCountText"),
      maxCountText: documentRef.getElementById("maxCountText"),
      pixelCountText: documentRef.getElementById("pixelCountText"),
      checkBinsText: documentRef.getElementById("checkBinsText"),
      checkSumText: documentRef.getElementById("checkSumText"),
      checkPixelsText: documentRef.getElementById("checkPixelsText"),
      checkCanvasText: documentRef.getElementById("checkCanvasText"),
      checkNormalizedText: documentRef.getElementById("checkNormalizedText"),
      checkElapsedText: documentRef.getElementById("checkElapsedText"),
      currentElapsedText: documentRef.getElementById("currentElapsedText"),
      performanceMarginText: documentRef.getElementById("performanceMarginText"),
      performanceStatusText: documentRef.getElementById("performanceStatusText"),
      averageGrayText: documentRef.getElementById("averageGrayText"),
      peakGrayText: documentRef.getElementById("peakGrayText"),
      darkRatioText: documentRef.getElementById("darkRatioText"),
      midRatioText: documentRef.getElementById("midRatioText"),
      brightRatioText: documentRef.getElementById("brightRatioText"),
      distributionConclusionText: documentRef.getElementById("distributionConclusionText"),
      comparisonBaselineElapsedText: documentRef.getElementById("comparisonBaselineElapsedText"),
      comparisonCurrentElapsedText: documentRef.getElementById("comparisonCurrentElapsedText"),
      comparisonStatusText: documentRef.getElementById("comparisonStatusText"),
      comparisonBinsText: documentRef.getElementById("comparisonBinsText"),
      comparisonPixelsText: documentRef.getElementById("comparisonPixelsText"),
      comparisonNormalizedText: documentRef.getElementById("comparisonNormalizedText"),
      comparisonFasterText: documentRef.getElementById("comparisonFasterText"),
      statusText: documentRef.getElementById("statusText"),
      terminalLog: documentRef.getElementById("terminalLog"),
      splashScreen: documentRef.getElementById("splashScreen"),
      toast: documentRef.getElementById("toast"),
      toastTimer: 0,
      histogramZoomTrigger: documentRef.querySelector(".histogram-zoom-trigger"),
      histogramZoom: documentRef.getElementById("histogramZoom"),
      histogramZoomClose: documentRef.getElementById("histogramZoomClose"),
      histogramZoomSurface: documentRef.getElementById("histogramZoomSurface"),
      histogramZoomCanvas: documentRef.getElementById("histogramZoomCanvas"),
      saveCompareButton: documentRef.getElementById("saveCompareButton"),
      clearCompareButton: documentRef.getElementById("clearCompareButton"),
      compareCanvasA: documentRef.getElementById("compareCanvasA"),
      compareCanvasB: documentRef.getElementById("compareCanvasB"),
      compareALabel: documentRef.getElementById("compareALabel"),
      compareBLabel: documentRef.getElementById("compareBLabel"),
      compareInsightText: documentRef.getElementById("compareInsightText"),
      saveConfirmDialog: documentRef.getElementById("saveConfirmDialog"),
      saveConfirmCancel: documentRef.getElementById("saveConfirmCancel"),
      saveConfirmAccept: documentRef.getElementById("saveConfirmAccept"),
      compareSnapshotA: null,
      currentImage: null,
      currentResult: null
    };

    if (!elements.imageInput || !elements.histogramCanvas || !elements.sourceCanvas) {
      return;
    }

    bindInputModality(documentRef);
    bindNavigation(documentRef, elements);
    bindHistogramZoom(documentRef, elements);
    bindHistogramCompare(elements);
    runSplash(elements);
    drawHistogram(elements.histogramCanvas, new Uint8Array(HISTOGRAM_WIDTH));
    updateComparePanel(elements);
    appendBootLogs(elements);

    var currentObjectUrl = "";
    elements.imageInput.addEventListener("change", function onImageSelected(event) {
      var file = event.target.files && event.target.files[0];

      if (!file) {
        setStatus(elements, "未选择图片", "");
        appendLog(elements, "未选择图像，Baseline 流程保持待命。");
        return;
      }
      if (!file.type || file.type.indexOf("image/") !== 0) {
        setStatus(elements, "请选择图片文件", "error");
        appendLog(elements, "拒绝输入：文件类型不是 image/*。");
        elements.imageInput.value = "";
        return;
      }

      appendLog(elements, describeFile(file));
      appendLog(elements, "QUEUE: accepted local image file, baseline decode requested.");
      setStatus(elements, "Baseline 对照版正在处理图片", "");
      clearProcessingTimers(elements);
      setProcessing(elements, true, "Scanning Pixels...", 16, "scan");
      loadImageFromFile(file)
        .then(function handleLoaded(payload) {
          if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
          }
          currentObjectUrl = payload.objectUrl;
          elements.currentImage = payload.image;
          elements.previewImage.src = payload.objectUrl;
          elements.previewImage.classList.add("is-visible");
          elements.previewPlaceholder.hidden = true;
          showScreen(elements, "screen-result");

          appendImageDecodedLogs(elements, payload.image);
          setStatus(elements, "Baseline 对照版正在执行低效统计", "");
          return runProcessingSequence(elements, [
            { delay: 120, stage: "scan", message: "Scanning Pixels...", percent: 28 },
            { delay: 260, stage: "compute", message: "Calculating Histogram...", percent: 56 }
          ]).then(function runHistogramAfterIntro() {
            return afterPaint(function runHistogram() {
              appendComputeStartLogs(elements);
              var result = generateHistogramBaseline(payload.image, elements.sourceCanvas, elements.histogramCanvas);
              return {
                result: result
              };
            });
          });
        })
        .then(function handleResult(payload) {
          var result = payload.result;
          elements.currentResult = result;
          elements.imageMeta.textContent = result.width + " x " + result.height;
          elements.elapsedText.textContent = "Baseline 耗时 " + formatElapsed(result.elapsedMs) + " ms";
          elements.binCountText.textContent = String(HISTOGRAM_WIDTH);
          elements.maxCountText.textContent = String(result.maxCount);
          elements.pixelCountText.textContent = String(result.pixelCount);
          updateMetricsPanels(elements, result);
          updateComparePanel(elements);
          return runProcessingSequence(elements, [
            { delay: 180, stage: "normalize", message: "Normalizing...", percent: 74 },
            { delay: 220, stage: "render", message: "Rendering...", percent: 92 },
            { delay: 180, stage: "done", message: "Done", percent: 100 }
          ]).then(function finishProcessing() {
            setStatus(elements, "Baseline 结果已更新，可继续选择图片", "success");
            appendResultLogs(elements, result);
            showToast(elements, "Baseline 直方图生成完成");
            elements.processingTimers.push(setTimeout(function hideProcessing() {
              setProcessing(elements, false, "", 0);
            }, 520));
          });
        })
        .catch(function handleError(error) {
          setProcessing(elements, false, "", 0);
          appendLog(elements, "处理失败：" + (error.message || "未知错误"));
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
    BASELINE_REDUNDANT_PIXEL_ROUNDS: BASELINE_REDUNDANT_PIXEL_ROUNDS,
    computeGrayBin: computeGrayBin,
    buildHistogramFromRgbaBaseline: buildHistogramFromRgbaBaseline,
    normalizeHistogramBaseline: normalizeHistogramBaseline,
    sumBins: sumBins,
    maxBinCount: maxBinCount,
    normalizedBinsInRange: normalizedBinsInRange,
    analyzeGrayDistribution: analyzeGrayDistribution,
    exposureLabel: exposureLabel,
    createHistogramCompareInsight: createHistogramCompareInsight,
    createConsistencyComparison: createConsistencyComparison,
    createResultMetrics: createResultMetrics,
    drawHistogram: drawHistogram,
    generateHistogramBaseline: generateHistogramBaseline,
    init: init
  };
});
