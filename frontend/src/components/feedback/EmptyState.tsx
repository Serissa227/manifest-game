// 空状态（docs/UI-REDESIGN.md 第 4 节“空状态”、体检第 13 条）：一句话说为什么空，一个按钮做下一步
// （行情“至少要过一天”→“下一天”；航海士“还没有航海士”→“去酒馆”；货舱空→“去交易所”）。
// 新界面（v2）：浅底虚线框、居中，按钮是这一处唯一的主按钮。
// 旧界面（v1）维持原样：缺省画成原来的 <p className="empty">一句话</p>（与 components/common.tsx 的 Empty 相同，不带按钮）；
// 原来用的是别的写法（如 <p className="ts-empty">）时把原样传给 v1；v1={null} 表示 v1 什么都不显示。
import type { ReactNode } from "react";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd } from "./KeyHints";
import type { FeedbackAction } from "./types";

export interface EmptyStateProps {
  /** 为什么空（一句话） */
  text: ReactNode;
  /** 补充一句（可省） */
  hint?: ReactNode;
  /** 下一步（一个主按钮；可省） */
  action?: FeedbackAction;
  /** 小图标（像素图标等，读屏跳过；可省） */
  icon?: ReactNode;
  className?: string;
  /** v1 时显示什么（缺省 <p className="empty">{text}</p>） */
  v1?: ReactNode;
}

export function EmptyState({ text, hint, action, icon, className, v1 }: EmptyStateProps) {
  const v2 = useIsV2();
  if (!v2) return <>{v1 === undefined ? <p className="empty">{text}</p> : v1}</>;
  return (
    <div className={className ? `v2-empty ${className}` : "v2-empty"} data-testid="empty-state">
      {icon && (
        <div className="v2-empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="v2-empty-text">{text}</p>
      {hint && <p className="v2-empty-hint">{hint}</p>}
      {action && (
        <button type="button" className="btn primary v2-empty-action" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
          {action.shortcut && <Kbd k={action.shortcut} />}
        </button>
      )}
    </div>
  );
}
