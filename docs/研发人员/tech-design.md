# 技术设计

## 1. 设计目标

本文档面向研发实现，说明移动端图像直方图分析系统第一阶段的技术方案。第一阶段只关注主流程功能闭环：

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

性能优化不作为本阶段主流程设计内容。当前阶段只保留耗时记录能力，后续再单独整理性能优化方案和测试记录。

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
├── docs/
│   ├── 产物-项目选题报告.md
│   ├── 产物-需求分析报告.md
│   ├── 产物-概要设计.md
│   └── 研发/
│       └── tech-design.md
├── README.md
└── package.json
```

说明：

- 第一阶段可以直接把 H5 文件放在 `app/src/main/assets/` 中，减少构建链路。
- 如果后续需要独立调试 H5，可以再增加 `web/` 目录，并在打包前同步到 Android assets。
- 当前不引入前端框架，优先使用原生 HTML、CSS、JavaScript 和 Canvas。

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

统计数组固定为 256 个元素：

```js
const bins = new Array(256).fill(0);
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

直方图 Canvas 固定为：

```text
width = 256
height = 100
```

绘制规则：

- 先清空画布。
- 背景使用白色。
- 每个灰度值对应一个 x 坐标。
- 每列高度来自 `normalized[x]`。
- 黑色从底部向上绘制。

## 8. 耗时记录设计

第一阶段只记录主流程耗时，不展开性能优化方案。

建议计时边界：

```text
draw image to source canvas
-> getImageData
-> grayscale calculation
-> 256-bin counting
-> normalization
-> draw histogram
```

计时代码位置：

```text
start = performance.now()
执行主流程
end = performance.now()
elapsedMs = end - start
```

注意：

- 不只记录绘图耗时。
- 不隐藏像素读取和统计耗时。
- 后续性能优化文档再讨论对比方式和优化策略。

## 9. 异常处理

| 场景 | 处理 |
| --- | --- |
| 用户取消选择 | 保持当前页面状态，提示“未选择图片” |
| 文件不是图片 | 提示“请选择图片文件” |
| 图片加载失败 | 提示“图片读取失败，请重新选择” |
| Canvas 读取失败 | 提示“图像处理失败，请重试” |
| 图片过大导致耗时较长 | 正常展示结果和耗时，后续在性能记录中说明 |

## 10. 初始验收检查

第一阶段完成后，至少应检查：

| 检查项 | 预期 |
| --- | --- |
| APK 可打开 | 能进入 H5 主界面 |
| 离线可用 | 无网络时页面能加载 |
| 图片可选择 | 能从手机本地选择图片 |
| 图片可预览 | 选图后能看到原图 |
| 公式正确 | 使用指定灰度化公式 |
| bin 数正确 | 统计数组长度为 256 |
| 尺寸正确 | 直方图源 Canvas 为 `256x100` |
| 耗时可见 | 页面展示本次生成耗时 |

## 11. 后续独立文档

以下内容后续单独成文，不写入主流程技术设计：

- 性能优化记录。
- 不同图片尺寸的耗时测试表。
- 优化前后对比。
- 测试计划和测试报告。
- 使用说明和答辩演示脚本。

## 12. 小结

本技术设计将系统实现拆分为 Android 壳层和 H5 Canvas 功能层。Android 层负责 APK、WebView 和本地图片选择；H5 层负责主流程图像处理与展示。第一阶段的研发重点是把主流程做稳定、做正确、做可验收，性能优化后续单独推进。
