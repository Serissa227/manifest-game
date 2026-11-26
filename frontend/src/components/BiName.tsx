// 双行名字（EXPANSION.md §12.3）：专名以英文为主。
// - 英文界面：只显示英文（name_en；缺失时显示 name）。
// - 中文界面：显示中文，下方一小行英文原名（字号约 65%、颜色更淡）；英文缺失或与中文相同（例如玩家起的名字）时只显示一行。
// 用在醒目的名字上：港口街景的港名牌、窗口与对话框标题里的人名与地名、人物卡片、舰队与船名、殖民地与发现物详情标题、
// 海图上选中或悬停的地点。表格、列表、句子里的专名只显示当前语言，用 title 悬停提示另一种写法（见 i18n 的 nameOf / otherName）。
// 英文小行对读屏软件隐藏（aria-hidden），可访问名称仍是当前语言的名字。
import { memo, type ReactNode } from "react";
import { useLocale } from "../i18n/locale";

export interface BiNameProps {
  /** 当前语言的名字（后端按当前语言给出的 name；中文界面即中文名，程序生成的人名即中文音译） */
  zh: string;
  /** 英文正名（name_en，程序生成的人名即拉丁字母原形）；缺失时只显示 zh */
  en?: string | null;
  /** 主行的内容（例如含名字的整句标题）；缺省为名字本身 */
  children?: ReactNode;
  className?: string;
  /** 外层元素，默认 span */
  as?: "span" | "strong" | "div" | "h2" | "h3" | "h4";
  testId?: string;
  id?: string;
}

/** 双行名字：中文界面“中文 + 小一号的英文”，英文界面只有英文。 */
export const BiName = memo(function BiName({ zh, en, children, className, as = "span", testId, id }: BiNameProps) {
  const locale = useLocale((s) => s.locale);
  const english = en?.trim() || "";
  const Tag = as;
  if (locale === "en") {
    return (
      <Tag className={className ? `bi-name ${className}` : "bi-name"} data-testid={testId} id={id} lang="en">
        <span className="bi-name-main">{children ?? (english || zh)}</span>
      </Tag>
    );
  }
  const two = english !== "" && english !== zh.trim();
  const cls = ["bi-name", two ? "bi-name-two" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <Tag className={cls} data-testid={testId} id={id}>
      <span className="bi-name-main">{children ?? zh}</span>
      {two && (
        <span className="bi-name-sub" lang="en" aria-hidden="true">
          {english}
        </span>
      )}
    </Tag>
  );
});
