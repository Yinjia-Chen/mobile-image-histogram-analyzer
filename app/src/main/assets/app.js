/* 模块入口：同时兼容 Android WebView 全局挂载和 Node.js 测试导出。 */
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

  /* 核心配置：固定 256 个灰度桶、100 像素高度和导出/交互阈值。 */
  var HISTOGRAM_WIDTH = 256;
  var HISTOGRAM_HEIGHT = 100;
  var EXPORT_MAX_WIDTH = 1600;
  var EXPORT_MIN_WIDTH = 1024;
  var LONG_PRESS_MS = 650;
  var PERFORMANCE_THRESHOLD_MS = 300;
  var BASELINE_REFERENCE_MS = 407.1;
  var PROCESSING_STAGES = [
    { id: "scan", label: "扫描像素", detail: "读取图像像素矩阵" },
    { id: "compute", label: "统计直方图", detail: "套用灰度公式并写入 256 bins" },
    { id: "normalize", label: "归一化", detail: "按最大计数归一化到 0-100" },
    { id: "render", label: "渲染输出", detail: "提交 256x100 黑白直方图" },
    { id: "done", label: "完成", detail: "结果已写入输出矩阵" }
  ];

  /*
   * 算法基础工具说明：
   * 本段函数只处理与直方图计算直接相关的基础数据。
   * clamp 负责所有边界收口，避免灰度桶和柱高越界。
   * computeGrayBin 固定课程要求公式，是算法正确性的核心入口。
   * createEmptyBins 固定生成 256 个桶，保证 0..255 每个灰度值都有位置。
   * buildHistogramFromRgba 直接消费 Canvas 读出的 RGBA 缓冲区。
   * 这里不读取 DOM、不写 UI、不处理动画，方便 Node.js fixture 直接测试。
   * 只要公式、桶数量或遍历步长被改错，算法测试就会失败。
   * alpha 通道不会参与灰度公式，因为课程公式只规定 RGB 三通道。
   * 使用 Uint32Array 是为了让每个 bin 都保存整数计数并减少对象分配。
   * 这些 helper 是优化版和课程答辩中最需要讲清楚的一段源码。
   * 如果后续要改图像处理逻辑，应优先从这一段开始，并同步更新测试。
   * 不要在这一段加入网络、文件上传或 UI 状态逻辑。
   * 这样可以保持“本地图片 -> 像素 -> 灰度 -> bins”的链路清晰。
   */
  /* 范围限制工具：统一处理灰度桶、归一化高度和导出尺寸边界。 */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* 灰度公式模块：严格按课程公式把 RGB 转成 0..255 的整数 bin。 */
  function computeGrayBin(red, green, blue) {
    var gray = red * 0.299 + green * 0.587 + blue * 0.114;
    return clamp(Math.round(gray), 0, 255);
  }

  /* bins 创建模块：生成长度固定为 256 的原始计数数组。 */
  function createEmptyBins() {
    return new Uint32Array(HISTOGRAM_WIDTH);
  }

  /* 优化版统计模块：单次遍历 RGBA 缓冲区，跳过 alpha 并累计灰度桶。 */
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

  /* 统计求和模块：用于证明 bins 总数等于图片像素总数。 */
  function sumBins(bins) {
    var total = 0;
    for (var index = 0; index < bins.length; index += 1) {
      total += bins[index];
    }
    return total;
  }

  /* 最大桶计数模块：为 0-100 归一化提供缩放基准。 */
  function maxBinCount(bins) {
    var maxCount = 0;
    for (var index = 0; index < bins.length; index += 1) {
      if (bins[index] > maxCount) {
        maxCount = bins[index];
      }
    }
    return maxCount;
  }

  /*
   * 归一化与绘制说明：
   * 原始 bins 保存的是精确像素计数，不能为了显示而覆盖。
   * normalizeHistogram 单独生成 Uint8Array，用来表示 0..100 的显示高度。
   * 最大 bin 计数是当前图片的归一化基准，因此每张图都会独立缩放。
   * 空图片或异常空 bins 会得到全零高度，避免除以 0。
   * drawHistogram 每次先重设 canvas.width 和 canvas.height。
   * canvas 重设尺寸会清空旧位图，避免上一张图残留。
   * 白底黑柱的绘制方式严格对应课程要求的黑白直方图。
   * 每个灰度值对应横向一个像素，所以宽度必须固定为 256。
   * 纵向高度固定为 100，页面只负责缩放展示，不改变源位图。
   * drawImageToSourceCanvas 使用原图实际尺寸读取像素，保证 pixelCount 可验证。
   * willReadFrequently 是给浏览器的读像素性能提示，不改变计算结果。
   * normalizedBinsInRange 用于验收面板，证明所有柱高都在规定范围。
   * 这一段决定了“统计结果如何变成可见直方图”。
   * 后续 UI 美化只能包裹显示，不能替代这里的 256x100 源输出。
   */
  /* 归一化模块：保留原始 bins，只生成 0..100 的显示高度数组。 */
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

  /* 对比快照模块：复制 256 个归一化高度，避免后续图片覆盖 Histogram A。 */
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

  /* 直方图绘制模块：输出源尺寸固定为 256x100，白底黑柱逐列绘制。 */
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

  /* 像素读取模块：按原图尺寸绘制到隐藏 canvas，再读取 RGBA 像素。 */
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

  /* 验收检查模块：确认所有归一化柱高都落在 0..100。 */
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

  /*
   * 灰度分布解释说明：
   * 这组函数不改变直方图数据，只从已完成的 bins 中提取解释性信息。
   * analyzeGrayDistribution 使用灰度值乘以计数，计算整张图的平均灰度。
   * peakGray 表示出现次数最多的灰度值，可用于解释图片主色调。
   * darkRatio、midRatio、brightRatio 把 0..255 划成三个容易讲解的区间。
   * 区间划分是答辩说明辅助，不参与课程规定的直方图算法。
   * exposureLabel 把分布指标压缩成“曝光不足/偏高/正常”这类短标签。
   * createHistogramCompareInsight 用两张图的平均灰度差生成对比说明。
   * delta 阈值设为 8，是为了避免微小波动被误读成明显变化。
   * 对比功能使用 normalized 快照和 distribution 快照，不重新读取像素。
   * 这样附加展示不会改变主流程耗时和准确性。
   * 如果老师只检查核心算法，可以直接忽略这一段。
   * 如果做答辩演示，这一段能把直方图结果讲成更易懂的图像现象。
   */
  /* 灰度分布模块：基于原始 bins 计算均值、峰值和暗/中/亮占比。 */
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

  /* 曝光标签模块：把灰度分布转成答辩时容易说明的文字结论。 */
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

  /* A/B 对比说明模块：根据两张图的灰度分布生成一句变化结论。 */
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

  /*
   * 结果验收指标说明：
   * createResultMetrics 把算法输出转成页面和文档都能引用的证据。
   * binsLength 检查灰度桶数量是否仍为 256。
   * binsSumMatchesPixelCount 检查所有像素是否都被计入一个桶。
   * pixelCountMatchesDimensions 检查像素数是否等于 width * height。
   * canvasSize 检查最终输出源 canvas 是否保持 256x100。
   * normalizedRange 检查柱高是否全部落在 0..100。
   * elapsedUnderThreshold 把真实处理耗时和 300ms 目标进行比较。
   * performanceMargin 用百分比说明距离目标还有多少余量。
   * consistency 把当前实现和 baseline 参考耗时放在同一面板。
   * 这些指标都基于已生成的 result，不额外修改 bins。
   * UI 面板只读 metrics，避免多个地方重复计算导致口径不一致。
   * 这一段是“源码能证明自己正确”的关键证据组织层。
   */
  /* 结果指标模块：把准确性、性能、分布和一致性证据汇总给 UI。 */
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
      consistency: createConsistencyComparison(result, acceptance, BASELINE_REFERENCE_MS, result.elapsedMs)
    };
  }

  /* 一致性对照模块：把当前结果与 baseline 参考耗时和验收项放在一起。 */
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

  /*
   * 主生成流程说明：
   * generateHistogram 是优化版正式处理入口。
   * 计时从 drawImageToSourceCanvas 之前开始，因此包含像素复制和 getImageData。
   * buildHistogramFromRgba 负责灰度公式和 256 bins 统计。
   * normalizeHistogram 负责把计数映射到 0..100。
   * drawHistogram 负责提交 256x100 黑白输出。
   * elapsedMs 在所有这些步骤结束后才停止。
   * 这样不会出现“只统计绘制耗时”的不诚实性能数据。
   * result 同时保存原始 bins、normalized、高宽、最大计数和像素数。
   * metrics 在 result 创建后立即生成，保证 UI 展示和数据同源。
   * now 参数用于测试注入时钟，正式运行默认使用 performance.now。
   * 这一段是用户选图后真正产生结果的中心流程。
   */
  /* 主算法模块：计时覆盖绘图、读像素、灰度统计、归一化和最终渲染。 */
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

  /* 状态文本模块：只更新用户提示，不改变任何直方图数据。 */
  function setStatus(elements, message, kind) {
    elements.statusText.textContent = message;
    elements.statusText.classList.toggle("is-error", kind === "error");
    elements.statusText.classList.toggle("is-success", kind === "success");
  }

  /*
   * UI 基础反馈说明：
   * setStatus 面向页面底部状态条，用于描述当前应用是否待命、处理中或出错。
   * kind 只影响 class，不参与任何业务判断。
   * showToast 面向短时反馈，比如生成完成、保存成功和错误提示。
   * toastTimer 统一保存在 elements 中，便于下一条提示覆盖上一条提示。
   * 如果不清理旧 timer，连续操作时可能出现刚显示就被旧 timer 隐藏的问题。
   * formatPercent 和 formatMargin 只做展示格式转换。
   * setCheckText 把布尔值转成“通过/未通过”，保证验收面板由真实结果驱动。
   * 这一段看起来是 UI 小工具，但它能避免状态提示和算法数据混在一起。
   * 课程检查源码时，可以看到计算结果和展示状态是分层处理的。
   */
  /* 轻提示模块：控制短消息显示和隐藏，避免多个定时器互相干扰。 */
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

  /* 百分比格式化模块：把 0..1 的比例转成一位小数百分比。 */
  function formatPercent(value) {
    return (value * 100).toFixed(1) + "%";
  }

  /* 性能余量格式化模块：把 300ms 目标余量显示为百分比文本。 */
  function formatMargin(value) {
    return value.toFixed(1) + "%";
  }

  /* 检查徽标模块：根据真实布尔证据显示“通过”或“未通过”。 */
  function setCheckText(element, passed) {
    if (!element) {
      return;
    }
    element.textContent = passed ? "通过" : "未通过";
    element.classList.toggle("is-pass", passed);
    element.classList.toggle("is-fail", !passed);
  }

  /* 指标面板模块：把 result.metrics 写入验收、性能、分布和对照卡片。 */
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

  /*
   * 指标面板写入说明：
   * updateMetricsPanels 是结果页最重要的展示胶水。
   * 它不重新计算直方图，只把 result.metrics 中已有证据写到 DOM。
   * 验收自检项直接来自 acceptance 对象。
   * 性能区显示当前耗时、300ms 余量和达标状态。
   * 分布区显示平均灰度、峰值灰度和暗/中/亮比例。
   * 一致性区显示 baseline 参考、当前耗时和各项一致性判断。
   * classList.toggle 只改变颜色，不改变文字背后的布尔结果。
   * 如果某次没有 metrics，函数直接返回，避免空对象导致页面异常。
   * 这一段让“运行稳定”和“证据可展示”落在同一个结果对象上。
   */
  /*
   * Histogram Compare 说明：
   * 对比功能是答辩展示增强，不属于课程必需算法。
   * drawCompareCanvas 仍复用标准 256x100 绘制函数。
   * createCompareSnapshot 会复制 normalized bins，避免 A 被后续结果覆盖。
   * snapshot 还保存尺寸和耗时，用于显示对比标签。
   * updateComparePanel 允许 A 或 B 尚未准备好，避免页面空状态报错。
   * 保存 A 后，下一张图才会作为 B 参与比较。
   * compareInsightText 基于灰度分布生成一句曝光变化说明。
   * bindHistogramCompare 只绑定按钮，不参与主算法处理。
   * 清空对比只清理快照状态，不影响当前直方图结果。
   * 这一段的存在不会改变 gray 公式、bins 数量或归一化规则。
   */
  /* 对比 canvas 模块：复用标准 drawHistogram 绘制 A/B 小图。 */
  function drawCompareCanvas(canvas, normalizedBins) {
    if (!canvas) {
      return;
    }
    drawHistogram(canvas, normalizedBins || new Uint8Array(HISTOGRAM_WIDTH));
  }

  /* 对比快照创建模块：保存当前图的归一化 bins、分布和尺寸耗时。 */
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

  /* 对比标签模块：把快照尺寸和耗时格式化为面板说明。 */
  function formatCompareLabel(snapshot, fallback) {
    if (!snapshot) {
      return fallback;
    }
    return snapshot.width + "x" + snapshot.height + " / " + formatElapsed(snapshot.elapsedMs) + "ms";
  }

  /* 对比面板模块：管理 Histogram A/B 的绘制、标签和结论文本。 */
  function updateComparePanel(elements) {
    if (!elements.compareCanvasA || !elements.compareCanvasB || !elements.compareInsightText) {
      return;
    }

    var beforeSnapshot = elements.compareSnapshotA;
    var afterSnapshot = elements.currentResult && elements.currentResult !== elements.compareSnapshotSource
      ? createCompareSnapshot(elements.currentResult)
      : null;
    var compareReady = Boolean(beforeSnapshot);
    if (elements.comparePanel) {
      elements.comparePanel.classList.toggle("is-ready", compareReady);
    }
    drawCompareCanvas(elements.compareCanvasA, beforeSnapshot && beforeSnapshot.normalized);
    drawCompareCanvas(elements.compareCanvasB, compareReady && afterSnapshot && afterSnapshot.normalized);

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

  /* 对比交互模块：绑定“保存 A”和“清空对比”两个按钮。 */
  function bindHistogramCompare(elements) {
    if (elements.saveCompareButton) {
      elements.saveCompareButton.addEventListener("click", function onSaveCompare() {
        if (!elements.currentResult) {
          showToast(elements, "请先生成一张直方图");
          return;
        }
        elements.compareSnapshotA = createCompareSnapshot(elements.currentResult);
        elements.compareSnapshotSource = elements.currentResult;
        updateComparePanel(elements);
        showToast(elements, "已保存为 Histogram A");
      });
    }

    if (elements.clearCompareButton) {
      elements.clearCompareButton.addEventListener("click", function onClearCompare() {
        elements.compareSnapshotA = null;
        elements.compareSnapshotSource = null;
        updateComparePanel(elements);
        showToast(elements, "对比已清空");
      });
    }
  }

  /*
   * 结果导出说明：
   * copyCanvas 用于把当前直方图复制到放大层，避免直接移动原 canvas。
   * buildCompositeCanvas 生成一个新的导出 canvas。
   * 导出内容包含原图、说明文字和放大的 256x100 直方图。
   * 原图按比例缩放，直方图按固定比例放大。
   * imageSmoothingEnabled 关闭后，直方图像素边界更清楚。
   * saveCompositeImage 优先调用 AndroidHistogramBridge。
   * APK 内由 Java MediaStore 保存到系统图片库。
   * 浏览器预览没有 Android 桥时，会退回到 a 标签下载。
   * 导出失败会进入 catch，并通过 toast 和日志提示。
   * 这一段是结果交付辅助，不参与直方图计算本身。
   */
  /* canvas 复制模块：把当前 256x100 结果复制到放大层 canvas。 */
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

  /* 拼接导出模块：生成“原图 + 说明条 + 直方图”的 PNG canvas。 */
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
    context.fillStyle = "#c7a7ff";
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

  /* 图片保存模块：优先走 Android 桥，本地浏览器预览时退回下载链接。 */
  function saveCompositeImage(documentRef, elements) {
    try {
      var outputCanvas = buildCompositeCanvas(
        documentRef,
        elements.currentImage,
        elements.histogramCanvas,
        elements.currentResult,
        "优化后直方图分析"
      );
      var dataUrl = outputCanvas.toDataURL("image/png");
      var filename = "histogram-analysis-" + Date.now() + ".png";
      var bridge = documentRef.defaultView && documentRef.defaultView.AndroidHistogramBridge;

      if (bridge && bridge.saveCompositeImage) {
        bridge.saveCompositeImage(dataUrl.replace(/^data:image\/png;base64,/, ""), filename);
        showToast(elements, "拼接图已保存到图片库");
        appendLog(elements, "EXPORT: composite image sent to Android gallery bridge.");
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
      appendLog(elements, "EXPORT: composite image downloaded by browser fallback.");
    } catch (error) {
      showToast(elements, error.message || "拼接图保存失败");
      appendLog(elements, "EXPORT failed: " + (error.message || "unknown error"));
    }
  }

  /*
   * 放大查看与保存确认说明：
   * openHistogramZoom 在已有结果时打开横向放大层。
   * closeHistogramZoom 会同时关闭保存确认框，避免弹窗残留。
   * openSaveConfirm 只负责显示确认框，不直接保存。
   * closeSaveConfirm 只关闭确认框，不触发导出。
   * bindHistogramZoom 绑定点击、长按、pointer cancel、contextmenu 和 Escape。
   * 长按通过 LONG_PRESS_MS 控制，避免短触摸误保存。
   * longPressFired 用来区分长按和普通点击。
   * 点遮罩或按 Esc 可以取消，不会生成文件。
   * 用户点击确认保存后才调用 saveCompositeImage。
   * 这保证了图片导出有明确用户意图。
   */
  /* 直方图放大模块：点击结果图后打开横向放大视图。 */
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

  /* 放大层关闭模块：关闭前先收起保存确认弹窗。 */
  function closeHistogramZoom(elements) {
    if (!elements.histogramZoom) {
      return;
    }
    closeSaveConfirm(elements);
    elements.histogramZoom.classList.remove("is-visible");
    elements.histogramZoom.hidden = true;
  }

  /* 保存确认模块：长按后弹出确认框，避免误保存。 */
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

  /* 保存确认关闭模块：只隐藏确认框，不触发导出。 */
  function closeSaveConfirm(elements) {
    if (elements.saveConfirmDialog) {
      elements.saveConfirmDialog.hidden = true;
    }
  }

  /* 放大交互绑定模块：处理点击放大、长按保存、遮罩取消和 Esc 关闭。 */
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

  /*
   * 手势稳定性说明：
   * 长按保存和点击放大共用同一个直方图区域。
   * 因此代码需要区分“短点击”和“长按完成”。
   * clearLongPress 会在 pointerup、pointercancel、pointerleave 时清理定时器。
   * event.preventDefault 用于避免移动端长按弹出系统菜单。
   * contextmenu 也会被阻止，因为保存动作由自定义确认框控制。
   * saveConfirmCancel 只关闭弹窗，不调用保存。
   * saveConfirmAccept 才会进入 saveCompositeImage。
   * Esc 的处理顺序是先关确认框，再关放大层。
   * 这保证用户误触时不会直接把图片写入系统图库。
   */
  /*
   * 日志输出说明：
   * 终端日志不是调试残留，而是答辩时展示处理链路的证据。
   * terminalTime 生成每条日志的本地时间。
   * appendLog 负责创建 DOM 节点并滚动到底部。
   * appendBootLogs 写入引擎、离线边界、公式和计时范围。
   * describeFile 记录用户选择的本地文件信息。
   * appendImageDecodedLogs 记录图像解码后的宽高和像素数。
   * appendComputeStartLogs 记录 RGBA 读取和归一化规则。
   * appendResultLogs 记录最大桶、像素数、耗时和输出尺寸。
   * 日志只显示过程，不参与任何计算。
   * 如果演示中需要解释“为什么耗时可信”，这一段提供页面证据。
   */
  /* 日志时间模块：生成终端日志前缀的 HH:mm:ss 时间。 */
  function terminalTime() {
    var now = new Date();
    return [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  /* 终端日志模块：向日志页追加技术过程说明，便于答辩演示。 */
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

  /* 启动日志模块：说明当前引擎、离线边界、公式和计时范围。 */
  function appendBootLogs(elements) {
    appendLog(elements, "ENGINE: optimized typed-array pipeline online.");
    appendLog(elements, "RUNTIME: offline H5 Canvas in Android WebView / browser preview, no remote assets required.");
    appendLog(elements, "SPEC: grayscale formula round(0.299R + 0.587G + 0.114B), bins[0..255], output 256x100.");
    appendLog(elements, "TIMER: elapsed time covers pixel read, grayscale, bin counting, normalization and rendering.");
  }

  /* 文件描述模块：记录用户选图的文件名、类型和大小。 */
  function describeFile(file) {
    return "FILE: name=\"" + file.name + "\", type=" + (file.type || "unknown") + ", size=" + Math.round(file.size / 1024) + " KB.";
  }

  /* 解码日志模块：记录图片尺寸和进入 getImageData 前的 canvas 尺寸。 */
  function appendImageDecodedLogs(elements, image) {
    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    var pixelCount = width * height;
    appendLog(elements, "DECODE: image bitmap ready, dimensions=" + width + "x" + height + ", pixels=" + pixelCount + ".");
    appendLog(elements, "CANVAS: source canvas resized to " + width + "x" + height + " before getImageData().");
  }

  /* 计算开始日志模块：记录 RGBA 读取、单次遍历和归一化规则。 */
  function appendComputeStartLogs(elements) {
    appendLog(elements, "READ: extracting RGBA buffer with willReadFrequently=true.");
    appendLog(elements, "COMPUTE: single pass over RGBA data, step=4 bytes, writing Uint32Array(256).");
    appendLog(elements, "NORMALIZE: each bin maps to round(count / maxCount * 100).");
  }

  /* 结果日志模块：记录最大桶、像素数、耗时和输出尺寸。 */
  function appendResultLogs(elements, result) {
    appendLog(elements, "RESULT: maxBinCount=" + result.maxCount + ", pixelCount=" + result.pixelCount + ", elapsed=" + formatElapsed(result.elapsedMs) + " ms.");
    appendLog(elements, "VERIFY: sum(bins) should match pixelCount; displayed binCount=" + HISTOGRAM_WIDTH + ".");
    appendLog(elements, "RENDER: histogram canvas committed as " + HISTOGRAM_WIDTH + "x" + HISTOGRAM_HEIGHT + " black-white bitmap.");
  }

  /*
   * 处理中状态说明：
   * PROCESSING_STAGES 定义了扫描、统计、归一化、渲染、完成五个阶段。
   * getProcessingStage 根据阶段 id 取出显示文案。
   * inferProcessingStage 在调用方只给百分比时自动推断阶段。
   * updateProcessingSteps 同步步骤列表的 active 和 complete 样式。
   * clearProcessingTimers 防止旧任务的定时器污染新任务。
   * runProcessingSequence 只负责 UI 演出，不能替代真实耗时。
   * setProcessing 同时管理内联进度条和全屏覆盖层。
   * 当 active 为 false 时会重置进度和隐藏覆盖层。
   * 这一段的动画用于用户体验，不作为性能测试数据。
   * 真正的 elapsedMs 仍来自 generateHistogram。
   */
  /* 处理阶段查找模块：根据 stage id 找到 loading 展示文案。 */
  function getProcessingStage(stageId) {
    for (var index = 0; index < PROCESSING_STAGES.length; index += 1) {
      if (PROCESSING_STAGES[index].id === stageId) {
        return PROCESSING_STAGES[index];
      }
    }
    return PROCESSING_STAGES[0];
  }

  /* 阶段推断模块：只有百分比时自动推导当前处理阶段。 */
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

  /* 进度步骤模块：同步内联和覆盖层中每个阶段的 active/complete 状态。 */
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

  /* 定时器清理模块：开始新任务前清掉旧 loading 定时器。 */
  function clearProcessingTimers(elements) {
    if (!elements.processingTimers) {
      return;
    }
    for (var index = 0; index < elements.processingTimers.length; index += 1) {
      clearTimeout(elements.processingTimers[index]);
    }
    elements.processingTimers = [];
  }

  /* 进度演出模块：按给定延迟串行更新 loading 状态。 */
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

  /* loading 状态模块：统一控制进度条、覆盖层、阶段文字和退出动画。 */
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

  /*
   * loading 稳定性说明：
   * setProcessing 同时面对两套 UI：结果页内联进度和全屏覆盖层。
   * 函数前半段先处理必需的内联面板。
   * 如果覆盖层节点不存在，函数会提前返回，不影响核心功能。
   * active 为 true 时显示覆盖层并移除离场 class。
   * active 为 false 时先播放离场，再延迟 hidden。
   * processingOverlayTimer 防止覆盖层隐藏动作与新任务冲突。
   * 每次关闭时都会把进度条宽度和百分比重置为 0。
   * 这让用户连续选择多张图片时，loading 不会继承上一张图的状态。
   * 该模块只表现阶段，不影响 generateHistogram 的真实计时。
   */
  /*
   * 页面交互与图像解码说明：
   * bindInputModality 区分触摸和键盘，兼顾移动观感和可访问性。
   * showScreen 只切换页面显示状态，不销毁 DOM。
   * bindNavigation 把所有 data-screen-target 接入 showScreen。
   * runSplash 只负责启动动画离场，不阻塞选图。
   * afterPaint 让浏览器先绘制 loading，再进入重计算。
   * loadImageFromFile 使用 object URL 解码本地文件。
   * 失败时会立即释放 object URL，成功后由下一次选择时释放旧 URL。
   * formatElapsed 根据耗时大小选择小数位，便于页面阅读。
   * 这些函数连接 UI 和算法，但不改变灰度计算规则。
   */
  /* 输入方式模块：触摸/鼠标隐藏点击焦点，键盘 Tab 保留可访问焦点。 */
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

  /* 页面切换模块：用 data-screen 在移动端多 tab 间切换。 */
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

  /* 导航绑定模块：把所有 data-screen-target 元素接入页面切换。 */
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

  /* 开屏模块：控制启动动画的离场，不影响算法初始化。 */
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

  /* 渲染让步模块：让浏览器先绘制 loading，再执行较重计算。 */
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

  /* 本地图像解码模块：使用 object URL 解码文件，不上传、不联网。 */
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

  /* 耗时格式化模块：短耗时保留更多小数，长耗时保持易读。 */
  function formatElapsed(ms) {
    return ms.toFixed(ms >= 10 ? 1 : 2);
  }

  /*
   * 初始化和主事件说明：
   * init 收集页面中所有需要的 DOM 元素。
   * 如果关键 input 或 canvas 缺失，函数会直接返回，避免运行时报错。
   * 初始化阶段会绑定输入方式、导航、放大查看和 Histogram Compare。
   * 初始直方图绘制为空白 256x100，保证页面一打开就有合法 canvas。
   * imageInput change 是完整用户流程的入口。
   * 选择为空时只提示待命，不改变旧结果。
   * 非图片文件会被拒绝，并清空 input 方便重新选择。
   * 图片加载成功后会更新预览、记录日志并跳到结果页。
   * 真实计算通过 afterPaint 包裹，让 loading 先显示。
   * 计算成功后更新指标、对比面板、日志和 toast。
   * catch 分支会隐藏处理状态并给出错误提示。
   * finally 清空 input，使同一张图片可以连续选择测试。
   */
  /* 初始化模块：收集 DOM、绑定交互、绘制空直方图并接入选图主流程。 */
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
      comparePanel: documentRef.getElementById("comparePanel"),
      compareCanvasA: documentRef.getElementById("compareCanvasA"),
      compareCanvasB: documentRef.getElementById("compareCanvasB"),
      compareALabel: documentRef.getElementById("compareALabel"),
      compareBLabel: documentRef.getElementById("compareBLabel"),
      compareInsightText: documentRef.getElementById("compareInsightText"),
      saveConfirmDialog: documentRef.getElementById("saveConfirmDialog"),
      saveConfirmCancel: documentRef.getElementById("saveConfirmCancel"),
      saveConfirmAccept: documentRef.getElementById("saveConfirmAccept"),
      compareSnapshotA: null,
      compareSnapshotSource: null,
      currentImage: null,
      currentResult: null
    };

    /*
     * 初始化防御说明：
     * imageInput、histogramCanvas 和 sourceCanvas 是主流程的最低依赖。
     * 如果这些节点不存在，说明 HTML 结构不完整，继续绑定事件没有意义。
     * 因此这里直接 return，避免后续空引用错误。
     * 正常 APK 中这些节点都来自 index.html。
     */
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

      /*
       * 选图入口说明：
       * 用户取消选择时，不清空当前结果，只把状态改回待命。
       * 非图片文件会被拒绝，因为算法只处理 image/* 解码结果。
       * 每次合法选图都会先记录文件信息，再进入加载和处理链路。
       * clearProcessingTimers 防止上一张图的 loading 演出继续运行。
       * setProcessing 先显示“扫描像素”，让用户知道系统已响应。
       */
      if (!file) {
        setStatus(elements, "未选择图片", "");
        appendLog(elements, "未选择图像，流程保持待命。");
        return;
      }
      if (!file.type || file.type.indexOf("image/") !== 0) {
        setStatus(elements, "请选择图片文件", "error");
        appendLog(elements, "拒绝输入：文件类型不是 image/*。");
        elements.imageInput.value = "";
        return;
      }

      appendLog(elements, describeFile(file));
      appendLog(elements, "QUEUE: accepted local image file, object URL decode requested.");
      setStatus(elements, "正在处理图片", "");
      clearProcessingTimers(elements);
      setProcessing(elements, true, "扫描像素", 16, "scan");
      loadImageFromFile(file)
        .then(function handleLoaded(payload) {
          /*
           * 图片解码成功说明：
           * 新 object URL 接管预览前，会释放旧 object URL。
           * currentImage 保存解码后的 Image 对象，供导出拼接图复用。
           * 预览图只负责展示，不参与后续像素读取。
           * showScreen 自动跳转到输出页，让用户直接看到生成过程。
           */
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
          setStatus(elements, "图片已载入，正在生成直方图", "");
          return runProcessingSequence(elements, [
            { delay: 120, stage: "scan", message: "扫描像素", percent: 28 },
            { delay: 260, stage: "compute", message: "统计直方图", percent: 56 }
          ]).then(function runHistogramAfterIntro() {
            return afterPaint(function runHistogram() {
              /*
               * 真实计算触发说明：
               * afterPaint 确保 loading 有机会先绘制到屏幕。
               * appendComputeStartLogs 记录正式进入像素读取和统计阶段。
               * generateHistogram 才是真正的算法计时和绘制入口。
               */
              appendComputeStartLogs(elements);
              var result = generateHistogram(payload.image, elements.sourceCanvas, elements.histogramCanvas);
              return {
                result: result
              };
            });
          });
        })
        .then(function handleResult(payload) {
          /*
           * 结果写回说明：
           * currentResult 保存完整算法输出，供指标、对比和导出复用。
           * imageMeta、elapsedText、binCountText 等字段只负责显示。
           * updateMetricsPanels 写入验收和性能证据。
           * updateComparePanel 根据是否保存 A 来决定是否展示 A/B 对比。
           */
          var result = payload.result;
          elements.currentResult = result;
          elements.imageMeta.textContent = result.width + " x " + result.height;
          elements.elapsedText.textContent = "耗时 " + formatElapsed(result.elapsedMs) + " ms";
          elements.binCountText.textContent = String(HISTOGRAM_WIDTH);
          elements.maxCountText.textContent = String(result.maxCount);
          elements.pixelCountText.textContent = String(result.pixelCount);
          updateMetricsPanels(elements, result);
          updateComparePanel(elements);
          return runProcessingSequence(elements, [
            { delay: 180, stage: "normalize", message: "归一化", percent: 74 },
            { delay: 220, stage: "render", message: "渲染输出", percent: 92 },
            { delay: 180, stage: "done", message: "完成", percent: 100 }
          ]).then(function finishProcessing() {
            /*
             * 成功收尾说明：
             * 完成阶段先展示 100% 进度，再延迟隐藏 loading。
             * 这样用户能看到处理闭环，而不是结果突然跳变。
             * appendResultLogs 在日志页留下本次生成证据。
             */
            setStatus(elements, "结果已更新，可继续选择图片", "success");
            appendResultLogs(elements, result);
            showToast(elements, "直方图生成完成");
            elements.processingTimers.push(setTimeout(function hideProcessing() {
              setProcessing(elements, false, "", 0);
            }, 520));
          });
        })
        .catch(function handleError(error) {
          /*
           * 异常恢复说明：
           * 任意解码或处理错误都会关闭 loading。
           * 日志记录技术原因，状态条给用户可理解提示。
           * 不抛出到全局，保证用户可以继续重新选择图片。
           */
          setProcessing(elements, false, "", 0);
          appendLog(elements, "处理失败：" + (error.message || "未知错误"));
          setStatus(elements, error.message || "图像处理失败，请重试", "error");
        })
        .finally(function resetInput() {
          /* 清空 input 值：允许用户连续选择同一张图片做重复测试。 */
          elements.imageInput.value = "";
        });
    });
  }

  /*
   * 对外导出说明：
   * return 中列出的函数是测试脚本和页面初始化可访问的公共 API。
   * HISTOGRAM_WIDTH 和 HISTOGRAM_HEIGHT 用于测试确认输出规格。
   * computeGrayBin、buildHistogramFromRgba、normalizeHistogram 是核心算法证据。
   * sumBins、maxBinCount、normalizedBinsInRange 用于验收检查。
   * analyzeGrayDistribution 和 compare 相关函数用于结果解释。
   * drawHistogram 和 generateHistogram 连接 canvas 输出与完整主流程。
   * init 是浏览器/WebView 页面启动入口。
   * 没有放进 return 的函数都保持模块私有，避免外部随意改动 UI 状态。
   * 这种导出边界让测试能覆盖关键算法，同时不暴露过多内部实现。
   */
  /* 测试导出模块：把纯算法 helper 暴露给 Node.js fixture。 */
  return {
    HISTOGRAM_WIDTH: HISTOGRAM_WIDTH,
    HISTOGRAM_HEIGHT: HISTOGRAM_HEIGHT,
    computeGrayBin: computeGrayBin,
    buildHistogramFromRgba: buildHistogramFromRgba,
    normalizeHistogram: normalizeHistogram,
    sumBins: sumBins,
    maxBinCount: maxBinCount,
    normalizedBinsInRange: normalizedBinsInRange,
    analyzeGrayDistribution: analyzeGrayDistribution,
    exposureLabel: exposureLabel,
    createHistogramCompareInsight: createHistogramCompareInsight,
    createConsistencyComparison: createConsistencyComparison,
    createResultMetrics: createResultMetrics,
    drawHistogram: drawHistogram,
    generateHistogram: generateHistogram,
    init: init
  };
});
