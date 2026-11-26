// 当前时钟（EXPANSION.md §9.2）：界面各处用它取“今天第几天、几点几分”。
// 读独立的时钟 store（store/clock.ts）：它随概览同步、随后端的 `clock` 事件（运行中每 ≥100 ms）前进，
// 旧后端没有时刻时取 8:00。只有调用这个 hook 的组件随时钟重渲染。
import { useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { scenePhase, type Phase } from "../time/daylight";
import { useDaylightPref } from "../time/prefs";

export interface Clock {
  day: number;
  /** 当天时刻，分钟 0–1439 */
  minute: number;
}

/** 当前的日与时刻。 */
export function useClock(): Clock {
  const day = useClockStore((s) => s.day);
  const minute = useClockStore((s) => s.minute);
  return { day, minute };
}

/**
 * 画面应使用的光照时段：按时钟、速度（防闪烁）与“昼夜光影”偏好。
 * 只在时段变了时让组件重渲染：时钟运行中每 100 ms 推一次分钟，一天里时段只换四次——用它的港口街景、航行小画面、
 * 全画面天气不必跟着每一下重画（性能，11-10）。
 */
export function useScenePhase(): Phase {
  const speed = useGame((s) => s.overview?.speed ?? 0);
  const pref = useDaylightPref((s) => s.pref);
  return useClockStore((s) => scenePhase(s.minute, speed, pref));
}
