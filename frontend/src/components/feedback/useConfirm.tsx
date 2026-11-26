// 确认之后再做（ConfirmDialog 的用法）：
//
//   const confirm = useConfirm();
//   …
//   <button onClick={() => void confirm.run(
//     { title: t("…ask"), body: t("…what happens"), confirmLabel: t("…fire", { n }), done: t("…fired", { n }) },
//     () => submit({ FireCrew: { … } }),     // 返回 null / false（store.submit 失败时就是 null，错误已经由提示条报过）就当没办成
//   )}>…</button>
//   {confirm.dialog}
//
// - ask(opts)：只问，回答 true / false。
// - run(opts, action)：问；点了主按钮就办 action（对话框里写“正在办……”）；办成了关掉对话框，有 done 就在提示条里回一句；
//   action 抛错时对话框不关，错误就地写在里面，可以再试或取消；action 返回 false / null 时关掉（错误已由别处报过）。
// 一次只问一件事：上一个还没回答又问新的，上一个按取消处理。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText } from "../../ipc/api";
import { useGame } from "../../store/game";
import { ConfirmDialog, type ConfirmOptions } from "./ConfirmDialog";

export interface ConfirmRunOptions extends ConfirmOptions {
  /** 办成之后提示条里回的一句（“已解雇 3 名船员”）；可省 */
  done?: string;
}

interface Asking {
  opts: ConfirmRunOptions;
  action: (() => unknown) | null;
  busy: boolean;
  error: ReactNode | null;
}

export interface Confirm {
  /** 只问：回答 true（点了主按钮）或 false（取消、Esc、点遮罩） */
  ask: (opts: ConfirmOptions) => Promise<boolean>;
  /** 问了再办：办成为 true，取消或没办成为 false */
  run: (opts: ConfirmRunOptions, action: () => unknown) => Promise<boolean>;
  /** 要渲染的对话框（没在问时为 null） */
  dialog: ReactNode;
}

export function useConfirm(): Confirm {
  const [asking, setAsking] = useState<Asking | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // 组件卸下时还没回答的，按取消处理
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  const finish = useCallback((ok: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    if (alive.current) setAsking(null);
    r?.(ok);
  }, []);

  const open = useCallback((opts: ConfirmRunOptions, action: (() => unknown) | null) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setAsking({ opts, action, busy: false, error: null });
    });
  }, []);

  const ask = useCallback((opts: ConfirmOptions) => open(opts, null), [open]);
  const run = useCallback((opts: ConfirmRunOptions, action: () => unknown) => open(opts, action), [open]);

  const onConfirm = async () => {
    if (!asking) return;
    const { action, opts } = asking;
    if (!action) {
      finish(true);
      return;
    }
    setAsking((a) => (a ? { ...a, busy: true, error: null } : a));
    try {
      const result = await action();
      if (result === false || result === null) {
        finish(false);
        return;
      }
      if (opts.done) useGame.getState().notify(opts.done);
      finish(true);
    } catch (e) {
      if (alive.current) setAsking((a) => (a ? { ...a, busy: false, error: errorText(e) } : a));
    }
  };

  const dialog = asking ? (
    <ConfirmDialog
      open
      title={asking.opts.title}
      body={asking.opts.body}
      confirmLabel={asking.opts.confirmLabel}
      cancelLabel={asking.opts.cancelLabel}
      tone={asking.opts.tone}
      busy={asking.busy}
      error={asking.error}
      onConfirm={() => void onConfirm()}
      onCancel={() => finish(false)}
    />
  ) : null;
  return { ask, run, dialog };
}
