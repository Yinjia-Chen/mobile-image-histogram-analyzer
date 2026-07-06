# 第 2 阶段 H5 直方图主流程证据

## 1. 实现范围

第 2 阶段完成 H5 Canvas 直方图主流程：

- T-12 H5 页面基础结构；
- T-13 本地图片选择与预览；
- T-14 Canvas 像素读取；
- T-15 灰度化计算；
- T-16 256 bin 直方图统计；
- T-17 0-100 归一化；
- T-18 256x100 黑白直方图绘制；
- T-19 生成耗时展示；
- T-20 异常提示与重新选择；
- T-22 算法准确性测试。

## 2. 关键源码

| 文件 | 说明 |
| --- | --- |
| `app/src/main/assets/index.html` | H5 页面结构，包含图片选择、预览、直方图、耗时和状态区域 |
| `app/src/main/assets/style.css` | 移动端页面样式 |
| `app/src/main/assets/app.js` | 图片加载、Canvas 像素读取、灰度统计、归一化、绘制和耗时逻辑 |
| `app/src/main/java/com/framia/mobilehistogram/MainActivity.java` | WebView 初始化和 Android 文件选择回调 |
| `scripts/test-histogram-algorithm.cjs` | 灰度公式、256 bin、归一化和绘制规则测试 |

## 3. 算法约定

灰度公式：

```text
gray = red * 0.299 + green * 0.587 + blue * 0.114
```

取整规则：

```text
grayBin = Math.round(gray)
```

边界处理：

```text
grayBin < 0   -> 0
grayBin > 255 -> 255
```

计时范围覆盖：

```text
draw image to source canvas
-> getImageData
-> grayscale calculation
-> 256-bin counting
-> normalization
-> draw 256x100 histogram
```

## 4. 验证命令

```bash
npm run test:histogram
npm run harness:verify
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/framia/Library/Android/sdk" \
./gradlew --offline assembleDebug
```

验证结果：

- `npm run test:histogram` 通过；
- `npm run harness:verify` 通过；
- `./gradlew --offline assembleDebug` 构建成功。

## 5. APK 信息

| 项目 | 内容 |
| --- | --- |
| APK 路径 | `dist/mobile-histogram-stage2-debug.apk` |
| 包名 | `com.framia.mobilehistogram` |
| versionName | `0.1.0` |
| APK 大小 | 19 KB |
| SHA256 | `7e4b0a02716f9a7de31475d2c77c8e9675d65bddcdf99ee2aa9bb83a14a64196` |

`unzip -l dist/mobile-histogram-stage2-debug.apk` 显示 APK 内包含：

```text
assets/app.js
assets/index.html
assets/style.css
AndroidManifest.xml
classes.dex
classes2.dex
resources.arsc
```

## 6. 当前限制

- 当前证据是源码测试和 APK 构建证据；真机安装、离线打开、选图和运行截图需在手机测试后补充到 T-21/T-24。
- 当前性能只在页面显示单次处理耗时，尚未形成设备、图片尺寸和多轮测试表，因此 T-23 仍保持 `todo`。
