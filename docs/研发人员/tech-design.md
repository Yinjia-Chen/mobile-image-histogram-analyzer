# 技术设计

## 1. 设计目标

本文档面向研发实现，说明移动端图像直方图分析系统的技术方案和当前实现口径。项目采用 Android WebView 壳 App + H5 Canvas，本地完成图片选择、像素读取、灰度直方图统计、`256x100` 绘制、耗时展示和性能对照。

项目主流程如下：

```text
启动 APK
-> 加载本地 H5 页面
-> 选择手机本地图片
-> 预览图片
-> 读取像素
-> 灰度化
-> 统计直方图
-> 归一化
-> 绘制 256x100 黑白直方图
-> 显示生成耗时
```

当前仓库已经输出优化前 / 优化后两份可并装 APK。性能优化以同边界 baseline/optimized 对照方式固化，不改变灰度公式、256 bin 统计、`0-100` 归一化或 `256x100` 输出规则。Android 真机耗时、截图和设备信息仍按测试文档要求回填。

## 2. 技术边界

| 层级 | 职责 | 不负责 |
| --- | --- | --- |
| Android 壳层 | APK 封装、WebView 初始化、本地 H5 加载、本地图片选择支持 | 灰度化、直方图统计、直方图绘制 |
| H5 页面层 | 页面结构、用户交互、图片预览、状态提示 | APK 安装、Android 权限管理 |
| H5 算法层 | Canvas 像素读取、灰度化、256 bin 统计、0-100 归一化、直方图绘制、耗时记录 | 后端服务、数据库、云端存储 |

核心约束：

- 不引入后端、数据库、登录或云端图片上传。
- 不依赖 CDN、远程脚本、远程图片或服务端接口。
- 保持离线 APK 演示路径稳定。
- 保持灰度化公式与任务书一致。
- 保持直方图输出语义为 `256x100`。

## 3. 计划目录结构

```text
.
├── app/
│   └── src/main/
│       ├── java/.../MainActivity.java
│       ├── assets/
│       │   ├── index.html
│       │   ├── style.css
│       │   └── app.js
│       └── AndroidManifest.xml
├── dist/
│   ├── mobile-histogram-baseline-coinstall-debug.apk
│   └── mobile-histogram-optimized-coinstall-debug.apk
├── docs/
│   ├── 项目经理/
│   ├── 需求分析师/
│   ├── 测试人员/
│   ├── 研发人员/
│   ├── 产物-项目选题报告.md
│   ├── 产物-需求分析报告.md
│   └── 产物-概要设计.md
├── README.md
└── package.json
```

说明：

- H5 文件直接放在 `app/src/main/assets/` 中，减少构建链路，保证 APK 离线运行。
- 本地浏览器预览通过 `npm run preview` 启动，只用于调试 UI 和截图；正式交付仍以 APK 为准。
- 当前不引入前端框架，优先使用原生 HTML、CSS、JavaScript 和 Canvas。
- Android product flavors 区分 baseline 与 optimized，保证两份 APK 可并装、可对比。

## 4. Android 壳层设计

### 4.1 MainActivity 职责

`MainActivity` 负责：

- 创建并配置 WebView。
- 加载本地入口页面 `file:///android_asset/index.html`。
- 支持 H5 页面触发本地图片选择。
- 将用户选择的图片结果返回给 WebView。
- 保持无网络状态下页面可打开。

### 4.2 WebView 配置

第一阶段建议配置：

| 配置项 | 建议 |
| --- | --- |
| JavaScript | 启用，用于 H5 主流程逻辑 |
| DOM Storage | 可启用，便于后续简单状态保存；主流程不依赖它 |
| File Access | 根据本地图片选择和 assets 加载需要配置 |
| Network | 主流程不依赖网络资源 |
| Debug | 开发阶段可启用 WebView 调试，提交说明中不作为运行依赖 |

### 4.3 本地图片选择

H5 页面可以使用文件选择入口，Android 层通过 WebView 文件选择回调处理：

```text
H5 点击选择图片
-> WebView 触发文件选择回调
-> Android 打开系统图片选择器
-> 用户选择图片
-> Android 将 Uri 返回给 WebView
-> H5 读取图片并进入 Canvas 处理流程
```

第一阶段只支持单张图片选择，不做多图批量处理。

### 4.4 Android 权限

图片选择优先使用系统选择器，减少直接申请存储权限的复杂度。若目标 Android 版本或实现方式需要读取权限，再按实际版本补充最小权限。

设计原则：

- 权限只服务本地图片选择。
- 不申请网络权限作为主流程依赖。
- 不申请与核心功能无关的权限。

## 5. H5 页面设计

### 5.1 页面结构

建议页面包含以下区域：

```text
标题区
操作区：选择图片按钮
预览区：原图预览
结果区：256x100 直方图 Canvas
信息区：生成耗时、状态提示
```

### 5.2 关键 DOM 元素

| 元素 | 建议 id | 用途 |
| --- | --- | --- |
| 文件选择输入 | `imageInput` | 选择本地图片 |
| 原图预览 | `previewImage` 或 `previewCanvas` | 展示当前图片 |
| 隐藏处理 Canvas | `sourceCanvas` | 绘制原图并读取像素 |
| 直方图 Canvas | `histogramCanvas` | 绘制 `256x100` 黑白直方图 |
| 耗时文本 | `elapsedText` | 展示生成耗时 |
| 状态提示 | `statusText` | 展示错误或流程状态 |

### 5.3 Canvas 设计

建议使用两个 Canvas：

| Canvas | 尺寸 | 用途 |
| --- | --- | --- |
| `sourceCanvas` | 根据图片尺寸设置 | 绘制原图并读取像素，不一定直接展示 |
| `histogramCanvas` | 固定 `256x100` | 作为直方图结果源 |

页面展示时可以将 `histogramCanvas` 通过 CSS 放大，但实际绘制数据仍保持 `256x100`。

## 6. H5 主流程设计

### 6.1 流程控制

建议主入口函数：

```text
handleImageSelected(file)
```

内部流程：

```text
validateImage(file)
-> loadImage(file)
-> previewImage(image)
-> generateHistogram(image)
-> renderHistogram(normalizedBins)
-> renderElapsedTime(elapsedMs)
```

### 6.2 函数拆分建议

| 函数 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `loadImage(file)` | File | HTMLImageElement | 将本地文件加载成图片对象 |
| `drawToSourceCanvas(image)` | HTMLImageElement | ImageData | 绘制图片并读取 RGBA 像素 |
| `computeGray(r, g, b)` | RGB 通道 | 灰度 bin | 使用指定公式计算灰度值 |
| `buildHistogram(imageData)` | ImageData | 256 bin 数组 | 遍历像素并统计灰度值 |
| `normalizeHistogram(bins)` | 256 bin 数组 | 0-100 高度数组 | 按最大计数归一化 |
| `drawHistogram(normalized)` | 0-100 高度数组 | 无 | 绘制 `256x100` 直方图 |
| `generateHistogram(image)` | 图片对象 | 结果对象 | 串联主流程并记录耗时 |
| `setStatus(message)` | 文本 | 无 | 展示状态提示 |

### 6.3 结果对象

建议 `generateHistogram` 返回：

```js
{
  bins: number[256],
  normalized: number[256],
  elapsedMs: number,
  width: number,
  height: number
}
```

说明：

- `bins` 用于后续准确性测试。
- `normalized` 用于绘图。
- `elapsedMs` 用于页面展示和基础耗时记录。
- `width`、`height` 用于测试报告记录图片尺寸。

## 7. 算法设计

### 7.1 灰度化

必须使用任务书指定公式：

```text
gray = red * 0.299 + green * 0.587 + blue * 0.114
```

编码阶段需要统一取整策略。建议第一阶段使用：

```text
grayBin = Math.round(gray)
```

并保证边界：

```text
grayBin < 0   -> 0
grayBin > 255 -> 255
```

### 7.2 统计

统计数组固定为 256 个元素。当前优化版使用 `Uint32Array(256)`，降低普通数组和对象分配开销：

```js
const bins = new Uint32Array(256);
```

遍历 ImageData：

```text
for i from 0 to data.length step 4:
    red = data[i]
    green = data[i + 1]
    blue = data[i + 2]
    grayBin = computeGray(red, green, blue)
    bins[grayBin] += 1
```

### 7.3 归一化

```text
maxCount = max(bins)
normalized[i] = round(bins[i] / maxCount * 100)
```

异常处理：

- 如果 `maxCount <= 0`，不绘制直方图。
- 如果图片读取失败，提示用户重新选择图片。

### 7.4 绘制

输出 Canvas 源尺寸固定为 `256x100`。页面可以通过 CSS 放大展示，但源结果不能改变尺寸语义。

绘制规则：

- 先清空直方图 Canvas；
- 使用白色背景；
- 每个灰度值对应一列；
- 黑色柱从底部向上绘制；
- 柱高来自 `0-100` 归一化结果。

## 8. 当前实现收口

### 8.1 Android 实现

| 能力 | 当前实现 |
| --- | --- |
| WebView 入口 | `BuildConfig.LOCAL_ENTRY_URL`，由 flavor 决定加载 optimized 或 baseline 页面 |
| optimized 入口 | `file:///android_asset/index.html` |
| baseline 入口 | `file:///android_asset/index-baseline.html` |
| 文件选择 | `WebChromeClient.onShowFileChooser` 转到 Android 系统图片选择器 |
| 图片保存 | `AndroidHistogramBridge.saveCompositeImage` 接收 H5 PNG base64，通过 MediaStore 保存到系统图片库 |
| 离线边界 | 核心页面、样式和脚本打包在 APK assets 中，不申请网络权限作为主流程依赖 |

### 8.2 H5 实现

| 模块 | 当前实现 |
| --- | --- |
| 页面入口 | `index.html` 为优化版入口，`index-baseline.html` 为低效对照入口 |
| 主逻辑 | `app.js` 负责图片加载、Canvas 处理、灰度统计、归一化、绘制、指标和日志 |
| baseline 逻辑 | `baseline-app.js` 使用低效路径构造对照，不作为正式产品入口 |
| 样式系统 | `style.css` 统一黑紫控制台视觉、移动端 tab、loading、弹窗和结果展示 |
| 展示结构 | 接入、链路、输出、指标、协议、日志六个视图 |
| 增强能力 | Histogram Compare、直方图点击放大、长按确认保存拼接图 |

### 8.3 Flavor 与 APK

| Flavor | 包名 | 应用名 | 入口 | 用途 |
| --- | --- | --- | --- | --- |
| `baselineDebug` | `com.framia.mobilehistogram.baseline` | `直方图分析-优化前` | `index-baseline.html` | 性能压力对照 |
| `optimizedDebug` | `com.framia.mobilehistogram.optimized` | `直方图分析-优化后` | `index.html` | 正式演示版本 |

## 9. 性能设计

性能计时边界保持为：

```text
Canvas 像素读取
-> 灰度计算
-> 256 bin 统计
-> 0-100 归一化
-> 256x100 绘制
```

当前优化策略：

| 策略 | 说明 |
| --- | --- |
| TypedArray | 使用 `Uint32Array(256)` 统计灰度值 |
| 单次遍历 | 一次遍历 RGBA 数据完成灰度计算和 bin 计数 |
| 固定输出 | 结果绘制固定为 `256x100`，不随原图尺寸扩大 |
| 对照实现 | baseline 页面保留低效对象分配、重复计算和重复扫描，便于说明优化价值 |
| 结果一致性 | baseline 与 optimized 必须输出一致 bins、归一化和渲染缓冲区 |

开发机 benchmark 已记录在 `docs/测试人员/stage5-performance-comparison.md`。该数据用于说明实现策略差异，不替代 Android 真机测试。

## 10. 验证命令

研发提交前至少执行：

```bash
npm run test:histogram
npm run test:offline
npm run test:baseline
npm run benchmark:histogram
npm run check:source-comments
npm run harness:verify
```

如涉及 APK 产物，需要执行 Android 构建并更新 APK 大小、SHA256、包名和入口记录。构建示例：

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/framia/Library/Android/sdk" \
./gradlew --offline assembleBaselineDebug assembleOptimizedDebug
```

## 11. 已知边界

| 边界 | 说明 |
| --- | --- |
| 真机数据 | 机型、Android 版本、截图和实际耗时仍需测试人员回填 |
| 图片尺寸 | 超大图片可能受手机性能和 WebView 内存影响，答辩优先使用准备好的中等尺寸图片 |
| 保存图片 | 长按保存是增强功能，不作为核心验收路径 |
| baseline | baseline 是压力对照实现，不代表历史生产版本 |
| 网络 | 核心功能不依赖网络，不能用远程图片作为验收输入 |

## 12. 小结

本技术设计将系统实现拆分为 Android 壳层和 H5 Canvas 功能层。Android 层负责 APK、WebView、本地图片选择和用户确认后的图片保存；H5 层负责主流程图像处理、结果展示、指标说明和性能对照。当前研发重点已经从“搭主流程”转为“稳住交付口径”：不扩范围、不改算法、不伪造性能，确保源码、APK、测试证据和课程文档相互对得上。
