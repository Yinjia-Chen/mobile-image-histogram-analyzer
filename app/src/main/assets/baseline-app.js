/* baseline 模块入口：用于性能对照 APK，同时兼容 WebView 和 Node.js 测试。 */
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

  /* baseline 配置：保持同样的 256x100 输出，但加入冗余轮次制造低效对照。 */
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

  /* 范围限制工具：保证灰度 bin、柱高和导出尺寸都不会越界。 */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* 灰度公式模块：baseline 也必须使用课程指定公式，保证结果可对比。 */
  function computeGrayBin(red, green, blue) {
    var gray = red * 0.299 + green * 0.587 + blue * 0.114;
    return clamp(Math.round(gray), 0, 255);
  }

  /* 低效灰度模块：重复字符串转换和计算，用来放大 baseline 性能差异。 */
  function computeGrayBinSlow(pixel) {
    var grayBin = 0;
    for (var round = 0; round < BASELINE_REDUNDANT_PIXEL_ROUNDS; round += 1) {
      grayBin = Number(String(computeGrayBin(pixel.red, pixel.green, pixel.blue)));
    }
    return grayBin;
  }

  /* baseline 统计模块：使用普通数组、对象映射和冗余计算形成压力对照。 */
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

  /* bins 求和模块：用于校验 baseline 也统计了全部像素。 */
  function sumBins(bins) {
    var total = 0;
    for (var index = 0; index < bins.length; index += 1) {
      total += bins[index];
    }
    return total;
  }

  /* 最大计数模块：用于结果指标和归一化参照。 */
  function maxBinCount(bins) {
    var maxCount = 0;
    for (var index = 0; index < bins.length; index += 1) {
      if (bins[index] > maxCount) {
        maxCount = bins[index];
      }
    }
    return maxCount;
  }

  /* baseline 归一化模块：故意重复扫描最大值，保持结果正确但降低效率。 */
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

  /* 对比快照模块：复制归一化高度，避免后续图片覆盖已保存的 A。 */
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

  /* 直方图绘制模块：baseline 也输出严格的 256x100 黑白 canvas。 */
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

  /* 像素读取模块：把本地图片画到隐藏 canvas 并读取 RGBA 数据。 */
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

  /* 范围验收模块：检查归一化高度是否都在 0..100。 */
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

  /* 灰度分布模块：复用 bins 计算平均灰度、峰值和暗/中/亮比例。 */
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

  /* 曝光标签模块：把分布数据转成简短可讲的结论。 */
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

  /* A/B 对比说明模块：生成 Histogram Compare 的文字结论。 */
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

  /* 结果指标模块：汇总 baseline 的验收、性能、分布和对照信息。 */
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

  /* 一致性对照模块：baseline 使用当前优化版参考耗时做反向比较。 */
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

  /* baseline 主算法模块：计时覆盖完整处理链路，并保留低效实现特征。 */
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

  /* 状态文本模块：只负责提示文案和成功/失败样式。 */
  function setStatus(elements, message, kind) {
    elements.statusText.textContent = message;
    elements.statusText.classList.toggle("is-error", kind === "error");
    elements.statusText.classList.toggle("is-success", kind === "success");
  }

  /* 轻提示模块：管理 toast 显示、退出动画和隐藏定时器。 */
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

  /* 百分比格式化模块：把比例转成一位小数百分比。 */
  function formatPercent(value) {
    return (value * 100).toFixed(1) + "%";
  }

  /* 性能余量格式化模块：显示与 300ms 目标的距离。 */
  function formatMargin(value) {
    return value.toFixed(1) + "%";
  }

  /* 检查徽标模块：根据真实验收结果显示通过状态。 */
  function setCheckText(element, passed) {
    if (!element) {
      return;
    }
    element.textContent = passed ? "通过" : "未通过";
    element.classList.toggle("is-pass", passed);
    element.classList.toggle("is-fail", !passed);
  }

  /* 指标面板模块：把 baseline 结果写入页面各项证据区域。 */
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

  /* 对比绘制模块：使用同一绘制函数生成 A/B 小直方图。 */
  function drawCompareCanvas(canvas, normalizedBins) {
    if (!canvas) {
      return;
    }
    drawHistogram(canvas, normalizedBins || new Uint8Array(HISTOGRAM_WIDTH));
  }

  /* 对比快照创建模块：保存当前 baseline 结果用于后续 A/B 对比。 */
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

  /* 对比标签模块：显示快照尺寸和耗时。 */
  function formatCompareLabel(snapshot, fallback) {
    if (!snapshot) {
      return fallback;
    }
    return snapshot.width + "x" + snapshot.height + " / " + formatElapsed(snapshot.elapsedMs) + "ms";
  }

  /* 对比面板模块：维护 A/B canvas、标签和灰度变化说明。 */
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

  /* 对比按钮绑定模块：处理保存 A 和清空对比两种操作。 */
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

  /* canvas 复制模块：把结果图复制到放大层。 */
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

  /* 拼接导出模块：生成原图、说明条和直方图合成 PNG。 */
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

  /* 图片保存模块：APK 走 Android 桥，浏览器预览走下载 fallback。 */
  function saveCompositeImage(documentRef, elements) {
    try {
      var outputCanvas = buildCompositeCanvas(
        documentRef,
        elements.currentImage,
        elements.histogramCanvas,
        elements.currentResult,
        "低效对照直方图分析"
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

  /* 直方图放大模块：打开横向查看层，便于看清 256x100 输出。 */
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

  /* 放大层关闭模块：关闭时同时收起保存确认框。 */
  function closeHistogramZoom(elements) {
    if (!elements.histogramZoom) {
      return;
    }
    closeSaveConfirm(elements);
    elements.histogramZoom.classList.remove("is-visible");
    elements.histogramZoom.hidden = true;
  }

  /* 保存确认模块：长按后要求用户明确确认导出。 */
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

  /* 确认框关闭模块：取消保存时只关闭弹窗，不生成图片。 */
  function closeSaveConfirm(elements) {
    if (elements.saveConfirmDialog) {
      elements.saveConfirmDialog.hidden = true;
    }
  }

  /* 放大交互绑定模块：统一处理点击、长按、遮罩和键盘关闭。 */
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

  /* 日志时间模块：生成终端日志里的时间戳。 */
  function terminalTime() {
    var now = new Date();
    return [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  /* 终端日志模块：把 baseline 处理过程写到日志页面。 */
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

  /* 启动日志模块：说明当前是低效对照引擎和离线运行环境。 */
  function appendBootLogs(elements) {
    appendLog(elements, "ENGINE: baseline comparison pipeline online.");
    appendLog(elements, "RUNTIME: offline H5 Canvas in Android WebView / browser preview, no remote assets required.");
    appendLog(elements, "SPEC: grayscale formula round(0.299R + 0.587G + 0.114B), bins[0..255], output 256x100.");
    appendLog(elements, "TIMER: elapsed time uses the same boundary as optimized mode for fair comparison.");
  }

  /* 文件描述模块：记录用户选择的本地图片信息。 */
  function describeFile(file) {
    return "FILE: name=\"" + file.name + "\", type=" + (file.type || "unknown") + ", size=" + Math.round(file.size / 1024) + " KB.";
  }

  /* 解码日志模块：记录图片实际尺寸和像素数量。 */
  function appendImageDecodedLogs(elements, image) {
    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    var pixelCount = width * height;
    appendLog(elements, "DECODE: image bitmap ready, dimensions=" + width + "x" + height + ", pixels=" + pixelCount + ".");
    appendLog(elements, "CANVAS: source canvas resized to " + width + "x" + height + " before getImageData().");
  }

  /* 计算开始日志模块：记录 baseline 故意使用的低效统计策略。 */
  function appendComputeStartLogs(elements) {
    appendLog(elements, "READ: extracting RGBA buffer with willReadFrequently=true.");
    appendLog(elements, "BASELINE: copying ImageData into Array and creating per-pixel objects.");
    appendLog(elements, "BASELINE: gray bin is recomputed " + BASELINE_REDUNDANT_PIXEL_ROUNDS + " times per pixel for contrast.");
    appendLog(elements, "NORMALIZE: max count is intentionally rescanned for every output bin.");
  }

  /* 结果日志模块：记录 baseline 最大桶、像素数、耗时和输出尺寸。 */
  function appendResultLogs(elements, result) {
    appendLog(elements, "RESULT: maxBinCount=" + result.maxCount + ", pixelCount=" + result.pixelCount + ", elapsed=" + formatElapsed(result.elapsedMs) + " ms.");
    appendLog(elements, "VERIFY: sum(bins) should match pixelCount; displayed binCount=" + HISTOGRAM_WIDTH + ".");
    appendLog(elements, "RENDER: baseline histogram canvas committed as " + HISTOGRAM_WIDTH + "x" + HISTOGRAM_HEIGHT + " black-white bitmap.");
  }

  /* 阶段查找模块：根据 stage id 取得 loading 文案。 */
  function getProcessingStage(stageId) {
    for (var index = 0; index < PROCESSING_STAGES.length; index += 1) {
      if (PROCESSING_STAGES[index].id === stageId) {
        return PROCESSING_STAGES[index];
      }
    }
    return PROCESSING_STAGES[0];
  }

  /* 阶段推断模块：把进度百分比映射到扫描、统计、归一化等阶段。 */
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

  /* 步骤状态模块：同步阶段列表的激活和完成样式。 */
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

  /* 定时器清理模块：防止上一次处理的 loading 定时器串到下一次。 */
  function clearProcessingTimers(elements) {
    if (!elements.processingTimers) {
      return;
    }
    for (var index = 0; index < elements.processingTimers.length; index += 1) {
      clearTimeout(elements.processingTimers[index]);
    }
    elements.processingTimers = [];
  }

  /* 进度演出模块：按脚本化步骤更新 baseline 处理进度。 */
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

  /* loading 状态模块：统一控制进度条、覆盖层和阶段说明。 */
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

  /* 输入方式模块：触摸输入隐藏焦点框，键盘输入保留焦点可见性。 */
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

  /* 页面切换模块：在接入、链路、输出、指标、协议和日志间切换。 */
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

  /* 导航绑定模块：把所有 data-screen-target 接入页面切换。 */
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

  /* 开屏模块：处理 baseline 启动动画离场。 */
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

  /* 渲染让步模块：让 loading 先绘制，再执行较重 baseline 计算。 */
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

  /* 本地图像解码模块：用 object URL 解码本地文件，不依赖网络。 */
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

  /* 耗时格式化模块：根据耗时长短选择小数位。 */
  function formatElapsed(ms) {
    return ms.toFixed(ms >= 10 ? 1 : 2);
  }

  /* 初始化模块：收集 DOM、绑定交互、绘制空图并接入选图主流程。 */
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

  /* 测试导出模块：把 baseline 纯函数暴露给脚本验证。 */
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
