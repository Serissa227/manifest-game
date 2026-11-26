// 载入中（docs/UI-REDESIGN.md 第 8 节第 11 项“加载骨架”、体检第 12 条）：代码块或数据还在路上时的占位。
// 新界面（v2）：一行安静的“载入中……”（前面一颗慢慢明灭的黄铜小点），下面几道浅色的骨架细条——看得出“内容马上就来”，
// 不再借用空状态的虚线框（那是“这里什么都没有”的意思）。读屏念一次（role="status"）。
// 旧界面（v1）维持原样：缺省画成原来的 <p className="empty">载入中……</p>；原来是别的写法（如 <p className="ts-empty">）时把原样传给 v1。
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useIsV2 } from "../../ui/uiMode";

export interface LoadingProps {
  /** 写什么（缺省“载入中……”） */
  text?: ReactNode;
  /** 骨架细条的条数（缺省 3；放在一行里的小地方给 0） */
  lines?: number;
  className?: string;
  /** v1 时显示什么（缺省 <p className="empty">载入中……</p>） */
  v1?: ReactNode;
}

export function Loading({ text, lines = 3, className, v1 }: LoadingProps) {
  const v2 = useIsV2();
  const label = text ?? t("loading");
  if (!v2) return <>{v1 === undefined ? <p className="empty">{label}</p> : v1}</>;
  return (
    <div className={className ? `v2-loading-block ${className}` : "v2-loading-block"} role="status" data-testid="loading">
      <p className="v2-loading">{label}</p>
      {lines > 0 && (
        <div className="v2-skeleton" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className="v2-skeleton-line" />
          ))}
        </div>
      )}
    </div>
  );
}
