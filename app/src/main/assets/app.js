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
  var EXPORT_MAX_WIDTH = 1600;
  var EXPORT_MIN_WIDTH = 1024;
  var LONG_PRESS_MS = 650;

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
    appendLog(elements, "ENGINE: optimized typed-array pipeline online.");
    appendLog(elements, "RUNTIME: offline H5 Canvas in Android WebView / browser preview, no remote assets required.");
    appendLog(elements, "SPEC: grayscale formula round(0.299R + 0.587G + 0.114B), bins[0..255], output 256x100.");
    appendLog(elements, "TIMER: elapsed time covers pixel read, grayscale, bin counting, normalization and rendering.");
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
    appendLog(elements, "COMPUTE: single pass over RGBA data, step=4 bytes, writing Uint32Array(256).");
    appendLog(elements, "NORMALIZE: each bin maps to round(count / maxCount * 100).");
  }

  function appendResultLogs(elements, result) {
    appendLog(elements, "RESULT: maxBinCount=" + result.maxCount + ", pixelCount=" + result.pixelCount + ", elapsed=" + formatElapsed(result.elapsedMs) + " ms.");
    appendLog(elements, "VERIFY: sum(bins) should match pixelCount; displayed binCount=" + HISTOGRAM_WIDTH + ".");
    appendLog(elements, "RENDER: histogram canvas committed as " + HISTOGRAM_WIDTH + "x" + HISTOGRAM_HEIGHT + " black-white bitmap.");
  }

  function setProcessing(elements, active, message, percent) {
    if (!elements.processingPanel || !elements.progressBar || !elements.processingLabel) {
      return;
    }

    var nextPercent = clamp(percent || 0, 0, 100);
    elements.processingPanel.hidden = !active;
    elements.processingLabel.textContent = message || "正在处理";
    elements.progressBar.style.width = nextPercent + "%";

    if (!elements.processingOverlay || !elements.processingOverlayBar || !elements.processingOverlayLabel || !elements.processingOverlayPercent) {
      return;
    }

    if (elements.processingOverlayTimer) {
      clearTimeout(elements.processingOverlayTimer);
      elements.processingOverlayTimer = 0;
    }

    elements.processingOverlayLabel.textContent = message || "正在处理";
    elements.processingOverlayPercent.textContent = Math.round(nextPercent) + "%";
    elements.processingOverlayBar.style.width = nextPercent + "%";

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
      progressBar: documentRef.getElementById("progressBar"),
      processingOverlay: documentRef.getElementById("processingOverlay"),
      processingOverlayLabel: documentRef.getElementById("processingOverlayLabel"),
      processingOverlayPercent: documentRef.getElementById("processingOverlayPercent"),
      processingOverlayBar: documentRef.getElementById("processingOverlayBar"),
      processingOverlayTimer: 0,
      elapsedText: documentRef.getElementById("elapsedText"),
      binCountText: documentRef.getElementById("binCountText"),
      maxCountText: documentRef.getElementById("maxCountText"),
      pixelCountText: documentRef.getElementById("pixelCountText"),
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
      saveConfirmDialog: documentRef.getElementById("saveConfirmDialog"),
      saveConfirmCancel: documentRef.getElementById("saveConfirmCancel"),
      saveConfirmAccept: documentRef.getElementById("saveConfirmAccept"),
      currentImage: null,
      currentResult: null
    };

    if (!elements.imageInput || !elements.histogramCanvas || !elements.sourceCanvas) {
      return;
    }

    bindInputModality(documentRef);
    bindNavigation(documentRef, elements);
    bindHistogramZoom(documentRef, elements);
    runSplash(elements);
    drawHistogram(elements.histogramCanvas, new Uint8Array(HISTOGRAM_WIDTH));
    appendBootLogs(elements);

    var currentObjectUrl = "";
    elements.imageInput.addEventListener("change", function onImageSelected(event) {
      var file = event.target.files && event.target.files[0];

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
      setProcessing(elements, true, "正在载入图片", 24);
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
          setStatus(elements, "图片已载入，正在生成直方图", "");
          setProcessing(elements, true, "读取像素与统计 bins", 62);
          return afterPaint(function runHistogram() {
            appendComputeStartLogs(elements);
            var result = generateHistogram(payload.image, elements.sourceCanvas, elements.histogramCanvas);
            return {
              result: result
            };
          });
        })
        .then(function handleResult(payload) {
          var result = payload.result;
          elements.currentResult = result;
          elements.imageMeta.textContent = result.width + " x " + result.height;
          elements.elapsedText.textContent = "耗时 " + formatElapsed(result.elapsedMs) + " ms";
          elements.binCountText.textContent = String(HISTOGRAM_WIDTH);
          elements.maxCountText.textContent = String(result.maxCount);
          elements.pixelCountText.textContent = String(result.pixelCount);
          setProcessing(elements, true, "直方图生成完成", 100);
          setStatus(elements, "结果已更新，可继续选择图片", "success");
          appendResultLogs(elements, result);
          showToast(elements, "直方图生成完成");
          setTimeout(function hideProcessing() {
            setProcessing(elements, false, "", 0);
          }, 420);
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
