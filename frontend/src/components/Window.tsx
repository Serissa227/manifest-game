// 功能窗口：浮在舞台上的木框窗口，羊皮纸底，标题做成黄铜牌匾，右上角是关闭按钮；内容区可滚动。
// 新界面（v2）：关闭键左边另有一颗“?”小键帽（用鼠标时才有），点它打开全部快捷键（feedback/ShortcutHelp.tsx）；旧界面没有。
import { useId, type ReactNode } from "react";
import type { IconName } from "../art/icons";
import { t } from "../i18n";
import { ShortcutHelpButton } from "./feedback/ShortcutHelp";
import ErrorBoundary, { PanelError } from "./shell/ErrorBoundary";
import { ShellIcon } from "./shell/ShellIcon";
import type { WindowPlacement, WindowSize } from "./shell/shellState";

export default function Window({
  title,
  icon,
  onClose,
  placement = "right",
  size = "medium",
  id,
  role = "region",
  labelledBy,
  children,
}: {
  title: string;
  icon?: IconName;
  onClose?: () => void;
  placement?: WindowPlacement;
  size?: WindowSize;
  id?: string;
  /** 默认是一个具名区域；由命令栏控制时用 tabpanel */
  role?: "region" | "tabpanel" | "dialog";
  /** 可访问名称取自另一个元素（例如命令栏的标签）；不给时取窗口标题 */
  labelledBy?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      className={`gw gw-${placement} gw-${size}`}
      role={role}
      aria-labelledby={labelledBy ?? titleId}
      data-testid="game-window"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="gw-head">
        <h2 className="gw-plaque" id={titleId}>
          {icon && <ShellIcon name={icon} scale={1} />}
          <span>{title}</span>
        </h2>
        {onClose && <ShortcutHelpButton />}
        {onClose && (
          <button type="button" className="gw-close" aria-label={t("shellCloseWindow")} title={t("shellCloseWindow")} onClick={onClose}>
            <ShellIcon name="close" scale={1} />
          </button>
        )}
      </div>
      <div className="gw-body parchment">
        <ErrorBoundary resetKey={title} fallback={(message, reset) => <PanelError message={message} onRetry={reset} />}>
          {children}
        </ErrorBoundary>
      </div>
    </section>
  );
}
