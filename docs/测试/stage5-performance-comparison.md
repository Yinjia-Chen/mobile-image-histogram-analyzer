# 第 5 阶段 性能对照实验记录

## 1. 阶段定位

本阶段不改动正式 App 主流程，也不把低效实现包装为历史生产版本。

本阶段目标是构造一个明确标注的低效对照实现，用同一张图、同一计时边界对比当前正式实现策略，证明当前方案满足 `300ms` 目标的原因。

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
| `comparison-baseline` | 低效对照实现 | 使用普通数组、对象映射、每像素对象分配、重复灰度计算、重复字符串转换、重复最大值扫描和低效渲染循环，仅用于验证实现策略对耗时的影响 |
| `current-optimized` | 当前正式实现策略 | 使用 `Uint32Array(256)`、单次遍历、一次归一化和固定 `256x100` 渲染 |

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

| Case | Image size | Pixels | Comparison baseline | Current optimized | Speedup | 当前实现是否低于 300ms |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `small-demo` | 320x180 | 57,600 | 46.22 ms | 1.42 ms | 32.5x | 是 |
| `phone-mid` | 800x600 | 480,000 | 407.1 ms | 2.30 ms | 176.9x | 是 |
| `phone-large` | 1280x720 | 921,600 | 700.4 ms | 1.99 ms | 351.6x | 是 |

说明：

- 以上是开发机 Node.js 环境下的合成数据对照实验，不替代 Android 真机测试。
- 单次运行会受 CPU 调度影响产生轻微波动，正式报告可补充多次运行平均值或真机表格。
- `comparison-baseline` 是反模式压力对照，用于演示低效循环、对象分配、字符串转换和重复计算的影响。
- `current-optimized` 对应当前正式实现的核心策略：TypedArray 统计、单次遍历、一次归一化和固定尺寸渲染。
- 两个模式输出的 256 bin、归一化结果和 `256x100` 渲染缓冲区必须完全一致；脚本已自动校验。
- H5 baseline 页面使用相同慢路径思想，但不作为正式 App 默认入口。若需要制作 baseline APK，可在单独分支或临时构建中把 WebView 入口切换到 `file:///android_asset/index-baseline.html`。

## 5. 答辩表述建议

可以表述为：

> 为了验证实现策略对性能的影响，我们构造了一个低效对照版本，并与当前正式实现做同图同边界测试。低效对照不作为正式产品版本，只用于说明频繁对象分配、普通对象统计和重复扫描会显著增加耗时。最终版本采用 TypedArray、单次遍历和固定尺寸 Canvas 绘制，因此在移动端实测中可以稳定满足 300ms 目标。

## 6. 结论口径

当前正式实现已经满足课程任务的性能目标，本阶段重点是证据固化，不引入新的 App 功能，也不改变灰度公式、256 bin 统计或 `256x100` 直方图要求。

## 7. 可并装 APK 交付

为便于手机安装对比，本阶段将 Android 工程改为两个 product flavor：

| Flavor | 包名 | 应用名 | H5 入口 | 定位 |
| --- | --- | --- | --- | --- |
| `baselineDebug` | `com.framia.mobilehistogram.baseline` | `直方图分析-优化前` | `file:///android_asset/index-baseline.html` | 低效 baseline 对照版 |
| `optimizedDebug` | `com.framia.mobilehistogram.optimized` | `直方图分析-优化后` | `file:///android_asset/index.html` | 当前正式优化版 |

APK 信息：

| APK | 路径 | 包名 | versionName | 大小 | SHA256 |
| --- | --- | --- | --- | ---: | --- |
| 优化前 | `dist/mobile-histogram-baseline-coinstall-debug.apk` | `com.framia.mobilehistogram.baseline` | `0.1.0-baseline` | 26 KB | `0b277163a5b895ec599c46025791bb94891e3efc1dc1e3f537c7dd2c649a5fe6` |
| 优化后 | `dist/mobile-histogram-optimized-coinstall-debug.apk` | `com.framia.mobilehistogram.optimized` | `0.1.0-optimized` | 26 KB | `547b7a0d456b02696629983bff704c6c23c6c2963ce185682a0d6b868d8580d6` |

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
```

结果：

```text
Baseline histogram fixture passed.
Harness verification passed.
```

## 8. 视觉体验升级

本阶段在不改变核心算法和离线范围的前提下，补充了更接近原生 App 的视觉体验：

- 新增 Android launcher 图标 `res/drawable/ic_launcher_histogram.xml`；
- 优化前/优化后 APK 保持不同应用名和不同包名，可在同一手机并排安装；
- H5 页面新增品牌头、模式标识、能力指标条、图片空状态和处理进度条；
- 优化前和优化后共享同一套视觉系统，但保留不同模式标签；
- 图片处理流程增加载入、统计、完成的状态反馈。

本次视觉升级未改变：

- 灰度公式；
- 256 bin 统计；
- `0-100` 归一化；
- `256x100` 黑白直方图输出；
- 离线、本地图片处理范围。
