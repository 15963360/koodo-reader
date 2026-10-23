// AnkiConnect 代理。
// 生产构建下渲染进程开启 webSecurity，AnkiConnect 默认只对白名单 Origin 返回 CORS 头，
// 直接从 file:// 页面请求会被浏览器拦截，因此把请求放到主进程里用 net 模块转发。
// 只允许本机回环地址，避免该 IPC 被用作任意网络代理。
const { net } = require("electron");

const DEFAULT_TIMEOUT = 30000;
const MAX_RESPONSE_SIZE = 8 * 1024 * 1024;
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"];

const normalizeUrl = (value) => {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return null;
    return parsed.toString();
  } catch (error) {
    return null;
  }
};

const postJson = (options = {}) =>
  new Promise((resolve, reject) => {
    const url = normalizeUrl(options.url);
    if (!url) {
      reject(new TypeError("Invalid AnkiConnect url"));
      return;
    }
    const request = net.request({ method: "POST", url });
    request.setHeader("Content-Type", "application/json");
    request.setHeader("Accept", "application/json");

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
      finish(reject, new Error("AnkiConnect request timeout"));
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
          finish(reject, new Error("AnkiConnect response is too large"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        finish(resolve, {
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          data: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", (error) => finish(reject, error));
    });
    request.on("error", (error) => finish(reject, error));

    request.write(
      typeof options.body === "string" ? options.body : JSON.stringify(options.body || {})
    );
    request.end();
  });

module.exports = {
  postJson,
};
