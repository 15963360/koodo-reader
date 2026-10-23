import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";

declare var window: any;

// 本地 AnkiConnect 默认连接参数
export const ANKI_DEFAULT_HOST = "127.0.0.1";
export const ANKI_DEFAULT_PORT = "8765";
// 用户本地已存在的目标牌组与卡片模板（Luna 定制模板）
export const ANKI_DEFAULT_DECK = "SIN";
export const ANKI_MODEL_NAME = "modelofluna";
// dictionaryInfo / dictionaryContent 使用的词典标识
export const ANKI_DICT_KEY = "koodoreader";
export const ANKI_DICT_NAME = "Koodo Reader";

// modelofluna 的完整字段顺序（真机库中读取，索引 0-15）
export const ANKI_FIELD_NAMES = [
  "word",
  "rubytextHtml",
  "example_sentence",
  "audio_for_word",
  "audio_for_example_sentence",
  "screenshot",
  "remarks",
  "dictionaryInfo",
  "dictionaryContent",
  "luna_reserved_1",
  "luna_reserved_2",
  "luna_reserved_3",
  "user_custom_1",
  "user_custom_2",
  "user_custom_3",
  "mdictFoldState",
];

export interface AnkiConfig {
  host: string;
  port: string;
  apiKey: string;
  deckName: string;
}

export interface AnkiWordPayload {
  word: string;
  reading?: string;
  sentence?: string;
  definition?: string;
  dictName?: string;
  bookName?: string;
  chapter?: string;
  allowDuplicate?: boolean;
}

export const getAnkiConfig = (): AnkiConfig => {
  const saved = ConfigService.getObjectConfig(
    "ankiSyncConfig",
    "thirdpartyToken",
    {}
  );
  return {
    host: saved?.host || ANKI_DEFAULT_HOST,
    port: saved?.port || ANKI_DEFAULT_PORT,
    apiKey: saved?.apiKey || "",
    deckName: saved?.deckName || ANKI_DEFAULT_DECK,
  };
};

export const getAnkiEndpoint = (config?: AnkiConfig) => {
  const target = config || getAnkiConfig();
  const host = target.host || ANKI_DEFAULT_HOST;
  const port = target.port || ANKI_DEFAULT_PORT;
  return `http://${host}:${port}`;
};

/**
 * 通过 AnkiConnect 调用一个 action。
 * Electron 下走主进程 IPC（file:// 页面直连会被 CORS 拦截），浏览器端用 fetch 兜底。
 */
export const invokeAnkiConnect = async (
  action: string,
  params: Record<string, any> = {},
  config?: AnkiConfig
) => {
  const target = config || getAnkiConfig();
  const payload: Record<string, any> = { action, version: 6, params };
  if (target.apiKey) {
    payload.key = target.apiKey;
  }
  const body = JSON.stringify(payload);
  let text = "";
  if (isElectron && window.electronAPI?.invoke) {
    const response = await window.electronAPI.invoke("anki-connect", {
      url: getAnkiEndpoint(target),
      body,
    });
    if (!response || response.ok !== true) {
      throw new Error(
        `AnkiConnect HTTP ${response?.status || "error"}` +
          (response?.data ? `: ${String(response.data).slice(0, 200)}` : "")
      );
    }
    text = response.data;
  } else {
    const response = await fetch(getAnkiEndpoint(target), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    text = await response.text();
  }
  let result: any = null;
  try {
    result = JSON.parse(text);
  } catch (error) {
    throw new Error("AnkiConnect did not return valid JSON");
  }
  if (result && result.error) {
    throw new Error(String(result.error));
  }
  return result ? result.result : null;
};

export const checkAnkiConnect = async (config?: AnkiConfig) => {
  const version = await invokeAnkiConnect("version", {}, config);
  return String(version || "");
};

// 保证牌组存在（已存在时 AnkiConnect 同样返回牌组 id）
export const ensureAnkiDeck = async (config?: AnkiConfig) => {
  const target = config || getAnkiConfig();
  return await invokeAnkiConnect("createDeck", { deck: target.deckName }, target);
};

export const getAnkiModelFields = async (config?: AnkiConfig) => {
  return await invokeAnkiConnect(
    "modelFieldNames",
    { modelName: ANKI_MODEL_NAME },
    config
  );
};

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 把模型里出现的 ruby 标记还原成基础文本，避免重复套 <ruby>
const stripRuby = (value: string) =>
  String(value || "")
    .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "")
    .replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[\s()（）]/g, "");

const buildRubyHtml = (word: string, reading: string) => {
  const base = stripRuby(word);
  const kana = stripRuby(reading);
  if (!base || !kana || base === kana) return "";
  return `<ruby>${escapeHtml(base)}<rt>${escapeHtml(kana)}</rt></ruby>`;
};

const buildRemarks = (bookName: string, chapter: string) => {
  const title = String(bookName || "").trim();
  const section = String(chapter || "").trim();
  if (title && section) return `《${title}》 ${section}`;
  if (title) return `《${title}》`;
  return section;
};

export const buildAnkiFields = (payload: AnkiWordPayload) => {
  const word = String(payload.word || "").trim();
  const reading = String(payload.reading || "").trim();
  const sentence = String(payload.sentence || "").trim();
  const definition = String(payload.definition || "").trim();
  const dictName = String(payload.dictName || ANKI_DICT_NAME);
  const fields: Record<string, string> = {};
  for (const name of ANKI_FIELD_NAMES) {
    fields[name] = "";
  }
  fields.word = escapeHtml(word);
  fields.rubytextHtml = buildRubyHtml(word, reading);
  fields.example_sentence = escapeHtml(sentence);
  fields.remarks = escapeHtml(
    buildRemarks(payload.bookName || "", payload.chapter || "")
  );
  fields.dictionaryInfo = JSON.stringify([
    { dict: ANKI_DICT_KEY, name: dictName },
  ]);
  const definitionHtml = escapeHtml(
    definition || "（Koodo Reader 未获取到释义）"
  )
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => `<p>${line}</p>`)
    .join("");
  fields.dictionaryContent = JSON.stringify({
    [ANKI_DICT_KEY]: encodeURIComponent(definitionHtml),
  });
  return fields;
};

/**
 * 把一条划词生词写入 modelofluna 模板。
 * 牌组/模板不存在会给出明确提示，方便用户自行在 Anki 中补齐。
 */
export const addAnkiNote = async (payload: AnkiWordPayload) => {
  const word = String(payload.word || "").trim();
  if (!word) throw new Error("EMPTY_WORD");
  const config = getAnkiConfig();
  const models: string[] = await invokeAnkiConnect(
    "modelNames",
    {},
    config
  );
  if (!Array.isArray(models) || !models.includes(ANKI_MODEL_NAME)) {
    throw new Error("MODEL_NOT_FOUND");
  }
  await ensureAnkiDeck(config);
  const note = {
    deckName: config.deckName,
    modelName: ANKI_MODEL_NAME,
    fields: buildAnkiFields({ ...payload, word }),
    options: {
      allowDuplicate: payload.allowDuplicate === true,
      duplicateScope: "deck",
    },
    tags: ["koodo-reader"],
  };
  const noteId = await invokeAnkiConnect("addNote", { note }, config);
  return noteId;
};

export const formatAnkiError = (error: any) => {
  const message = String((error && error.message) || error || "");
  if (message === "EMPTY_WORD") return "EMPTY_WORD";
  if (message === "MODEL_NOT_FOUND") return "MODEL_NOT_FOUND";
  if (/duplicate/i.test(message)) return "DUPLICATE";
  if (/timeout|ECONNREFUSED|Failed to fetch|NetworkError/i.test(message)) {
    return "NOT_RUNNING";
  }
  return message;
};
