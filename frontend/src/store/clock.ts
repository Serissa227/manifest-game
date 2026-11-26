// 当前时钟（EXPANSION.md §9.2）：独立的小 store，不放进主 game store——运行中每 ≥100 ms 就会更新一次，
// 放在这里只让读取时刻的组件（useClock）重渲染，不牵动整个界面。
//
// 两个来源：
// - 概览（开局、读档、每日 tick 推送、命令返回、测试里直接设置）：概览变化时同步。暂停时以概览为准（开局、读档可以倒退）；
//   运行中只前进——比当前时钟旧的概览（迟到的命令返回）不把 clock 事件推进过的时钟拨回去。
// - 后端的 `clock` 事件 `{ day, minute }`：只前进，迟到的旧推送被忽略。
import { create } from "zustand";
import type { ClockView, Overview } from "../ipc/types";
import { DAY_START_MINUTE, DEFAULT_MINUTE, MINUTES_PER_DAY, normMinute, setLiveDayMs } from "../time/daylight";
import { useGame } from "./game";

export interface ClockStore {
  day: number;
  /** 当天时刻，分钟 0–1439 */
  minute: number;
  /** 当前倍速与最近一次确认分钟的本机时刻，只供画面插值；命令仍使用 minute。 */
  speed: number;
  sampledAt: number;
  /** H10b：后端给的“现在一天多少毫秒”（0 = 暂停或旧后端没给）与是否海上口径。 */
  dayMs: number;
  seaClock: boolean;
  /** 按概览同步（没有 minute 字段的旧后端取 8:00；没有概览时回到第 0 天 8:00）。 */
  syncOverview: (o: Overview | null) => void;
  /** 后端的 clock 事件：只接受晚于当前时钟的推送。 */
  applyClock: (c: ClockView) => void;
}

/** 时刻戳：先比日期，再比从当天 6:00 起走过的分钟（游戏日从 6:00 到次日 5:59，午夜不是日界线）。 */
export function clockStamp(day: number, minute: number): number {
  return day * MINUTES_PER_DAY + ((normMinute(minute) - DAY_START_MINUTE + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

function validDay(day: unknown): day is number {
  return typeof day === "number" && Number.isFinite(day) && day >= 0;
}

export const useClockStore = create<ClockStore>((set, get) => ({
  day: 0,
  minute: DEFAULT_MINUTE,
  speed: 0,
  sampledAt: performance.now(),
  dayMs: 0,
  seaClock: false,
  syncOverview: (o) => {
    const s = get();
    const dayMs = o && typeof o.day_ms === "number" && Number.isFinite(o.day_ms) ? Math.max(0, o.day_ms) : 0;
    const seaClock = o?.sea_clock === true;
    setLiveDayMs(o && Number.isFinite(o.speed) ? Math.max(0, o.speed) : 0, dayMs);
    if (dayMs !== s.dayMs || seaClock !== s.seaClock) set({ dayMs, seaClock });
    const day = o && validDay(o.day) ? Math.floor(o.day) : 0;
    const minute = normMinute(o?.minute ?? DEFAULT_MINUTE);
    const speed = o && Number.isFinite(o.speed) ? Math.max(0, o.speed) : 0;
    if (day === s.day && minute === s.minute && speed === s.speed) return;
    // 运行中：概览只能让时钟前进
    if (o && o.speed > 0 && clockStamp(day, minute) < clockStamp(s.day, s.minute)) {
      if (speed !== s.speed) set({ speed, sampledAt: performance.now() });
      return;
    }
    set({ day, minute, speed, sampledAt: performance.now() });
  },
  applyClock: (c) => {
    if (!c || !validDay(c.day) || typeof c.minute !== "number" || !Number.isFinite(c.minute)) return;
    const s = get();
    // H10b：时钟推送也带 day_ms / sea_clock（出港、靠港时日长会变）；只在给了时更新
    if (typeof c.day_ms === "number" && Number.isFinite(c.day_ms)) {
      const dayMs = Math.max(0, c.day_ms);
      const seaClock = c.sea_clock === true;
      setLiveDayMs(s.speed, dayMs);
      if (dayMs !== s.dayMs || seaClock !== s.seaClock) set({ dayMs, seaClock });
    }
    const day = Math.floor(c.day);
    const minute = normMinute(c.minute);
    if (clockStamp(day, minute) <= clockStamp(s.day, s.minute)) return;
    set({ day, minute, sampledAt: performance.now() });
  },
}));

// 概览变化时同步时钟：setOverview（开局、读档、tick 推送、命令返回）与直接 setState 都经过这里。
useClockStore.getState().syncOverview(useGame.getState().overview);
useGame.subscribe((s, prev) => {
  if (s.overview !== prev.overview) useClockStore.getState().syncOverview(s.overview);
});
