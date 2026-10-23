import toast from "react-hot-toast";
import i18n from "../../i18n";
import BookModel from "../../models/Book";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { BookHelper } from "../../assets/lib/kookit.min";
import * as Kookit from "../../assets/lib/kookit.min";
import BookUtil from "../file/bookUtil";
import CoverUtil from "../file/coverUtil";
import DatabaseService from "../storage/databaseService";
import { getTextRules, supportedFormats } from "../common";
import { isElectron } from "react-device-detect";
import {
  NeatReaderCloudBook,
  cleanupTempFile,
  downloadCloudBook,
  downloadCloudCover,
} from "./api";

declare var window: any;

const sanitizeFileName = (value: string) =>
  (value || "book").replace(/[\\/:*?"<>|]/g, "_");

const getBookName = (cloudBook: NeatReaderCloudBook) => {
  const fileName = cloudBook.fileName || "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0) {
    return fileName.substring(0, dotIndex);
  }
  return cloudBook.bookName || fileName || cloudBook.guid;
};

const getExtension = (cloudBook: NeatReaderCloudBook) => {
  const fileName = cloudBook.fileName || "";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ext && supportedFormats.includes("." + ext)) {
    return ext;
  }
  const type = (cloudBook.fileType || "").toLowerCase();
  if (type && supportedFormats.includes("." + type)) {
    return type;
  }
  return "epub";
};

/** 计算整书 md5，用于与本地书库去重（与本地导入保持一致） */
const computeMd5 = async (buffer: ArrayBuffer): Promise<string> => {
  if (isElectron && window.electronAPI?.crypto?.md5) {
    try {
      return window.electronAPI.crypto.md5(new Uint8Array(buffer));
    } catch (error) {
      // fall through
    }
  }
  const CryptoJS = (await import("crypto-js")).default;
  const wordArray = CryptoJS.lib.WordArray.create(
    new Uint8Array(buffer) as any
  );
  return CryptoJS.MD5(wordArray).toString();
};

export interface NeatReaderImportResult {
  book: BookModel | null;
  isDuplicate: boolean;
  bookKey?: string;
}

/**
 * 将 NeatReader 云端书籍下载并写入本地书库。
 * 复用本地导入链路：BookHelper 解析元数据 → BookUtil 写入书库 → CoverUtil 落封面 → 保存记录。
 */
export const importNeatReaderBook = async (
  cloudBook: NeatReaderCloudBook,
  onProgress?: (stage: string) => void
): Promise<NeatReaderImportResult> => {
  const toastId = "neatreader-" + cloudBook.guid;
  const bookName = getBookName(cloudBook);
  let tempPath = "";
  try {
    onProgress?.("正在下载原书…");
    toast.loading(
      i18n.t("Downloading") + ": " + bookName.substring(0, 40),
      { id: toastId }
    );
    const downloaded = await downloadCloudBook(cloudBook);
    tempPath = downloaded.tempPath || "";
    const buffer = downloaded.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("下载内容为空");
    }

    onProgress?.("正在校验…");
    const md5 = await computeMd5(buffer);
    const repeatBook: BookModel | null = await BookUtil.getBookByMd5(md5);
    if (repeatBook) {
      toast.error(i18n.t("Duplicate book"), { id: toastId });
      return { book: null, isDuplicate: true, bookKey: repeatBook.key };
    }

    const extension = getExtension(cloudBook);
    onProgress?.("正在解析书籍…");
    const rendition = BookHelper.getRendition(
      buffer,
      {
        format: extension.toUpperCase(),
        readerMode: "",
        charset: "",
        animation: ConfigService.getReaderConfig("animation") || "none",
        convertChinese: ConfigService.getReaderConfig("convertChinese"),
        bookLayout: ConfigService.getReaderConfig("bookLayout"),
        textRules: getTextRules(),
        codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
        fullTranslationMode: "no",
        textOrientation: ConfigService.getReaderConfig("textOrientation"),
        parserRegex: "",
        isDarkMode: "no",
        isMobile: "no",
        password: "",
        isScannedPDF: "no",
        isKeepPDFBackground: "no",
      },
      Kookit
    );
    const book = (await BookHelper.generateBook(
      bookName,
      extension,
      md5,
      downloaded.size || buffer.byteLength,
      cloudBook.fileName || bookName + "." + extension,
      buffer,
      rendition
    )) as BookModel;
    if (!book || !book.key) {
      throw new Error(i18n.t("Import failed"));
    }

    if (
      ConfigService.getReaderConfig("isPrecacheBook") === "yes" &&
      extension !== "pdf"
    ) {
      try {
        const cache = await (rendition as any).preCache(buffer);
        if (cache && cache !== "err") {
          await BookUtil.addBook("cache-" + book.key, "zip", cache);
        }
      } catch (error) {
        console.warn("[neatreader] preCache failed", error);
      }
    }

    onProgress?.("正在写入书库…");
    await BookUtil.addBook(book.key, book.format.toLowerCase(), buffer);

    onProgress?.("正在获取封面…");
    const cover = await downloadCloudCover(cloudBook);
    if (cover) {
      book.cover = cover;
      await CoverUtil.addCover(book);
    }

    await DatabaseService.saveRecord(book, "books");
    ConfigService.setListConfig(book.key, "recentBooks");
    toast.success(
      i18n.t("Addition successful") + ": " + bookName.substring(0, 40),
      { id: toastId }
    );
    return { book, isDuplicate: false, bookKey: book.key };
  } catch (error) {
    console.error("[neatreader] import failed", error);
    toast.error(
      i18n.t("Import failed") +
        ": " +
        (error instanceof Error ? error.message : String(error)),
      { id: toastId, duration: 5000 }
    );
    return { book: null, isDuplicate: false };
  } finally {
    cleanupTempFile(tempPath);
  }
};

export const getSafeCloudFileName = (cloudBook: NeatReaderCloudBook) =>
  sanitizeFileName(cloudBook.fileName || getBookName(cloudBook));
