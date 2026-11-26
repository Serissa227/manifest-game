// 错误边界：舞台、窗口内容或某张像素图渲染出错时，只让这一块显示提示，整个游戏界面不至于白屏。
// 后备内容收到错误信息与 reset（清掉错误、重新渲染这一块——“重试”按钮用）。
import { Component, type ReactNode } from "react";
import { t } from "../../i18n";
import { InlineError } from "../feedback/InlineError";

interface Props {
  /** 出错时显示的内容；收到错误信息与 reset（清掉错误、再渲染一次） */
  fallback: (message: string, reset: () => void) => ReactNode;
  /** 变化时清除错误状态重新渲染（例如切换了功能页） */
  resetKey?: string | number;
  children: ReactNode;
}

interface State {
  error: string | null;
  key: string | number | undefined;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(e: unknown): Partial<State> {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

/** 功能窗口的内容出错时的后备内容。新界面（v2）：印章红的就地错误——为什么、怎么办、“重试”（重新渲染这一块）；
 *  旧界面（v1）照旧是一行空状态的字。 */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const text = t("shellPanelError", { message });
  return (
    <InlineError
      className="v2-panel-error"
      reason={text}
      fix={t("v2.system.panelErrorFix")}
      action={{ label: t("v2.system.retry"), onClick: onRetry }}
      v1={<p className="empty">{text}</p>}
    />
  );
}
