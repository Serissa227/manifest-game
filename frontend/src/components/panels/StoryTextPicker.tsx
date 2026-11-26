// L01F2：“剧情文本”的切换——Claude 写的原文（zh-CN）与 Gemini 逐条重写的那一套（zh-CN-x-gemini）。
// 设置面板、养成期主菜单、标题画面三处共用这一个组件（同一段切换逻辑，只换外观）：只在语言是中文时出现；点了当场生效（changeLanguage），
// 切成了在本机记下选择（从英文换回中文时回到这一套）；没切成（后端不认这个值）时留在原处，用现有提示条说一句。字都是定稿（zhOnly 的 st.storyText*）。
import { useState } from "react";
import { GEMINI_LOCALE, currentLocale, isChinese, rememberChinese, useLocale } from "../../i18n/locale";
import { tz } from "../../i18n/zhOnly";
import type { Locale } from "../../ipc/types";
import { useGame } from "../../store/game";
import { Select } from "../common";
import { Segmented } from "./Segmented";

const options = (): { value: Locale; label: string }[] => [
  { value: "zh-CN", label: tz("st.storyText.claude") },
  { value: GEMINI_LOCALE, label: tz("st.storyText.gemini") },
];

/**
 * variant：settings = 设置面板（分段按钮 / 经典界面下拉 + 说明）；menu = 养成期主菜单（同“养成期的停顿”的单选样式 + 说明）；
 * title = 标题画面语言下拉旁的小控件（下拉，说明放在悬停提示里）。value 不给时跟着当前界面语言。
 */
export function StoryTextPicker({
  variant,
  value,
  onChanged,
  v2 = true,
}: {
  variant: "settings" | "menu" | "title";
  value?: Locale;
  onChanged?: (l: Locale) => void;
  v2?: boolean;
}) {
  const live = useLocale((s) => s.locale);
  const current = value ?? live;
  const [busy, setBusy] = useState(false);
  if (!isChinese(current)) return null;
  const pick = async (next: Locale) => {
    if (next === current || busy) return;
    setBusy(true);
    try {
      await useGame.getState().changeLanguage(next);
      if (currentLocale() === next) {
        rememberChinese(next);
        onChanged?.(next);
      } else useGame.getState().fail(tz("st.storyText.missing"));
    } finally {
      setBusy(false);
    }
  };
  const opts = options();
  if (variant === "menu")
    return (
      <fieldset className="ub-menu-pause ub-menu-storytext" data-testid="ub-menu-story-text" disabled={busy}>
        <legend>{tz("st.storyText")}</legend>
        {opts.map((o) => (
          <label key={o.value} className={current === o.value ? "ub-menu-pause-opt is-on" : "ub-menu-pause-opt"}>
            <input type="radio" name="ub-menu-story-text" value={o.value} checked={current === o.value} onChange={() => void pick(o.value)} />
            <span className="ub-menu-pause-text">
              <b>{o.label}</b>
            </span>
          </label>
        ))}
        <small className="ub-menu-storytext-help">{tz("st.storyText.help")}</small>
      </fieldset>
    );
  if (variant === "title")
    return (
      <label className="title-lang title-storytext" title={tz("st.storyText.help")} data-testid="title-story-text">
        <span className="title-lang-label">{tz("st.storyText")}</span>
        <select aria-label={tz("st.storyText")} value={current} disabled={busy} onChange={(e) => void pick(e.target.value as Locale)}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div data-testid="settings-story-text">
      {v2 ? (
        <Segmented<Locale> label={tz("st.storyText")} value={current} options={opts} onChange={(l) => void pick(l)} />
      ) : (
        <Select<Locale> label={tz("st.storyText")} value={current} options={opts} onChange={(l) => void pick(l)} />
      )}
      <p className="sub pn-st-help">{tz("st.storyText.help")}</p>
    </div>
  );
}
