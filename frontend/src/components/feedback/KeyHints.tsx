// 快捷键提示（docs/UI-REDESIGN.md 第 4 节“键盘快捷键提示”）：键名画成 12 px 的小键帽，放在有快捷键的按钮旁或一组提示里。
// 只在新界面（v2）里出现；旧界面（v1）维持原样——缺省什么都不显示，给了 v1 就显示 v1。触屏上（pointer: coarse）样式表把它们藏起来。
import { memo, type ReactNode } from "react";
import { t } from "../../i18n";
import { useIsV2 } from "../../ui/uiMode";
import { keyLabel } from "./keys";
import type { FeedbackSurface } from "./types";

/** 一个小键帽：显示键名，读屏念完整的名字（方向键念“上箭头”）。v1 下不显示。 */
export const Kbd = memo(function Kbd({ k }: { k: string }) {
  const v2 = useIsV2();
  if (!v2) return null;
  const { text, name } = keyLabel(k);
  return (
    <kbd className="v2-kbd">
      <span aria-hidden="true">{text}</span>
      <span className="v2-sr">{name}</span>
    </kbd>
  );
});

/** 一条快捷键提示：一个或几个键（如 ↑ ↓）+ 做什么。 */
export interface KeyHint {
  /** 键（KeyboardEvent.key 的写法或简写：Enter、Esc、ArrowUp、Shift……）；几个键并列表示“任一个” */
  keys: readonly string[];
  /** 做什么（“选货”“成交”） */
  label: ReactNode;
}

/** 一组快捷键提示（如交易所底部的“↑↓ 选货 · ←→ 调数量 · 回车 成交”）。 */
export function KeyHints({
  items,
  on = "paper",
  className,
  v1 = null,
}: {
  items: readonly KeyHint[];
  /** 放在什么底色上（深色的账台上用 night） */
  on?: FeedbackSurface;
  className?: string;
  /** v1 时显示什么（缺省不显示：v1 维持原样） */
  v1?: ReactNode;
}) {
  const v2 = useIsV2();
  if (!v2) return <>{v1}</>;
  const cls = ["v2-keys", on === "night" ? "on-night" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <ul className={cls} aria-label={t("v2.fb.keys")}>
      {items.map((it, i) => (
        <li key={i} className="v2-keys-item">
          <span className="v2-keys-combo">
            {it.keys.map((k) => (
              <Kbd key={k} k={k} />
            ))}
          </span>
          <span className="v2-keys-label">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}
