// 当前语言（EXPANSION.md §12）：独立的小 store。
// - 首次启动（设置里还没有 language）按系统语言：navigator.language 以 zh 开头取简体中文，否则英语；
// - 之后以设置 AppSettings.language 为准（store/game.ts 的 init 读取设置后调用 setLocale）；
// - 在设置里切换时立即生效：App 以语言为 key 重新挂载整个界面，所有 t() / tk() 按新语言重新取字。
// 语言只影响显示：不进入命令、存档与世界状态，切换语言不改变世界哈希与重放结果。
import { create } from "zustand";
import type { Locale } from "../ipc/types";

/** 语言下拉 / 分段按钮里的选项（顺序即显示顺序）。中文的两套剧情文本合在“中文”一项里，另由设置里的“剧情文本”一行切换。 */
export const LOCALES: readonly Locale[] = ["zh-CN", "en"];

/** L01F：中文剧情文本的第二套（Gemini 重写）。 */
export const GEMINI_LOCALE = "zh-CN-x-gemini" as const;

/** 是不是中文（原文或 Gemini 那一套都算）：界面字一律按中文那套。 */
export function isChinese(locale: Locale | string | null | undefined): boolean {
  return locale === "zh-CN" || locale === GEMINI_LOCALE;
}

/** 语言选择框里显示的那一项：两套中文都显示为“中文”。 */
export function languageChoice(locale: Locale): Locale {
  return isChinese(locale) ? "zh-CN" : locale;
}

const ZH_TEXT_KEY = "manifest.zhText";
/** 用户在“剧情文本”里选过哪一套（本机记着）：换成英文再换回中文时照它回到那一套，不悄悄改回原文。 */
export function rememberedChinese(): Locale {
  try {
    return localStorage.getItem(ZH_TEXT_KEY) === "gemini" ? GEMINI_LOCALE : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
export function rememberChinese(locale: Locale): void {
  if (!isChinese(locale)) return;
  try {
    localStorage.setItem(ZH_TEXT_KEY, locale === GEMINI_LOCALE ? "gemini" : "claude");
  } catch {
    // 没有本机存储：只是不记
  }
}
/** 语言选择框选了某一项 → 真正要用的语言：选“中文”时回到记着的那一套。 */
export function chosenLocale(choice: Locale): Locale {
  return choice === "zh-CN" ? rememberedChinese() : choice;
}

/** 语言下拉框里各语言的名字：每种语言用它自己的文字书写，不随界面语言变化。 */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  "zh-CN": "简体中文",
  "zh-CN-x-gemini": "简体中文",
  en: "English",
};

/** 是否为支持的语言代码。 */
export function isLocale(v: unknown): v is Locale {
  return v === "zh-CN" || v === GEMINI_LOCALE || v === "en";
}

/** 系统语言 → 界面语言：zh 开头（zh、zh-CN、zh-TW、zh-Hans……）取简体中文，其余一律英语。 */
export function detectLocale(lang?: string | null): Locale {
  const l = lang ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return typeof l === "string" && l.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** 设置里的语言；旧设置没有这个字段（或值无法识别）时按系统语言。 */
export function settingsLocale(language: unknown, system?: string | null): Locale {
  return isLocale(language) ? language : detectLocale(system);
}

export interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** 同步 <html lang>：读屏软件按语言朗读，样式表用 :root[lang="en"] 做英文界面的排版微调。 */
function syncDocument(locale: Locale): void {
  try {
    // L01F：Gemini 那一套也是中文：<html lang> 写 zh-CN（样式与读屏都按中文）
    if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = isChinese(locale) ? "zh-CN" : locale;
  } catch {
    // 没有文档对象（纯逻辑测试）时忽略
  }
}

/**
 * 语言 store。初始值取系统语言（测试环境在 setup.ts 里把系统语言设为 zh-CN，现有测试默认中文）；
 * 读到设置后以设置为准。
 */
export const useLocale = create<LocaleStore>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    if (!isLocale(locale)) return;
    syncDocument(locale);
    set({ locale });
  },
}));

syncDocument(useLocale.getState().locale);

/** 当前语言（非 React 代码用）。 */
export function currentLocale(): Locale {
  return useLocale.getState().locale;
}

/** 切换当前语言（不保存设置；保存见 store/game.ts 的 changeLanguage）。 */
export function setLocale(locale: Locale): void {
  useLocale.getState().setLocale(locale);
}
