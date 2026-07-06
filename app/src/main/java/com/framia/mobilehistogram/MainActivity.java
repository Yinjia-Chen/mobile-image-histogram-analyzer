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

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        configureWebView(webView);
        setContentView(webView);
        webView.loadUrl(BuildConfig.LOCAL_ENTRY_URL);
    }

    private void configureWebView(WebView view) {
        view.setBackgroundColor(Color.rgb(5, 11, 10));

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        view.addJavascriptInterface(new HistogramSaveBridge(), "AndroidHistogramBridge");
        view.setWebViewClient(new WebViewClient());
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                MainActivity.this.openImageChooser(filePathCallback);
                return true;
            }
        });
    }

    private class HistogramSaveBridge {
        @JavascriptInterface
        public void saveCompositeImage(String base64Png, String displayName) {
            try {
                byte[] imageBytes = Base64.decode(base64Png, Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, sanitizeDisplayName(displayName));
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MobileHistogram");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }

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

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues completedValues = new ContentValues();
                    completedValues.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContentResolver().update(imageUri, completedValues, null, null);
                }

                showToast("拼接图已保存到系统图片库");
            } catch (Exception error) {
                showToast("保存失败：" + error.getMessage());
            }
        }
    }

    private String sanitizeDisplayName(String displayName) {
        String fallback = "histogram-analysis-" + System.currentTimeMillis() + ".png";
        if (displayName == null || displayName.trim().isEmpty()) {
            return fallback;
        }
        return displayName.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private void showToast(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
    }

    private void openImageChooser(ValueCallback<Uri[]> callback) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
        }
        filePathCallback = callback;

        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");

        Intent chooser = Intent.createChooser(intent, "选择图片");
        startActivityForResult(chooser, FILE_CHOOSER_REQUEST_CODE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != FILE_CHOOSER_REQUEST_CODE || filePathCallback == null) {
            return;
        }

        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }

        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
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
