// 抽屉（网页自适应）：手机上从屏幕底部滑出的羊皮纸面板（拇指够得着），平板上是从顶栏右侧垂下的下拉面板。
// 顶栏的“菜单”、底部导航的“更多”都用它。挂到 body 上（不受顶栏、命令栏的层叠影响）；点遮罩、按 Esc 或“收起”关闭，
// 关闭后焦点回到打开它的按钮。
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { ShellIcon } from "./ShellIcon";
import type { IconName } from "../../art/icons";

export type SheetPlacement = "bottom" | "top-right" | "left";

export default function Sheet({
  title,
  icon,
  onClose,
  placement = "bottom",
  className,
  testId,
  children,
}: {
  title: string;
  icon?: IconName;
  onClose: () => void;
  /** bottom：从底部滑出（手机）；top-right：顶栏右侧的下拉面板（平板）；left：从左侧滑出（手机横屏的侧栏旁） */
  placement?: SheetPlacement;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    // 打开时把焦点放进面板；关闭时还给打开它的元素
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  const body = (
    <div
      className={`sheet-backdrop sheet-at-${placement}`}
      data-testid={testId ? `${testId}-backdrop` : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={className ? `sheet parchment ${className}` : "sheet parchment"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        <header className="sheet-head">
          {placement === "bottom" && <span className="sheet-grip" aria-hidden="true" />}
          <h2 className="sheet-title" id={titleId}>
            {icon && <ShellIcon name={icon} scale={1} />}
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label={t("layout.sheetClose")} title={t("layout.sheetClose")} onClick={onClose}>
            <ShellIcon name="close" scale={1} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? body : createPortal(body, document.body);
}
