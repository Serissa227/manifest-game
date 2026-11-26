// 全局快捷键（11-03 操作手感：“快捷、方便、现代化”）：主界面（GameShell）与养成画面（UpbringingShell）共用一套判断。
// 只在新界面（v2）里挂；旧界面（v1）维持原样。按“?”打开的全部快捷键（feedback/ShortcutHelp.tsx）列出这里的每一个键。
// - 空格：暂停 / 继续（主界面按最近一次运行时的倍速继续，与航行视图的空格同一个函数；养成画面只在这个月进行中时有效）。
//   手动航行时空格归航行视图（useSteerKeys），这里让开，免得一下暂停又继续。
// - Esc：关掉最上层。焦点在对话框或功能窗口里时由它们自己处理（原来就有）；焦点在外面（命令栏、舞台、页面空白处）时——
//   有对话框开着就把 Esc 交给最上层的对话框（等于在它里面按 Esc：剧情的“稍后再说”、确认框的“取消”……），
//   没有对话框时关掉功能窗口。新手教程进行中时不替它做主（教程自己的 Esc 是“结束教程”）。
// - 回车：焦点不在任何按钮、输入框上时，按下当前最上层里标了 data-hotkey="primary" 的那个主按钮（剧情的“继续”、结果的“关上”、
//   养成的“开始这个月”）。焦点在按钮上时回车照常按那个按钮。
// - M：港口街景与航海图之间切换（在海上时街景不可用，不做什么）。
// 共同的规矩：在输入框里打字、按着 Ctrl / Alt / ⌘、按键自动重复、别的处理已经 preventDefault 的，一律不管。
import { useEffect, useRef } from "react";

/** 键盘事件来自输入框（查找框、数量、存档名）或可编辑区域。 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** 挡住下面界面的对话框：模态对话框、确认框、海战这类 role="dialog" 的层（新手教程的说明框 aria-modal="false"，不算）。 */
const BLOCKING = '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]';

/** 页面上所有挡住下面界面的对话框（文档顺序；挂到 body 上的在后面，也就是在上面）。 */
function blockingLayers(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll<HTMLElement>(BLOCKING)];
}

/** 最上层的对话框（没有时为 null）。 */
export function topLayer(): HTMLElement | null {
  const all = blockingLayers();
  return all.length > 0 ? all[all.length - 1] : null;
}

/** 有挡住下面界面的对话框开着。 */
export function layerOpen(): boolean {
  return topLayer() !== null;
}

/** 新手教程正在进行（说明框挂着）。 */
function tutorialActive(): boolean {
  return typeof document !== "undefined" && document.querySelector('[data-testid="tutorial"]') !== null;
}

/** 这个元素在对话框或功能窗口里（它们自己处理 Esc）。 */
function insideLayer(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return el.closest(`${BLOCKING}, [data-testid="game-window"]`) !== null;
}

/** 焦点在可以操作的控件上（按钮、链接、下拉框、可聚焦的格子……）：回车、空格归它自己。 */
function onControl(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (isTyping(el)) return true;
  return el.closest('button, a[href], summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="slider"], [tabindex]:not([tabindex="-1"])') !== null;
}

/** 看得见、能按的主按钮（data-hotkey="primary"）：限定在最上层的对话框里，没有对话框时在整页里找；恰好一个时才算。 */
export function primaryButton(): HTMLButtonElement | null {
  if (typeof document === "undefined") return null;
  const scope: ParentNode = topLayer() ?? document;
  const found = [...scope.querySelectorAll<HTMLButtonElement>('[data-hotkey="primary"]')].filter(
    (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && b.closest("[hidden], [inert]") === null,
  );
  return found.length === 1 ? found[0] : null;
}

/** 修饰键、自动重复：都不当快捷键。 */
function plain(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;
}

function isSpace(e: KeyboardEvent): boolean {
  return e.key === " " || e.key === "Spacebar" || e.code === "Space";
}

export interface GlobalHotkeys {
  /** 空格：暂停 / 继续；null 时空格不管（例如养成画面在排日程时，播放键本来就不可用） */
  pause?: (() => void) | null;
  /** Esc 在没有对话框时：关掉功能窗口；null 时没有可关的 */
  closeWindow?: (() => void) | null;
  /** M：切换港口街景 / 航海图；null 时不切换 */
  toggleStage?: (() => void) | null;
  /** 空格这一刻归别人（手动航行的 useSteerKeys）时返回 true */
  spaceTaken?: () => boolean;
}

/** 在窗口上挂全局快捷键（enabled 为 false 时什么都不挂）。参数每次渲染都可以换，监听只挂一次。 */
export function useGlobalHotkeys(enabled: boolean, keys: GlobalHotkeys): void {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  useEffect(() => {
    if (!enabled) return;
    // 空格按下时做了暂停 / 继续：抬起时挡掉浏览器“按下焦点所在的按钮”（不然刚点过的命令栏按钮会再被按一次）
    let swallowSpaceUp = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !plain(e)) return;
      const k = ref.current;
      if (isSpace(e)) {
        if (isTyping(e.target) || layerOpen() || !k.pause || k.spaceTaken?.()) return;
        e.preventDefault();
        swallowSpaceUp = true;
        k.pause();
        return;
      }
      if (e.key === "Escape") {
        if (insideLayer(e.target) || tutorialActive()) return;
        const top = topLayer();
        if (top) {
          // 交给最上层的对话框：等于在它里面按了 Esc（它自己的处理决定是取消、稍后再说还是不理）
          e.preventDefault();
          top.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          return;
        }
        if (isTyping(e.target) || !k.closeWindow) return;
        e.preventDefault();
        k.closeWindow();
        return;
      }
      if (e.key === "Enter") {
        if (e.shiftKey || onControl(e.target)) return;
        const btn = primaryButton();
        if (!btn) return;
        e.preventDefault();
        btn.click();
        return;
      }
      if ((e.key === "m" || e.key === "M") && !e.shiftKey) {
        if (isTyping(e.target) || layerOpen() || !k.toggleStage) return;
        e.preventDefault();
        k.toggleStage();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (swallowSpaceUp && isSpace(e)) {
        swallowSpaceUp = false;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [enabled]);
}
