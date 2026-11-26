// 全局点击委托的判断（纯 DOM，测试直接检查）：一下点击该响什么。
// - 元素（或它的祖先）上写了 data-sfx：写 "none" 不响，写一个音效编号就响那个；
// - 禁用的按钮不响（disabled、aria-disabled="true"、在禁用的 fieldset 里）；
// - 页签（role="tab"）翻一页纸，其余按钮、链接“嗒”一下；
// - 少数改不了代码的地方在 QUIET 里列出（例如顶栏的速度按钮：速度变了由游戏状态的变化出声，免得同一下响两次）。
import { isSfxId, type SfxId } from "./events";

/** 算作“可点的”元素。 */
const CLICKABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], a[href], summary';

/** 点了不响的地方（这些地方的操作另有更具体的声音）。 */
export const QUIET: readonly string[] = [
  // 顶栏的暂停与倍速：速度变了由状态的变化出声（暂停、继续、加快、放慢）
  '[data-testid="speed"] button',
];

function disabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return !!el.closest("fieldset:disabled");
}

/** 一下点击该响的音效；不响为 null。 */
export function clickSfx(target: EventTarget | null): SfxId | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const t = target as Element;
  const el = t.closest(CLICKABLE);
  if (el && disabled(el)) return null;
  // data-sfx：最近的一个说了算——写在元素本身，或写在一组按钮外面的容器上（整组都按它）
  const tagged = t.closest("[data-sfx]");
  if (tagged) {
    const v = tagged.getAttribute("data-sfx");
    if (v === "none") return null;
    if (isSfxId(v)) return v;
  }
  if (!el) return null;
  if (QUIET.some((q) => el.matches(q))) return null;
  if (el.getAttribute("role") === "tab") return "tab";
  return "click";
}

/** 改了一个输入框（勾选框、单选、下拉）该响的音效；滑条另算（见 sliderStep）。 */
export function changeSfx(target: EventTarget | null): SfxId | null {
  const el = target as HTMLInputElement | HTMLSelectElement | null;
  if (!el || typeof (el as Element).closest !== "function") return null;
  if ((el as Element).closest('[data-sfx="none"]')) return null;
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox") return el.checked ? "toggleOn" : "toggleOff";
    if (el.type === "radio") return "click";
    return null;
  }
  if (el instanceof HTMLSelectElement) return "click";
  return null;
}

/** 滑条分成多少档（每过一档轻响一下）。 */
export const SLIDER_DETENTS = 20;

/** 滑条现在在第几档（0…SLIDER_DETENTS）与相对位置（0–1）；不是滑条为 null。 */
export function sliderStep(target: EventTarget | null): { step: number; frac: number } | null {
  const el = target as HTMLInputElement | null;
  if (!el || !(el instanceof HTMLInputElement) || el.type !== "range") return null;
  if (el.closest('[data-sfx="none"]')) return null;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const v = Number(el.value);
  if (!(max > min) || !Number.isFinite(v)) return null;
  const frac = Math.max(0, Math.min(1, (v - min) / (max - min)));
  return { step: Math.round(frac * SLIDER_DETENTS), frac };
}

/** 滑条的轻响随位置升高：最左 0.85 倍速、最右 1.2 倍速（约高六个半音）。 */
export function sliderRate(frac: number): number {
  return 0.85 + 0.35 * Math.max(0, Math.min(1, frac));
}
