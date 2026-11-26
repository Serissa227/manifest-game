// 就地错误（docs/UI-REDESIGN.md 第 2.1、4 节“提示与确认”）：出错或做不了的那一处，写清为什么、怎么办，必要时给一个补救的按钮。
// - tone="error"（缺省）：操作失败。印章红的浅底，读屏立即念（role="alert"）。
// - tone="blocked"：现在做不了的原因（不是出错）。只有一道细线，不打断读屏；给它一个 id，让做不了的那个按钮 aria-describedby 指过来。
// 只在新界面（v2）里显示；旧界面（v1）维持原样——缺省什么都不显示，给了 v1 就显示 v1（例如原来的那一行字）。
import type { ReactNode } from "react";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd } from "./KeyHints";
import type { FeedbackAction, FeedbackSurface } from "./types";

export interface InlineErrorProps {
  /** 为什么（一句话：“现金不够：还差 1,200 金币”） */
  reason: ReactNode;
  /** 怎么办（一句话：“先卖掉一些货，或者少买一点”）；可省 */
  fix?: ReactNode;
  /** 就地补救的按钮（“去交易所”“重试”）；可省 */
  action?: FeedbackAction;
  /** error：操作失败（缺省）；blocked：现在做不了的原因 */
  tone?: "error" | "blocked";
  /** 放在什么底色上（深色的账台、舞台浮层上用 night） */
  on?: FeedbackSurface;
  /** 紧凑一些（放在列表行里） */
  compact?: boolean;
  /** 给做不了的控件 aria-describedby 用 */
  id?: string;
  className?: string;
  /** v1 时显示什么（缺省不显示：v1 维持原样） */
  v1?: ReactNode;
}

export function InlineError({ reason, fix, action, tone = "error", on = "paper", compact = false, id, className, v1 = null }: InlineErrorProps) {
  const v2 = useIsV2();
  if (!v2) return <>{v1}</>;
  const cls = ["v2-inline-error", tone === "blocked" ? "is-blocked" : "is-error", on === "night" ? "on-night" : "", compact ? "is-compact" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} id={id} role={tone === "error" ? "alert" : undefined} data-testid="inline-error">
      <span className="v2-inline-error-mark" aria-hidden="true">
        !
      </span>
      <div className="v2-inline-error-text">
        <p className="v2-inline-error-reason">{reason}</p>
        {fix && <p className="v2-inline-error-fix">{fix}</p>}
      </div>
      {action && (
        <button type="button" className={action.primary ? "btn small primary v2-inline-error-action" : "btn small v2-inline-error-action"} onClick={action.onClick} disabled={action.disabled}>
          {action.label}
          {action.shortcut && <Kbd k={action.shortcut} />}
        </button>
      )}
    </div>
  );
}
