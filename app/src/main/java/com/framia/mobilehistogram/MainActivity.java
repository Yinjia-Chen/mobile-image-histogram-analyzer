package com.framia.mobilehistogram;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * 离线图像直方图分析系统的 Android 外壳。
 *
 * Java 层只负责 WebView、本地图片选择和图片保存桥；
 * 灰度公式、256 bins、归一化和 256x100 绘制都在 H5 层完成。
 */
public class MainActivity extends Activity {
    // 文件选择请求码：用于区分 H5 input[type=file] 触发的系统图片选择结果。
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;

    // 主 WebView：整个 APK 屏幕都由本地 H5 页面承载。
    private WebView webView;

    // 待回调文件选择器：Android 返回 Uri 后交还给 WebView。
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    /**
     * 生命周期入口：创建全屏 WebView，加载本地 assets 中的 H5 页面。
     */
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 使用代码创建 WebView，避免额外 XML 布局层影响全屏展示。
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 先完成 WebView 能力配置，再交给 Activity 显示并加载入口。
        configureWebView(webView);
        setContentView(webView);
        webView.loadUrl(BuildConfig.LOCAL_ENTRY_URL);
    }

    /**
     * 把 WebView 配置成本地 H5 运行环境。
     *
     * 允许 JavaScript 和本地/content Uri 访问，是因为必需流程是
     * “本地文件选择 -> H5 Canvas 处理”。这里不引入网络访问，
     * 离线边界由 assets 和验证脚本共同约束。
     */
    private void configureWebView(WebView view) {
        view.setBackgroundColor(Color.rgb(5, 11, 10));

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 暴露最小 JavaScript 桥，只允许 H5 保存用户确认后的拼接图。
        view.addJavascriptInterface(new HistogramSaveBridge(), "AndroidHistogramBridge");
        view.setWebViewClient(new WebViewClient());
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                // H5 文件输入统一转到 Android 系统图片选择器。
                MainActivity.this.openImageChooser(filePathCallback);
                return true;
            }
        });
    }

    /**
     * 很窄的 JavaScript 桥，只用于保存用户确认后的导出图片。
     *
     * 页面在用户点击确认保存后传入 PNG。Java 通过 MediaStore 写入，
     * 让结果出现在系统图片库中。
     */
    private class HistogramSaveBridge {
        @JavascriptInterface
        public void saveCompositeImage(String base64Png, String displayName) {
            try {
                // H5 传入的是去掉 data URL 头的 PNG base64，这里还原成字节。
                byte[] imageBytes = Base64.decode(base64Png, Base64.DEFAULT);

                // MediaStore 元数据决定图片在系统图片库中的名称、类型和目录。
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, sanitizeDisplayName(displayName));
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MobileHistogram");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }

                // 先创建媒体库记录，再打开输出流写入真实 PNG 内容。
                Uri imageUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (imageUri == null) {
                    throw new IllegalStateException("无法创建图片文件");
                }

                try (OutputStream outputStream = getContentResolver().openOutputStream(imageUri)) {
                    if (outputStream == null) {
                        throw new IllegalStateException("无法写入图片文件");
                    }
                    outputStream.write(imageBytes);
                }

                // Android Q+ 写入完成后取消 pending 状态，让图片正式可见。
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues completedValues = new ContentValues();
                    completedValues.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContentResolver().update(imageUri, completedValues, null, null);
                }

                showToast("拼接图已保存到系统图片库");
            } catch (Exception error) {
                // 保存失败直接反馈给用户，避免答辩演示时静默失败。
                showToast("保存失败：" + error.getMessage());
            }
        }
    }

    /**
     * 清洗生成文件名，保证它能被 Android 媒体库接受。
     */
    private String sanitizeDisplayName(String displayName) {
        String fallback = "histogram-analysis-" + System.currentTimeMillis() + ".png";
        if (displayName == null || displayName.trim().isEmpty()) {
            return fallback;
        }
        return displayName.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    /**
     * 桥回调不一定在 UI 线程，因此 Toast 通过 runOnUiThread 显示。
     */
    private void showToast(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
    }

    /**
     * 为 H5 文件输入打开 Android 系统图片选择器。
     *
     * 每个 callback 必须收到且只收到一次最终响应。如果旧选择器尚未返回，
     * 新选择器打开前会先取消旧 callback。
     */
    private void openImageChooser(ValueCallback<Uri[]> callback) {
        // WebView 要求每个旧 callback 都被结束，否则后续选择可能卡住。
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
        }
        filePathCallback = callback;

        // 使用系统 ACTION_GET_CONTENT，只选择本地可打开的图片文件。
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");

        Intent chooser = Intent.createChooser(intent, "选择图片");
        startActivityForResult(chooser, FILE_CHOOSER_REQUEST_CODE);
    }

    @Override
    /**
     * 文件选择结果回调：把 Android 返回的图片 Uri 交给 WebView 文件输入。
     */
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != FILE_CHOOSER_REQUEST_CODE || filePathCallback == null) {
            return;
        }

        // 取消选择时 result 保持 null，H5 会收到一次明确的取消结果。
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }

        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
    /**
     * 生命周期清理：取消未完成文件选择并销毁 WebView，避免资源泄漏。
     */
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
