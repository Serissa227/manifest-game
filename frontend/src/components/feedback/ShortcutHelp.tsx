// 全部快捷键（docs/UI-REDESIGN.md 第 4 节“键盘快捷键提示”：第二阶段加“?”弹出全部快捷键；第 8 节第 11 项）：
// 主界面里按“?”打开一张纸卡，按用途分组列出现有的键盘操作——时间与画面、窗口与对话框、剧情对话、交易所、手动航行、新手教程；
// 养成画面（context="upbringing"）里换成与它有关的几组（时间与画面、窗口与对话框、剧情对话、养成、新手教程）。
// 这里只“列出”键，不另外定义快捷键：每一条都对应已有的处理（全局快捷键 shell/hotkeys.ts、倍速键 hooks/useSpeedKeys.ts、交易所的列表、窗口的 Esc、
// 剧情对话框的方向键、航行视图的 useSteerKeys、教程气泡）。
// - 只在新界面（v2）里有；旧界面（v1）什么都不挂，按“?”也没有反应（v1 维持原样）。
// - 触屏（pointer: coarse）上不打开：小键帽在触屏上本来就不显示，那里也很少有键盘。
// - 输入框里打字、或者已经有别的模态对话框开着时，“?”照常是字符 / 不理会。
// - 打开时焦点在“关上”上；Esc、再按一次“?”、点遮罩都关上；Tab 不出这张卡；关上后焦点回到原处。
// - 桌面上是居中的纸卡（与确认对话框同一套外观），窄屏上从底部升起。
// - 用鼠标的玩家也找得到：功能窗口标题栏上有一颗“?”小键帽（ShortcutHelpButton，Window.tsx），点它也打开这张卡。
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { t, type StringKey } from "../../i18n";
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd } from "./KeyHints";
import { closeShortcutHelp, openShortcutHelp, useShortcutHelp } from "./shortcutHelpState";

/** 一条的说明：两张表里都有的键（StringKey），或先只写了中文的键（{ zh: ZhOnlyKey }，i18n/zhOnly.ts）。 */
type Label = StringKey | { zh: ZhOnlyKey };

function labelText(l: Label): string {
  return typeof l === "string" ? t(l) : tz(l.zh);
}

/** 一条：几组可以互换的键（如 A D 或 ← →），可带一个要同时按住的修饰键（Shift）。 */
interface ShortcutItem {
  keys: readonly (readonly string[])[];
  mod?: string;
  label: Label;
}

/** 哪个画面里列出这一组（缺省两处都列）。 */
type HelpContext = "game" | "upbringing";

interface ShortcutGroup {
  title: Label;
  items: readonly ShortcutItem[];
  only?: HelpContext;
}

/** 现有的键盘操作（按用途分组）。处理它们的代码见文件开头的说明；改了那边的键，这里跟着改。
 * 卡片里两列、按行排：短的几组在前，长的交易所与手动航行放在最后一行并排（行高相近，少留空白）。 */
const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: { zh: "hk.group.time" },
    items: [
      { keys: [["Space"]], label: { zh: "hk.pause" } },
      { keys: [["1", "2", "3"]], label: { zh: "hk.speed" } },
      { keys: [["M"]], label: { zh: "hk.stage" } },
    ],
    only: "game",
  },
  {
    title: { zh: "hk.group.time" },
    items: [{ keys: [["Space"]], label: { zh: "hk.ub.pause" } }],
    only: "upbringing",
  },
  {
    title: "v2.fb.sc.window",
    items: [
      { keys: [["Esc"]], label: "v2.fb.sc.close" },
      { keys: [["Enter"]], label: { zh: "hk.enter" } },
      { keys: [["?"]], label: "v2.fb.sc.help" },
    ],
  },
  {
    title: { zh: "hk.group.story" },
    items: [
      { keys: [["ArrowUp", "ArrowDown"]], label: { zh: "hk.story.move" } },
      { keys: [["Enter"]], label: { zh: "hk.story.pick" } },
      { keys: [["Esc"]], label: { zh: "hk.story.later" } },
    ],
  },
  {
    title: { zh: "hk.group.ub" },
    items: [
      { keys: [["Enter"]], label: { zh: "hk.ub.go" } },
      { keys: [["Esc"]], label: { zh: "hk.ub.closeMenu" } },
    ],
    only: "upbringing",
  },
  {
    title: "v2.fb.sc.tutorial",
    items: [
      { keys: [["ArrowLeft", "ArrowRight"]], label: "v2.fb.sc.steps" },
      { keys: [["Esc"]], label: "v2.fb.sc.endTutorial" },
    ],
  },
  {
    title: "v2.fb.sc.market",
    only: "game",
    items: [
      { keys: [["ArrowUp", "ArrowDown"]], label: "v2.fb.sc.pick" },
      { keys: [["ArrowLeft", "ArrowRight"], ["+", "−"]], label: "v2.fb.sc.qty" },
      { mod: "Shift", keys: [["ArrowLeft", "ArrowRight"]], label: "v2.fb.sc.ten" },
      { keys: [["Enter"]], label: "v2.fb.sc.settle" },
      { keys: [["Space"]], label: "v2.fb.sc.detail" },
      { keys: [["Backspace"]], label: "v2.fb.sc.clear" },
      { keys: [["Home", "End"]], label: "v2.fb.sc.ends" },
    ],
  },
  {
    title: "v2.fb.sc.nav",
    only: "game",
    items: [
      { keys: [["A", "D"], ["ArrowLeft", "ArrowRight"]], label: "v2.fb.sc.steer" },
      { keys: [["W", "S"], ["ArrowUp", "ArrowDown"]], label: "v2.fb.sc.sail" },
      { keys: [["Space"]], label: "v2.fb.sc.pause" },
      { keys: [["Tab"]], label: "v2.fb.sc.world" },
    ],
  },
];

/** 键盘事件来自输入框（查找框、数量、存档名）时“?”只是一个字符。 */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** 已经有别的模态对话框（剧情、确认框、海战……）开着。 */
function otherModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') !== null;
}

/** 触屏为主的设备（与样式表里藏起小键帽的条件相同）。 */
function coarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function Combo({ keys }: { keys: readonly string[] }) {
  return (
    <span className="v2-keys-combo">
      {keys.map((k) => (
        <Kbd key={k} k={k} />
      ))}
    </span>
  );
}

function Row({ item }: { item: ShortcutItem }) {
  return (
    <div className="v2-shortcuts-row">
      <dt>
        {item.mod && (
          <>
            <Kbd k={item.mod} />
            <span className="v2-shortcuts-sep" aria-hidden="true">
              +
            </span>
          </>
        )}
        {item.keys.map((combo, i) => (
          <span key={combo.join(" ")} className="v2-shortcuts-alt">
            {i > 0 && (
              <span className="v2-shortcuts-sep" aria-hidden="true">
                /
              </span>
            )}
            <Combo keys={combo} />
          </span>
        ))}
      </dt>
      <dd>{labelText(item.label)}</dd>
    </div>
  );
}

/** 主界面里按“?”打开的全部快捷键（v2）。挂在 GameShell 里（养成画面挂在 UpbringingShell 里，context="upbringing"）。 */
export function ShortcutHelp({ context = "game" }: { context?: HelpContext } = {}) {
  const v2 = useIsV2();
  const open = useShortcutHelp((s) => s.open);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!v2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (typing(e.target) || otherModalOpen() || coarsePointer()) return;
      e.preventDefault();
      openShortcutHelp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v2]);

  useEffect(() => {
    if (!open) return;
    // 打开时焦点放在“关上”上；关上后还给原来的元素
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!v2 || !open || typeof document === "undefined") return null;
  const close = closeShortcutHelp;
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 卡片里的按键不传给下面的界面（交易所的回车、窗口的 Esc）
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // 卡片里只有一个按钮：焦点留在它上面
      e.preventDefault();
      closeRef.current?.focus();
    }
  };

  return createPortal(
    <div
      className="modal v2-confirm-backdrop v2-shortcuts-backdrop"
      data-testid="shortcut-help"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-body v2-confirm v2-shortcuts" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="v2-confirm-grip" aria-hidden="true" />
        <h2 id={titleId} className="v2-confirm-title">
          {t("v2.fb.sc.title")}
        </h2>
        <p className="v2-shortcuts-lead">{t("v2.fb.sc.lead")}</p>
        <div className="v2-shortcuts-groups">
          {SHORTCUT_GROUPS.filter((g) => !g.only || g.only === context).map((g) => (
            <section key={labelText(g.title)} className="v2-shortcuts-group" aria-label={labelText(g.title)}>
              <h3>{labelText(g.title)}</h3>
              <dl>
                {g.items.map((it) => (
                  <Row key={labelText(it.label)} item={it} />
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="row v2-confirm-actions">
          <button ref={closeRef} type="button" className="btn" onClick={close}>
            {t("v2.fb.sc.closeCard")}
            <Kbd k="Esc" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 功能窗口标题栏上的“?”小键帽：点它打开全部快捷键。只在新界面、用鼠标时出现（触屏上样式表把它藏起来）；旧界面什么都不画。 */
export function ShortcutHelpButton() {
  const v2 = useIsV2();
  if (!v2) return null;
  return (
    <button type="button" className="gw-keys" aria-label={t("v2.fb.sc.title")} title={t("v2.fb.sc.button")} onClick={openShortcutHelp}>
      <Kbd k="?" />
    </button>
  );
}
