// NeatReader 云端书库所需的网络能力。
// 渲染进程在生产构建下开启 webSecurity，直接请求 www.neat-reader.cn 与阿里云 OSS
// 会被 CORS 拦截，因此所有 HTTP 请求都放在主进程里完成（net 模块同时自动走用户代理配置）。
const fs = require("fs");
const path = require("path");
const { app, net } = require("electron");

const DEFAULT_TIMEOUT = 30000;
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;
const MAX_RESPONSE_SIZE = 32 * 1024 * 1024;
const NEATREADER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NeatReaderClient";

const normalizeUrl = (value) => {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (error) {
    return null;
  }
};

// 统一发起请求并收集响应体，返回 { status, headers, body }
const sendRequest = (options = {}) =>
  new Promise((resolve, reject) => {
    const url = normalizeUrl(options.url);
    if (!url) {
      reject(new TypeError("Invalid NeatReader request url"));
      return;
    }
    const method = options.method === "GET" ? "GET" : "POST";
    const request = net.request({ method, url, redirect: "follow" });
    request.setHeader("User-Agent", NEATREADER_USER_AGENT);
    const headers = options.headers || {};
    for (const key of Object.keys(headers)) {
      if (typeof headers[key] === "string") {
        request.setHeader(key, headers[key]);
      }
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch (error) {
        // ignore
      }
      finish(reject, new Error("NeatReader request timeout"));
    }, options.timeout || DEFAULT_TIMEOUT);

    request.on("response", (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_SIZE) {
          try {
            request.abort();
          } catch (error) {
            // ignore
          }
          finish(reject, new Error("NeatReader response is too large"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        finish(resolve, {
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
      response.on("error", (error) => finish(reject, error));
    });
    request.on("error", (error) => finish(reject, error));

    if (method === "POST" && typeof options.body === "string" && options.body) {
      request.write(options.body);
    }
    request.end();
  });

const ensureDownloadDir = () => {
  const dir = path.join(app.getPath("temp"), "neatreader-download");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const safeExtension = (fileName) => {
  const ext = path.extname(typeof fileName === "string" ? fileName : "");
  return /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : "";
};

// 下载二进制资源到临时目录，返回临时文件路径供渲染进程读取后入库
const downloadToTempFile = (options = {}) =>
  new Promise((resolve, reject) => {
    const url = normalizeUrl(options.url);
    if (!url) {
      reject(new TypeError("Invalid NeatReader download url"));
      return;
    }
    const dir = ensureDownloadDir();
    const target = path.join(
      dir,
      `nr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExtension(
        options.fileName
      )}`
    );
    const request = net.request({ method: "GET", url, redirect: "follow" });
    request.setHeader("User-Agent", NEATREADER_USER_AGENT);

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch (error) {
        // ignore
      }
      finish(reject, new Error("NeatReader download timeout"));
    }, options.timeout || DOWNLOAD_TIMEOUT);

    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.on("data", () => {});
        response.on("end", () => {
          finish(reject, new Error(`Download failed: HTTP ${response.statusCode}`));
        });
        return;
      }
      const fileStream = fs.createWriteStream(target);
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
      });
      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(() => {
          finish(resolve, { path: target, size });
        });
      });
      fileStream.on("error", (error) => {
        finish(reject, error);
      });
      response.on("error", (error) => {
        finish(reject, error);
      });
    });
    request.on("error", (error) => finish(reject, error));
    request.end();
  });

const requestJson = async (options = {}) => {
  const response = await sendRequest(options);
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    data: response.body.toString("utf8"),
  };
};

module.exports = {
  sendRequest,
  requestJson,
  downloadToTempFile,
};
