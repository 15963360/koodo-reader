import axios from "axios";
import CryptoJS from "crypto-js";
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

declare var window: any;

/** NeatReader 官方 API 基址（与 web 端 app/api_v2 保持一致） */
export const NEATREADER_API_BASE = "https://www.neat-reader.cn/app/api_v2/";
/** 云端书籍封面的公开直连地址（guid-cover），作为兜底方案 */
export const NEATREADER_COVER_HOST =
  "https://neat-reader-cn.oss-cn-hangzhou.aliyuncs.com";

const SESSION_CONFIG_KEY = "neatreaderConfig";
const SESSION_CONFIG_SCOPE = "thirdpartyToken";
const DEVICE_ID_CONFIG_KEY = "neatreaderDeviceId";

export interface NeatReaderSession {
  token: string;
  deviceId: string;
  userName?: string;
  loginTime?: number;
}

export interface NeatReaderCloudBook {
  guid: string;
  bookName: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  md5?: string;
  addTime?: number;
  ossAddress?: string;
  bookCover?: string;
}

export interface NeatReaderCloudBookList {
  code: number;
  msg?: string;
  bookList: NeatReaderCloudBook[];
  cloudSize?: number;
  cloudBookNum?: number;
}

export interface NeatReaderSts {
  Region: string;
  AccessKeyId: string;
  AccessKeySecret: string;
  SecurityToken: string;
  BucketName: string;
}

const generateDeviceId = () => {
  try {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch (error) {
    // ignore
  }
  const random = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return (
    random() +
    random() +
    "-" +
    random() +
    "-" +
    random() +
    "-" +
    random() +
    "-" +
    random() +
    random() +
    random()
  );
};

export const getDeviceId = (): string => {
  let deviceId = ConfigService.getReaderConfig(DEVICE_ID_CONFIG_KEY);
  if (!deviceId) {
    deviceId = generateDeviceId();
    ConfigService.setReaderConfig(DEVICE_ID_CONFIG_KEY, deviceId);
  }
  return deviceId;
};

const toFormBody = (payload: Record<string, any>) => {
  const params = new URLSearchParams();
  Object.keys(payload).forEach((key) => {
    const value = payload[key];
    if (value === undefined || value === null) return;
    params.append(key, String(value));
  });
  return params.toString();
};

/**
 * 调用 NeatReader 官方接口。
 * Electron 下必须经主进程转发，生产构建的 webSecurity 会拦截跨域请求。
 */
export const neatRequest = async <T = any>(
  endpoint: string,
  payload: Record<string, any>
): Promise<T> => {
  const url = NEATREADER_API_BASE + endpoint;
  const body = toFormBody(payload);
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
  let text = "";
  if (isElectron && window.electronAPI?.invoke) {
    const result = await window.electronAPI.invoke("neatreader-request", {
      url,
      method: "POST",
      headers,
      body,
      timeout: 30000,
    });
    if (!result?.ok) {
      throw new Error(
        `NeatReader 服务返回异常（HTTP ${result?.status || "unknown"}）`
      );
    }
    text = result.data || "";
  } else {
    const response = await axios.post(url, body, {
      headers,
      timeout: 30000,
    });
    text = response.data;
  }
  if (typeof text === "object" && text !== null) {
    return text as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error("NeatReader 返回内容无法解析：" + String(text).slice(0, 120));
  }
};

export const getSession = (): NeatReaderSession | null => {
  const session = ConfigService.getObjectConfig(
    SESSION_CONFIG_KEY,
    SESSION_CONFIG_SCOPE,
    {}
  ) as NeatReaderSession;
  if (session && session.token && session.deviceId) {
    return session;
  }
  return null;
};

export const saveSession = (session: NeatReaderSession) => {
  ConfigService.setObjectConfig(
    SESSION_CONFIG_KEY,
    session,
    SESSION_CONFIG_SCOPE
  );
};

export const clearSession = () => {
  ConfigService.setObjectConfig(SESSION_CONFIG_KEY, {}, SESSION_CONFIG_SCOPE);
};

const loginErrorMessage = (code: number, msg?: string) => {
  if (code === -1) return "账号不存在";
  if (code === -2) return "密码错误";
  if (code === -999) return "登录凭据失效，请重新登录";
  return msg || "NeatReader 登录失败（错误码 " + code + "）";
};

/** 账号密码登录：官方接口使用 username + md5(password) + deviceId */
export const loginWithPassword = async (
  userName: string,
  password: string
): Promise<NeatReaderSession> => {
  const deviceId = getDeviceId();
  const result = await neatRequest<{
    code: number;
    msg?: string;
    token?: string;
  }>("login", {
    username: userName,
    password: CryptoJS.MD5(password).toString(),
    deviceId,
    deviceType: "web-desk",
    deviceInfo: JSON.stringify({
      userAgent: navigator.userAgent,
      language: navigator.language,
      vendor: navigator.vendor,
    }),
  });
  if (!result || !(result.code > 0) || !result.token) {
    throw new Error(
      loginErrorMessage(result?.code ?? 0, result?.msg) || "登录失败"
    );
  }
  const session: NeatReaderSession = {
    token: result.token,
    deviceId,
    userName,
    loginTime: Date.now(),
  };
  saveSession(session);
  return session;
};

/** Token 登录：沿用 NeatReader web 端 cookie 中的 token */
export const loginWithToken = async (
  token: string,
  userName?: string
): Promise<NeatReaderSession> => {
  const deviceId = getDeviceId();
  const result = await neatRequest<{ code: number; msg?: string }>(
    "getUserProfile",
    { token, deviceId }
  );
  if (!result || !(result.code > 0)) {
    throw new Error(
      loginErrorMessage(result?.code ?? 0, result?.msg) ||
        "Token 校验失败，请改用账号密码登录"
    );
  }
  const session: NeatReaderSession = {
    token,
    deviceId,
    userName: userName || (result as any).userName || "NeatReader",
    loginTime: Date.now(),
  };
  saveSession(session);
  return session;
};

export const getUserProfile = async (session?: NeatReaderSession) => {
  const current = session || getSession();
  if (!current) throw new Error("尚未登录 NeatReader");
  return await neatRequest<any>("getUserProfile", {
    token: current.token,
    deviceId: current.deviceId,
  });
};

/** 拉取云端藏书（fileType 123456 与官方 web 端保持一致：全部类型） */
export const getCloudBookList = async (): Promise<NeatReaderCloudBookList> => {
  const session = getSession();
  if (!session) throw new Error("尚未登录 NeatReader");
  const result = await neatRequest<NeatReaderCloudBookList>("getCloudBookList", {
    token: session.token,
    deviceId: session.deviceId,
    fileType: 123456,
  });
  if (!result || !(result.code > 0)) {
    throw new Error(
      loginErrorMessage(result?.code ?? 0, result?.msg) || "获取云端书单失败"
    );
  }
  return {
    ...result,
    bookList: Array.isArray(result.bookList) ? result.bookList : [],
  };
};

let cachedSts: { value: NeatReaderSts; time: number } | null = null;

/** 获取阿里云 OSS 临时凭据（STS），缓存 50 分钟 */
export const getOssSts = async (force = false): Promise<NeatReaderSts> => {
  if (
    !force &&
    cachedSts &&
    Date.now() - cachedSts.time < 50 * 60 * 1000
  ) {
    return cachedSts.value;
  }
  const session = getSession();
  if (!session) throw new Error("尚未登录 NeatReader");
  const result = await neatRequest<NeatReaderSts & { code?: number; msg?: string }>(
    "ossSignSTS",
    { token: session.token, deviceId: session.deviceId }
  );
  if (!result || !result.Region || !result.AccessKeyId) {
    throw new Error(result?.msg || "获取阿里云 OSS 临时凭据失败");
  }
  cachedSts = { value: result, time: Date.now() };
  return result;
};

/** 用 STS 凭据对 OSS 对象生成带签名的直连地址（V1 签名） */
export const getSignedOssUrl = (
  key: string,
  sts: NeatReaderSts,
  expiresIn = 3600
) => {
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const stringToSign = `GET\n\n\n${expires}\n/${sts.BucketName}/${key}`;
  const signature = CryptoJS.HmacSHA1(
    stringToSign,
    sts.AccessKeySecret
  ).toString(CryptoJS.enc.Base64);
  const params = new URLSearchParams({
    OSSAccessKeyId: sts.AccessKeyId,
    Expires: String(expires),
    Signature: signature,
  });
  if (sts.SecurityToken) {
    params.append("security-token", sts.SecurityToken);
  }
  return `https://${sts.BucketName}.${
    sts.Region
  }.aliyuncs.com/${encodeURIComponent(key)}?${params.toString()}`;
};

export interface DownloadedBinary {
  buffer: ArrayBuffer;
  tempPath?: string;
  size: number;
}

const readTempFile = async (filePath: string): Promise<ArrayBuffer> => {
  const data = await window.electronAPI.fs.promises.readFile(filePath);
  const view =
    data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer;
};

/** 下载任意二进制资源；Electron 下走主进程落盘再读取，避免 CORS。 */
export const downloadBinary = async (
  url: string,
  fileName: string
): Promise<DownloadedBinary> => {
  if (isElectron && window.electronAPI?.invoke) {
    const result = await window.electronAPI.invoke("neatreader-download", {
      url,
      fileName,
    });
    if (!result?.path) {
      throw new Error("下载失败：未取得临时文件");
    }
    const buffer = await readTempFile(result.path);
    return { buffer, tempPath: result.path, size: result.size || buffer.byteLength };
  }
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 10 * 60 * 1000,
  });
  const buffer = response.data as ArrayBuffer;
  return { buffer, size: buffer.byteLength };
};

export const cleanupTempFile = (filePath?: string) => {
  if (!filePath || !isElectron) return;
  try {
    window.electronAPI.fs.unlinkSync(filePath);
  } catch (error) {
    // 临时文件清理失败不影响主流程
  }
};

const withCacheBuster = (url: string) => {
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + Date.now();
};

/** 下载云端原书：优先使用书单里的已签名 ossAddress，失效时回退 STS 签名。 */
export const downloadCloudBook = async (
  book: NeatReaderCloudBook
): Promise<DownloadedBinary> => {
  const fileName = book.fileName || book.bookName || book.guid;
  if (book.ossAddress) {
    try {
      return await downloadBinary(withCacheBuster(book.ossAddress), fileName);
    } catch (error) {
      console.warn("[neatreader] ossAddress download failed, retry with STS");
    }
  }
  const sts = await getOssSts();
  const signedUrl = getSignedOssUrl(book.guid, sts);
  return await downloadBinary(signedUrl, fileName);
};

const IMAGE_SIGNATURES: { type: string; test: (bytes: Uint8Array) => boolean }[] =
  [
    {
      type: "jpeg",
      test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
      type: "png",
      test: (b) =>
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    },
    {
      type: "gif",
      test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
    },
    {
      type: "webp",
      test: (b) =>
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50,
    },
  ];

const bufferToDataUrl = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let type = "";
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.test(bytes)) {
      type = signature.type;
      break;
    }
  }
  if (!type) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)) as any
    );
  }
  return `data:image/${type};base64,${window.btoa(binary)}`;
};

/** 下载封面并转成 data URL，失败时返回空字符串（不阻断入库）。 */
export const downloadCloudCover = async (
  book: NeatReaderCloudBook
): Promise<string> => {
  const candidates = [
    book.bookCover,
    `${NEATREADER_COVER_HOST}/${book.guid}-cover`,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const url = candidate.startsWith("http")
        ? candidate.replace(/^http:/, "https:")
        : candidate;
      const { buffer, tempPath } = await downloadBinary(
        withCacheBuster(url),
        `${book.guid}-cover`
      );
      const dataUrl = bufferToDataUrl(buffer);
      cleanupTempFile(tempPath);
      if (dataUrl) return dataUrl;
    } catch (error) {
      console.warn("[neatreader] cover download failed", candidate, error);
    }
  }
  return "";
};

export const formatCloudSize = (size?: number) => {
  if (!size || size <= 0) return "0 MB";
  const mb = size / 1024 / 1024;
  if (mb >= 1024) {
    return (mb / 1024).toFixed(2) + " GB";
  }
  if (mb >= 1) {
    return mb.toFixed(1) + " MB";
  }
  return Math.max(1, Math.round(size / 1024)) + " KB";
};
