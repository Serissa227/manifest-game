// 确认对话框（docs/UI-REDESIGN.md 第 4 节“提示与确认”）：收不回来的操作（解雇、卖船、放弃殖民地、删存档……）先问一句。
// - 主按钮写清动作（“解雇 3 名船员”，不写“确定”）；危险操作是印章红的按钮，打开时焦点在“取消”上（免得一个回车就做了）。
// - Esc、点遮罩都是取消；Tab 只在对话框里转；关掉后焦点回到打开它的地方。办事的时候按钮不可用、写“正在办……”；出错就地写在对话框里。
// - 挂到 body 上；对话框里的按键与点击不再传给下面的界面（交易所的回车成交、窗口的 Esc 关闭都不会被误触发）。
// - 新界面（v2）：桌面居中的纸卡；手机上从底部升起、按钮整宽、“取消”在最下面（拇指最近）。
//   旧界面（v1）：同样的结构，用 v1 原有的对话框外观（黄铜框 + 羊皮纸，.modal / .modal-body），不带任何 v2 的类。
//   只在原来就要确认的地方直接换用；原来不问的操作要在 v2 下才问时，配合 useIsV2() 判断。
// 一般用 useConfirm()（见 useConfirm.tsx）：一行代码问、等回答、做事、回音。
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useIsV2 } from "../../ui/uiMode";
import { InlineError } from "./InlineError";

/** 问什么、主按钮写什么。 */
export interface ConfirmOptions {
  /** 标题：问的是什么（“解雇这 3 名船员？”） */
  title: ReactNode;
  /** 后果（“解雇之后他们会离开港口，想再雇要重新招募”）；可省 */
  body?: ReactNode;
  /** 主按钮上的字：写清动作（“解雇 3 名船员”） */
  confirmLabel: string;
  /** 取消按钮上的字（缺省“取消”） */
  cancelLabel?: string;
  /** danger：危险操作（缺省，印章红的按钮，焦点先在“取消”上）；primary：普通的确认（黄铜主按钮，焦点在主按钮上） */
  tone?: "danger" | "primary";
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  /** 正在办：两个按钮都不可用，主按钮写“正在办……” */
  busy?: boolean;
  /** 办的时候出的错（就地写在对话框里） */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, tone = "danger", busy = false, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const v2 = useIsV2();
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 关掉后焦点还给打开它的元素
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panel.current || panel.current.contains(document.activeElement)) return;
    // 焦点不在对话框里时（刚打开、办完事按钮重新可用）：危险操作放在“取消”上，普通确认放在主按钮上；
    // 办事的时候按钮都不可用，先放在对话框本身上（Esc、Tab 照样由对话框处理）
    if (busy) panel.current.focus({ preventScroll: true });
    else (tone === "danger" ? cancelRef.current : okRef.current)?.focus({ preventScroll: true });
  }, [open, busy, tone]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 对话框里的按键不传给下面的界面（React 的事件会穿过 portal 冒泡到原来的父组件）
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (e.key === "Tab" && panel.current) {
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const dialog = (
    <div
      className={v2 ? "modal v2-confirm-backdrop" : "modal"}
      data-testid="confirm-dialog"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // 点击也不传给下面的界面；点在遮罩上（对话框外）是取消
        e.stopPropagation();
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panel}
        className={v2 ? "modal-body v2-confirm" : "modal-body"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        {v2 && <span className="v2-confirm-grip" aria-hidden="true" />}
        <h2 id={titleId} className={v2 ? "v2-confirm-title" : undefined}>
          {title}
        </h2>
        {body && (
          <div id={bodyId} className={v2 ? "v2-confirm-body" : undefined}>
            {body}
          </div>
        )}
        {error && (
          <InlineError
            reason={error}
            v1={
              <p role="alert" className="empty">
                {error}
              </p>
            }
          />
        )}
        <div className={v2 ? "row v2-confirm-actions" : "row"}>
          <button ref={cancelRef} type="button" className="btn" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? t("cancel")}
          </button>
          <button ref={okRef} type="button" className={`btn ${tone}`} disabled={busy} onClick={onConfirm}>
            {busy ? t("v2.fb.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}
