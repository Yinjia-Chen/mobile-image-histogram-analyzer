# 第 1 阶段 APK 构建证据

## 1. 构建目标

第 1 阶段目标是完成 Android WebView 最小 APK：

- T-10 Android 项目骨架搭建；
- T-11 WebView 本地页面加载；
- APK 内置本地 H5 页面 `file:///android_asset/index.html`；
- 不引入后端、数据库、登录、云上传或网络依赖。

## 2. 构建命令

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/framia/Library/Android/sdk" \
./gradlew --offline assembleDebug
```

执行结果：`BUILD SUCCESSFUL`。

## 3. APK 信息

| 项目 | 内容 |
| --- | --- |
| APK 路径 | `dist/mobile-histogram-stage1-debug.apk` |
| 构建产物源路径 | `app/build/outputs/apk/debug/app-debug.apk` |
| 包名 | `com.framia.mobilehistogram` |
| versionName | `0.1.0` |
| minSdk | `23` |
| targetSdk | `36` |
| APK 大小 | 13 KB |
| SHA256 | `1673375d275aa76c02fa95ec8482c2a101a803d99d4a6ff87ce74a9f6f51dc19` |

## 4. 本地资源证据

`unzip -l dist/mobile-histogram-stage1-debug.apk` 显示 APK 内包含：

```text
assets/index.html
AndroidManifest.xml
classes.dex
classes2.dex
resources.arsc
```

`aapt dump badging dist/mobile-histogram-stage1-debug.apk` 显示：

```text
package: name='com.framia.mobilehistogram' versionCode='1' versionName='0.1.0'
launchable-activity: name='com.framia.mobilehistogram.MainActivity'
application-label:'移动端图像直方图分析系统'
```

## 5. 当前限制

- 本阶段 APK 是 debug 包，用于手机安装测试和最小 WebView 壳验证。
- 当前页面只验证本地 H5 加载，不包含图片选择、直方图算法和性能统计。
- 本机 `adb` 未连接到可用设备，因此真机安装、离线打开截图和安装验证需在手机测试后补充到 T-21/T-24。
