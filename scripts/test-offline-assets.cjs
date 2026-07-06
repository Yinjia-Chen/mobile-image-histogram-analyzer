const assert = require("assert");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const assetDir = path.join(root, "app", "src", "main", "assets");
const indexHtml = fs.readFileSync(path.join(assetDir, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(assetDir, "style.css"), "utf8");
const appJs = fs.readFileSync(path.join(assetDir, "app.js"), "utf8");
const mainActivity = fs.readFileSync(path.join(root, "app", "src", "main", "java", "com", "framia", "mobilehistogram", "MainActivity.java"), "utf8");

function assertNoRemoteDependency(name, content) {
  assert.ok(!/https?:\/\//.test(content), `${name} must not reference remote URLs`);
  assert.ok(!/\bfetch\s*\(/.test(content), `${name} must not call fetch()`);
  assert.ok(!/\bXMLHttpRequest\b/.test(content), `${name} must not use XMLHttpRequest`);
}

assertNoRemoteDependency("index.html", indexHtml);
assertNoRemoteDependency("style.css", styleCss);
assertNoRemoteDependency("app.js", appJs);

assert.ok(indexHtml.includes('href="style.css"'), "index.html must load bundled style.css");
assert.ok(indexHtml.includes('src="app.js"'), "index.html must load bundled app.js");
assert.ok(indexHtml.includes('type="file"'), "index.html must expose local file selection");
assert.ok(indexHtml.includes('accept="image/*"'), "file selection must accept local images");
assert.ok(indexHtml.includes('id="previewImage"'), "page must contain a preview image area");
assert.ok(indexHtml.includes('id="histogramCanvas"'), "page must contain histogram canvas");
assert.ok(indexHtml.includes('width="256"'), "histogram canvas must declare source width 256");
assert.ok(indexHtml.includes('height="100"'), "histogram canvas must declare source height 100");

assert.ok(mainActivity.includes("file:///android_asset/index.html"), "MainActivity must load the bundled asset URL");
assert.ok(mainActivity.includes("WebChromeClient"), "MainActivity must configure WebChromeClient for file selection");
assert.ok(mainActivity.includes("onShowFileChooser"), "MainActivity must bridge WebView file chooser");
assert.ok(mainActivity.includes('intent.setType("image/*")'), "Android file chooser must request local images");
assert.ok(!/android\.permission\.INTERNET/.test(fs.readFileSync(path.join(root, "app", "src", "main", "AndroidManifest.xml"), "utf8")), "manifest must not request internet permission");

const apkPath = path.join(root, "dist", "mobile-histogram-stage2-debug.apk");
if (fs.existsSync(apkPath)) {
  const listing = childProcess.execFileSync("unzip", ["-l", apkPath], { encoding: "utf8" });
  assert.ok(listing.includes("assets/index.html"), "stage2 APK must contain assets/index.html");
  assert.ok(listing.includes("assets/style.css"), "stage2 APK must contain assets/style.css");
  assert.ok(listing.includes("assets/app.js"), "stage2 APK must contain assets/app.js");
}

console.log("Offline asset checks passed.");
