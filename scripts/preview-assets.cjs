const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const assetDir = path.join(root, "app", "src", "main", "assets");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(response, statusCode, body, headers) {
  response.writeHead(statusCode, headers || {});
  response.end(body);
}

function resolveAssetPath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const absolutePath = path.normalize(path.join(assetDir, pathname));

  if (!absolutePath.startsWith(assetDir)) {
    return null;
  }
  return absolutePath;
}

const server = http.createServer((request, response) => {
  const filePath = resolveAssetPath(request.url);
  if (!filePath) {
    send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(response, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    send(response, 200, content, {
      "cache-control": "no-store",
      "content-type": contentType
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Preview server: http://127.0.0.1:${port}`);
  console.log(`Optimized app:   http://127.0.0.1:${port}/index.html`);
  console.log(`Baseline app:    http://127.0.0.1:${port}/index-baseline.html`);
});
