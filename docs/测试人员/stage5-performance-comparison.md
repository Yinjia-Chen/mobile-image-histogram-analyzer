# 第 5 阶段 性能对照实验记录

## 1. 阶段定位

本阶段不改动正式 App 主流程，也不把低效实现包装为历史生产版本。

本阶段目标是构造一个明确标注的低效对照实现，用同一张图、同一计时边界对比当前正式实现策略，证明直方图生成耗时应控制在 300ms 以内的实现依据。

## 2. 对照口径

计时边界保持一致：

```text
RGBA 像素读取副本
-> 灰度计算
-> 256 bin 统计
-> 0-100 归一化
-> 256x100 渲染缓冲区生成
```

对照模式：

| 模式 | 定位 | 说明 |
| --- | --- | --- |
| `comparison-baseline` | 低效压力对照版本 | 使用普通数组、对象映射、每像素对象分配、重复灰度计算、重复字符串转换、重复最大值扫描和低效渲染循环，仅用于验证实现策略对耗时的影响 |
| `current-optimized` | 当前优化版本 | 使用 `Uint32Array(256)`、单次遍历、一次归一化和固定 `256x100` 渲染 |

两个模式必须输出一致的 256 bin、归一化结果和 `256x100` 渲染缓冲区，否则 benchmark 脚本会失败。

## 3. 运行方式

本阶段包含两个可运行对照：

- Node.js benchmark：用于快速生成表格数据；
- H5 baseline 页面：用于后续本地浏览器或 baseline APK 验证。

```bash
npm run benchmark:histogram
npm run test:baseline
```

相关文件：

- `scripts/benchmark-histogram-performance.cjs`
- `scripts/test-histogram-baseline.cjs`
- `app/src/main/assets/index-baseline.html`
- `app/src/main/assets/baseline-app.js`

## 4. 当前本机实验结果

测试环境：

| 项目 | 内容 |
| --- | --- |
| 设备 | 本机开发环境 |
| 系统 | macOS 26.4 |
| 架构 | arm64 |
| Node.js | v24.16.0 |
| 图像来源 | 脚本生成的确定性 RGBA 合成图 |
| baseline 压力设置 | 每像素重复灰度计算和字符串转换 160 次 |

执行命令：

```bash
npm run benchmark:histogram
```

执行结果：

| Case | Image size | Pixels | 低效对照版本 | 当前优化版本 | Speedup | 是否低于 300ms |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `small-demo` | 320x180 | 57,600 | 46.22 ms | 1.42 ms | 32.5x | 是 |
| `phone-mid` | 800x600 | 480,000 | 407.1 ms | 2.30 ms | 176.9x | 是 |
| `phone-large` | 1280x720 | 921,600 | 700.4 ms | 1.99 ms | 351.6x | 是 |

说明：

- 以上是开发机 Node.js 环境下的合成数据对照实验，不替代 Android 真机测试。
- 单次运行会受 CPU 调度影响产生轻微波动，正式报告可补充多次运行平均值或真机表格。
- 低效对照版本用于说明普通数组、对象分配、重复扫描等实现策略对性能的影响。
- 正式交付版本采用 typed array、单次遍历和固定 `256x100` 渲染。
- 两个模式输出的 256 bin、归一化结果和 `256x100` 渲染缓冲区必须完全一致；脚本已自动校验。
- H5 baseline 页面使用相同慢路径思想，但不作为正式 App 默认入口。若需要制作 baseline APK，可在单独分支或临时构建中把 WebView 入口切换到 `file:///android_asset/index-baseline.html`。

## 5. 答辩表述建议

可以表述为：

> 为了验证实现策略对性能的影响，我们构造了一个低效对照版本，并与当前优化版本做同图同边界测试。低效对照版本不作为真实开发早期版本，只用于说明频繁对象分配、普通对象统计和重复扫描会显著增加耗时。正式交付版本采用 typed array、单次遍历和固定 `256x100` 渲染，目标是让直方图生成耗时控制在 300ms 以内。

## 6. 结论口径

当前优化版本已经具备课程任务要求的性能说明证据，本阶段重点是证据固化，不引入新的 App 功能，也不改变灰度公式、256 bin 统计或 `256x100` 直方图要求。Android 真机端到端耗时仍需在最终测试报告中回填。

## 7. 可并装 APK 交付

为便于手机安装对比，本阶段将 Android 工程改为两个 product flavor：

| Flavor | 包名 | 应用名 | H5 入口 | 定位 |
| --- | --- | --- | --- | --- |
| `baselineDebug` | `com.framia.mobilehistogram.baseline` | 低效压力对照版本 | `file:///android_asset/index-baseline.html` | 低效压力对照版本 |
| `optimizedDebug` | `com.framia.mobilehistogram.optimized` | 正式演示版本 | `file:///android_asset/index.html` | 当前优化版本 |

APK 信息：

| APK | 路径 | 包名 | versionName | 大小 | SHA256 |
| --- | --- | --- | --- | ---: | --- |
| 低效压力对照版本 APK | `dist/mobile-histogram-baseline-coinstall-debug.apk` | `com.framia.mobilehistogram.baseline` | `0.1.0-baseline` | 81,403 bytes | `9eec188ad666628a0c07c0b9af85c0e39fd52f381a3de68601512be474b1af5b` |
| 正式演示版本 APK | `dist/mobile-histogram-optimized-coinstall-debug.apk` | `com.framia.mobilehistogram.optimized` | `0.1.0-optimized` | 76,433 bytes | `d4d95b605362e8cf28654e1e8f26d7e886eb84b18967078b7f1aef69ffb4ab70` |

APK 内包含：

```text
assets/index.html
assets/app.js
assets/index-baseline.html
assets/baseline-app.js
assets/style.css
```

入口检查：

```text
baseline APK dex: file:///android_asset/index-baseline.html
optimized APK dex: file:///android_asset/index.html
```

验证命令：

```bash
npm run test:baseline
npm run harness:verify
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew --offline assembleBaselineDebug assembleOptimizedDebug
```

结果：

```text
Baseline histogram fixture passed.
Harness verification passed.
BUILD SUCCESSFUL
```

## 8. 视觉体验升级

本阶段在不改变核心算法和离线范围的前提下，补充了更接近原生 App 的视觉体验：

- 新增 Android launcher 图标 `res/drawable/ic_launcher_histogram.xml`；
- 低效压力对照版本 APK 与正式演示版本 APK 保持不同包名和不同 launcher 右下角角标，可在同一手机并排安装；
- H5 页面新增品牌头、模式标识、图片空状态、开屏直方图波动动画、全屏生成进度条、完成 toast 和处理终端；
- H5 页面由单页瀑布改为 `接入 / 链路 / 输出 / 指标 / 协议 / 日志` 多视图跳转结构；
- 指标和协议卡片补充小字注释，用于解释灰度桶、最大计数、像素总数、公式、通道、归一化和输出画布含义；
- 指标页新增验收自检、`300ms` 性能余量和灰度分布规则结论，作为验收辅助与结果解释；
- 指标页新增结果一致性校验卡片，展示低效压力对照耗时、当前实现耗时、结果一致性和 bins 总数、像素总数、归一化结果、耗时对照检查；低效对照数据来自本阶段 benchmark 证据，不作为新的图像处理算法；
- 关键结果直方图支持点击横向全屏放大，长按保存“原图 + 分割说明 + 256x100 直方图”的拼接 PNG 到系统图片库；
- 移动端顶部增加 Android WebView 状态栏安全区，并压缩顶部控制台高度，避免状态栏遮挡首屏头部内容；
- 低效压力对照版本和正式演示版本共享同一套视觉系统，但保留不同模式标签；
- 图片处理流程增加载入、统计、完成的状态反馈。
- 2026-07-07 重新打包已包含 README/UI 收口、Histogram Compare、分层架构图、自然 loading 动画和 flavor 专属 launcher 角标。

本次视觉升级未改变：

- 灰度公式；
- 256 bin 统计；
- `0-100` 归一化；
- `256x100` 黑白直方图输出；
- 辅助指标仅从本次生成结果派生，不作为新的图像处理算法；
- 离线、本地图片处理范围。
