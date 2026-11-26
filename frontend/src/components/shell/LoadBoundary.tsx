// 按需加载的界面的占位与失败提示（与 loadable.ts 配合）。
// 新界面（v2）：下载失败时是印章红的就地错误（为什么、怎么办、“重试”），与功能窗口出错（ErrorBoundary 的 PanelError）同一种样子；
// 整屏的界面（App.tsx 的 Lazy：主界面、养成主界面）没能载入时，这张错误放在深色底的正中。旧界面（v1）的 DOM 照旧。
import { Component, useEffect, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { useIsV2 } from "../../ui/uiMode";
import { InlineError } from "../feedback/InlineError";
import { retryFailedLoads } from "./loadable";

/** 稍等再显示的占位：加载得快时什么都不闪；慢的时候过 ms 毫秒才出现。 */
export function Delayed({ children, ms = 300 }: { children: ReactNode; ms?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return shown ? <>{children}</> : null;
}

interface BoundaryProps {
  children: ReactNode;
  /** 变化时清除错误（例如换了功能页） */
  resetKey?: string;
  /** 整屏的界面（App.tsx 的 Lazy）：v2 下错误放在屏幕正中；功能窗口里的不给 */
  screen?: boolean;
}

/** 没能载入：说一声、给“重试”。v1 是原来的一段字加一个按钮；v2 是就地错误（整屏时居中放在一张纸卡里）。 */
function LoadFailed({ screen = false, onRetry }: { screen?: boolean; onRetry: () => void }) {
  const v2 = useIsV2();
  if (!v2) {
    return (
      <div className="load-failed" role="alert">
        <p>{t("layout.loadFailed")}</p>
        <button type="button" className="btn" onClick={onRetry}>
          {t("layout.loadRetry")}
        </button>
      </div>
    );
  }
  const error = (
    <InlineError className="v2-load-failed-error" reason={t("layout.loadFailed")} fix={t("v2.fb.loadFailedFix")} action={{ label: t("layout.loadRetry"), onClick: onRetry }} />
  );
  return (
    <div className={screen ? "v2-load-failed is-screen" : "v2-load-failed"} data-testid="load-failed">
      {screen ? <div className="v2-load-failed-card parchment">{error}</div> : error}
    </div>
  );
}

/** 是不是下载代码块失败（动态导入的错误）。 */
function isLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|ChunkLoadError/i.test(msg);
}

/** 按需加载失败时：说一声，给一个“重试”（重新下载）；其他渲染错误照样交给外层。 */
export class LoadBoundary extends Component<BoundaryProps, { error: unknown; key: string | undefined }> {
  state = { error: null as unknown, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: unknown; key: string | undefined }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // 不是下载失败：照样往外抛（与没有这层时一样）
    if (!isLoadError(error)) throw error;
    return (
      <LoadFailed
        screen={this.props.screen}
        onRetry={() => {
          retryFailedLoads();
          this.setState({ error: null });
        }}
      />
    );
  }
}
