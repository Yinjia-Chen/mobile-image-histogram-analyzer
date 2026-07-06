# 第 4 阶段 APK 打包交付记录

## 1. 打包目标

第 4 阶段目标是生成可安装测试的 Android APK，供手机端安装验证。

本次打包仍保持项目核心范围：

- Android WebView 壳 App；
- 本地 H5 Canvas 页面；
- 本地图片选择；
- 灰度直方图生成；
- `256x100` 黑白直方图；
- 生成耗时展示；
- 无后端、无数据库、无网络依赖。

## 2. 打包前验证

执行命令：

```bash
npm run test:histogram
npm run test:offline
npm run harness:verify
```

结果：

```text
Histogram algorithm fixture passed.
Histogram main-flow fixture passed.
Offline asset checks passed.
Harness verification passed.
```

## 3. APK 构建命令

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/framia/Library/Android/sdk" \
./gradlew --offline assembleDebug
```

执行结果：`BUILD SUCCESSFUL`。

## 4. APK 信息

| 项目 | 内容 |
| --- | --- |
| APK 路径 | `dist/mobile-histogram-stage4-debug.apk` |
| 构建产物源路径 | `app/build/outputs/apk/debug/app-debug.apk` |
| 包名 | `com.framia.mobilehistogram` |
| versionName | `0.1.0` |
| minSdk | `23` |
| targetSdk | `36` |
| APK 大小 | 19 KB |
| SHA256 | `7e4b0a02716f9a7de31475d2c77c8e9675d65bddcdf99ee2aa9bb83a14a64196` |

## 5. APK 内容检查

`unzip -l dist/mobile-histogram-stage4-debug.apk` 显示 APK 内包含：

```text
assets/app.js
assets/index.html
assets/style.css
AndroidManifest.xml
classes.dex
classes2.dex
resources.arsc
```

`aapt dump badging dist/mobile-histogram-stage4-debug.apk` 显示：

```text
package: name='com.framia.mobilehistogram' versionCode='1' versionName='0.1.0'
launchable-activity: name='com.framia.mobilehistogram.MainActivity'
application-label:'移动端图像直方图分析系统'
```

## 6. 安装验证状态

用户已反馈第 3 阶段断网测试通过。

本阶段安装验证由用户使用本次 APK 在手机上执行，待回填的信息包括：

- 手机型号；
- Android 版本；
- 是否可安装；
- 是否可断网启动；
- 是否可选择本地图片；
- 是否显示原图预览、直方图和耗时；
- 测试图片尺寸；
- 处理耗时；
- 截图或问题记录。

在用户回填安装结果前，T-24 暂不标记为 `done`。
