// 音效（界面、交易、航海、海战）：外壳在 App 中调用一次 useSfx()，战术海战的面板调用 useBattleSfx(战况)。
//
// 声音从哪里来（尽量不碰各面板的代码）：
// - 全局事件委托：点按钮“嗒”、页签翻页、勾选框的搭扣、滑条按档位轻响（元素上可以写 data-sfx="<编号>" 或 "none" 覆盖，见 ui.ts）；
// - 外壳与游戏的 store：功能窗口开关、切换舞台与港口设施、卷轴提示（存档、读档、一般的提示）、错误（钱不够、被拒）；
// - 游戏状态的差（detect.ts）：买入、卖出、全部卖出、出港、入港、修船、造船厂、雇船员、补给、存取款、改速度、海盗遭遇的自动结算；
// - 战术海战的战报：开炮、命中、落空、击沉、接舷。
// 播放器（player.ts）在配乐导演创建音频引擎时由 bindSfx 接上：浏览器要求先有一次用户操作才能出声，沿用导演的解锁；
// 总的静音同样静掉音效，只把音乐音量拖到 0 时音效照常。短乐句（出港、入港、发现、大赚）奏着时音效让一让（见 player.jingle）。
//
// 素材什么时候下载（全部 74 个文件约 393 KB）：一打开页面先下界面的素材（UI_SAMPLES），解锁音频后先解码界面的、再解码其余全部。
import { useEffect, useRef } from "react";
import { useShell } from "../../components/shell/shellState";
import type { Overview, TacticalBattle } from "../../ipc/types";
import { useGame } from "../../store/game";
import { errorEvent, messageEvent, newNotices, stateEvents, type StateEvent } from "./detect";
import { UI_SAMPLES, type SfxId } from "./events";
import { SaleBurst } from "./limit";
import { ALL_SAMPLES, prefetchSfx, SfxPlayer, type PlayOptions } from "./player";
import { changeSfx, clickSfx, sliderRate, sliderStep } from "./ui";

export { SfxPlayer } from "./player";
export type { SfxId } from "./events";

/** 用户操作之后多久之内，状态的变化算是这次操作引起的（毫秒）。 */
export const GESTURE_MS = 3000;
/** 开关窗口、切换舞台这类由 store 变化出声的：要在用户操作之后这么久之内（自动打开的窗口不响）。 */
const UI_GESTURE_MS = 500;
/** 一般的提示：前面这么久之内已经响过别的声音就不再响（交易、入港之后的卷轴提示不重复出声）。 */
const NOTIFY_QUIET_MS = 1200;

let player: SfxPlayer | null = null;

/** 接上（或断开）播放器：配乐导演创建音频引擎时调用。接上后先解码界面的素材，再解码其余的。 */
export function bindSfx(p: SfxPlayer | null): void {
  player = p;
  if (!p) return;
  void p.load(UI_SAMPLES).then(() => p.load(ALL_SAMPLES));
}

/** 当前的播放器（还没有用户操作、静音时为 null）。 */
export function sfxPlayer(): SfxPlayer | null {
  return player;
}

/** 放一个音效（没有播放器时什么也不做）。 */
export function sfx(id: SfxId, opts?: PlayOptions): boolean {
  return player?.play(id, opts) ?? false;
}

const stamp = () => player?.stamp ?? 0;

/** 状态的变化 → 音效。 */
function eventSfx(ev: StateEvent): SfxId | null {
  switch (ev) {
    case "buy":
    case "pay":
      return "buy";
    case "receive":
      return "sell";
    case "sale":
    case "saleMany":
      return null; // 由“一串卖出”决定
    default:
      return ev;
  }
}

/** 装上全局的事件委托与 store 订阅；返回卸下的函数。 */
export function attachSfx(): () => void {
  // 界面的素材很小（几十 KB），一打开页面就先下载，第一下点击就有声音
  prefetchSfx(UI_SAMPLES);
  let gestureAt = -Infinity;
  const burst = new SaleBurst();
  let lastSale = -Infinity;
  /** 这之前的概览变化不看（读档） */
  let skipUntil = -Infinity;
  const slider = new WeakMap<EventTarget, number>();
  const recent = (ms: number) => performance.now() - gestureAt <= ms;

  const onGesture = (e: Event) => {
    gestureAt = performance.now();
    // 按下滑条（或在它上面按方向键）时记下它原来在第几档：拖过下一档才响
    const s = sliderStep(e.target);
    if (s && e.target) slider.set(e.target, s.step);
  };
  // 点击：先记下点的是什么，等这一下点击的处理（React 的事件、store 的更新）都结束之后再决定——
  // 期间已经响过更具体的声音（打开窗口、切换舞台……）就不再“嗒”一下
  const onClick = (e: MouseEvent) => {
    const id = clickSfx(e.target);
    if (!id) return;
    const before = stamp();
    setTimeout(() => {
      if (stamp() === before) sfx(id);
    }, 0);
  };
  const onChange = (e: Event) => {
    const id = changeSfx(e.target);
    if (id) sfx(id);
  };
  const onInput = (e: Event) => {
    const s = sliderStep(e.target);
    if (!s || !e.target) return;
    const prev = slider.get(e.target);
    slider.set(e.target, s.step);
    if (prev !== undefined && prev !== s.step) sfx("slider", { rate: sliderRate(s.frac) });
  };
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  window.addEventListener("click", onClick, { capture: true });
  window.addEventListener("change", onChange, { capture: true });
  window.addEventListener("input", onInput, { capture: true });

  const onOverview = (prev: Overview | null, next: Overview | null) => {
    const now = performance.now();
    const events = stateEvents(prev, next, recent(GESTURE_MS) || now - lastSale <= 1500);
    for (const ev of events) {
      if (ev === "sale" || ev === "saleMany") {
        lastSale = now;
        const k = ev === "sale" ? burst.next(now) : burst.pour(now);
        if (k) sfx(k);
        continue;
      }
      // 改速度、暂停：同一刻已经有出港这类更大的声音时不再响（例如确认航线后自动以 1 倍速开始航行）
      if ((ev === "pause" || ev === "resume" || ev === "speedUp" || ev === "speedDown") && player && now - player.last.at < 400 && player.last.priority >= 2) continue;
      const id = eventSfx(ev);
      if (id) sfx(id);
    }
    if (newNotices(prev, next) > 0 && (!player || now - player.last.at > NOTIFY_QUIET_MS)) sfx("notify");
  };

  const offs = [
    () => window.removeEventListener("pointerdown", onGesture, { capture: true }),
    () => window.removeEventListener("keydown", onGesture, { capture: true }),
    () => window.removeEventListener("click", onClick, { capture: true }),
    () => window.removeEventListener("change", onChange, { capture: true }),
    () => window.removeEventListener("input", onInput, { capture: true }),
    useShell.subscribe((s, p) => {
      if (s.windowOpen !== p.windowOpen && recent(UI_GESTURE_MS)) sfx(s.windowOpen ? "open" : "close");
    }),
    useGame.subscribe((s, p) => {
      if ((s.stage !== p.stage || s.facility !== p.facility) && recent(UI_GESTURE_MS)) sfx("tab");
      // 错误与提示：文字变了才算（同一句还显示着时又来一次不重复出声——store 里分不出这是新的一次还是别的无关更新）
      if (s.error && s.error !== p.error) sfx(errorEvent(s.error));
      if (s.message && s.message !== p.message) {
        const m = messageEvent(s.message);
        // 读档：概览整个换了，前后的差不是这一局里发生的事（晚一步看概览的差时跳过）
        if (m === "load") skipUntil = performance.now() + 300;
        if (m !== "notify") sfx(m);
        else if (!player || performance.now() - player.last.at > NOTIFY_QUIET_MS) sfx("notify");
      }
      // 概览：等这一轮的其他订阅（配乐导演的短乐句）与紧接着的提示（读档）都处理完再看，短乐句奏着时音效才知道要让开
      if (s.overview !== p.overview) {
        const prev = p.overview;
        const next = s.overview;
        queueMicrotask(() => {
          if (performance.now() >= skipUntil) onOverview(prev, next);
        });
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** 由外壳在 App 中调用一次：装上音效的事件委托与订阅。 */
export function useSfx(): void {
  useEffect(() => attachSfx(), []);
}

// ───────────────────────────── 战术海战

/** 战报里的一件事对应的音效：什么时候（相对这一批的开头，秒）、声像、额外的音量。 */
export interface BattleCue {
  id: SfxId;
  at: number;
  pan: number;
  gain: number;
}

/**
 * 战报里新出现的条目 → 音效（纯函数）：开炮（随后 0.4 秒命中或落空）、击沉、接舷；一批里的几件事按先后错开 0.6 秒，最多 8 件。
 * 我方的船在左、敌船在右；敌方开炮远一点、轻一点。
 */
export function battleCues(prev: TacticalBattle | null, next: TacticalBattle | null): BattleCue[] {
  if (!prev || !next || prev.id !== next.id || next.log.length <= prev.log.length) return [];
  const mine = (unit: number) => next.units.find((u) => u.id === unit)?.player ?? false;
  const out: BattleCue[] = [];
  let t = 0;
  for (const [, e] of next.log.slice(prev.log.length, prev.log.length + 8)) {
    if (typeof e === "string") continue;
    if ("Fire" in e) {
      const ours = mine(e.Fire.from);
      out.push({ id: "fire", at: t, pan: ours ? -0.25 : 0.3, gain: ours ? 0 : -3 });
      out.push({ id: e.Fire.damage > 0 ? "hit" : "miss", at: t + 0.4, pan: ours ? 0.3 : -0.25, gain: ours ? -2 : 0 });
    } else if ("Sunk" in e) {
      out.push({ id: "sink", at: t + 0.2, pan: mine(e.Sunk.unit) ? -0.25 : 0.3, gain: 0 });
    } else if ("Board" in e) {
      out.push({ id: "board", at: t, pan: 0, gain: 0 });
    }
    t += 0.6;
  }
  return out;
}

/** 战术海战的面板调用：战况更新时，按战报里新出现的条目放炮声、命中、落空、击沉、接舷。 */
export function useBattleSfx(battle: TacticalBattle | null): void {
  const prev = useRef<TacticalBattle | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = battle;
    for (const c of battleCues(p, battle)) sfx(c.id, { delay: c.at, pan: c.pan, gain: c.gain });
  }, [battle]);
}
