# 第 3 阶段算法测试与离线自测证据

## 1. 本阶段目标

本阶段补充算法测试和离线自测证据，重点证明：

- 灰度公式、256 bin、归一化和 `256x100` 绘制规则可被确定性测试验证；
- H5 主流程可以在本地资源环境下加载；
- APK 中包含本地 H5 资源，且核心 assets 不依赖远程 URL、`fetch()` 或网络接口；
- 真机断网安装运行仍需要手机测试结果补充。

## 2. 新增测试脚本

| 脚本 | 覆盖范围 |
| --- | --- |
| `scripts/test-histogram-algorithm.cjs` | 灰度公式、取整规则、256 bin 总数、归一化、`256x100` 绘制规则 |
| `scripts/test-histogram-main-flow.cjs` | 使用 fake Canvas 跑 `generateHistogram` 主流程，验证绘图、像素读取、统计、归一化、绘制和耗时返回 |
| `scripts/test-offline-assets.cjs` | 检查 H5 assets 无远程依赖、Android WebView 加载本地 asset、文件选择桥接、APK 内包含本地资源 |

## 3. 验证命令与结果

```bash
npm run test:histogram
npm run test:offline
npm run harness:verify
```

执行结果：

```text
Histogram algorithm fixture passed.
Histogram main-flow fixture passed.
Offline asset checks passed.
Harness verification passed.
```

`npm run harness:verify` 已纳入：

- `npm run harness:check-docs`；
- `npm run test:histogram`；
- `npm run test:offline`；
- Android assets 远程资源扫描。

## 4. 离线资源检查

`scripts/test-offline-assets.cjs` 验证以下条件：

- `index.html` 引用本地 `style.css` 和 `app.js`；
- H5 页面包含 `type="file"` 与 `accept="image/*"`；
- 直方图 Canvas 源尺寸声明为 `256x100`；
- `MainActivity` 加载 `file:///android_asset/index.html`；
- `MainActivity` 使用 `WebChromeClient.onShowFileChooser` 打通本地图片选择；
- Android Manifest 未申请 `android.permission.INTERNET`；
- `dist/mobile-histogram-stage2-debug.apk` 内包含：

```text
assets/index.html
assets/style.css
assets/app.js
```

## 5. 本地 H5 加载截图

由于浏览器自动化环境禁止直接访问 `file://` 本地路径，本次使用只绑定本机的临时静态服务加载同一组 H5 assets，并确认页面首屏可正常渲染。

截图文件：

```text
docs/测试人员/stage3-local-h5-load.png
```

截图显示内容包括：

- 页面标题“移动端图像直方图分析系统”；
- 原图预览区域；
- 本地图片选择入口；
- 直方图工作区的初始页面结构。

## 6. 当前限制与后续动作

当前证据覆盖源码级算法测试、本地 H5 资源加载和 APK 资源离线边界检查。

仍需补充的真机证据：

- 在 Android 手机上安装 `dist/mobile-histogram-stage2-debug.apk`；
- 关闭网络或保持无网络环境打开应用；
- 选择本地图片；
- 确认原图预览、`256x100` 直方图和耗时显示；
- 记录设备型号、Android 版本、图片尺寸、耗时和截图。

因此 T-21 暂不标记为 `done`，等待手机实测结果补齐。
