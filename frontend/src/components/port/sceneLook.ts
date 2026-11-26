// 街景与航行小画面的当地天况与风（EXPANSION.md §9.3）。
// 街景：主角旗舰队停泊在此地时取 overview.local_weather；否则按地点停泊格所在海区（LocView.region）查 overview.weather；
// 有天气数据但查不到此地（内陆城市等）时为晴；旧后端完全没有天气数据时天况为 undefined（画面照旧：白天晴、寒冷港口冬季飘小雪）。
// 航行小画面：旗舰队在海上时 local_weather 就是它所在海区的天气。
import { useEffect, useRef, useState } from "react";
import type { Weather } from "../../art/scenery";
import { locById } from "../../ipc/byId";
import type { Overview, SkyKind, StaticView } from "../../ipc/types";
import { flagship } from "../../store/game";
import { lightingFollowsClock } from "../../time/daylight";

export interface SceneWeather {
  /** 天况；旧后端没有天气数据时为 undefined */
  sky: Weather | undefined;
  /** 风的东西分量 −1 / 0 / 1（风的去向）；没有数据时为 undefined */
  windX: number | undefined;
  /** 风力 0–10；没有数据时为 undefined */
  windStrength: number | undefined;
  /** 数据来源：旗舰队所在处、地点所在海区、没有（降级） */
  source: "local" | "region" | "none";
}

const SKIES: readonly SkyKind[] = ["clear", "cloudy", "rain", "fog", "storm", "snow"];

/** 后端的天况名 → 景物库的天况（不认识的按晴）。 */
export function weatherOfSky(sky: unknown): Weather {
  return SKIES.includes(sky as SkyKind) ? (sky as Weather) : "clear";
}

/** 风的去向 0–7（0 = 北，顺时针）→ 东西分量：东北、东、东南为 1，西南、西、西北为 −1，正北、正南为 0。 */
export function windXOf(dir: number): number {
  const d = ((Math.floor(Number.isFinite(dir) ? dir : 0) % 8) + 8) % 8;
  if (d === 0 || d === 4) return 0;
  return d < 4 ? 1 : -1;
}

function from(w: { sky: SkyKind; wind_dir: number; wind_strength: number }, source: SceneWeather["source"]): SceneWeather {
  return { sky: weatherOfSky(w.sky), windX: windXOf(w.wind_dir), windStrength: Math.max(0, Math.min(10, w.wind_strength)), source };
}

const NONE: SceneWeather = { sky: undefined, windX: undefined, windStrength: undefined, source: "none" };
const CLEAR: SceneWeather = { sky: "clear", windX: undefined, windStrength: undefined, source: "none" };

/** 街景所在地点的天况与风。 */
export function sceneWeather(statics: StaticView | null, overview: Overview | null, loc: number | null): SceneWeather {
  if (!overview || loc === null) return NONE;
  const local = overview.local_weather ?? null;
  const fleet = flagship(overview);
  if (local && fleet && fleet.docked === loc) return from(local, "local");
  const region = locById(statics, loc)?.region;
  const list = overview.weather;
  if (list && region !== null && region !== undefined) {
    const w = list.find((r) => r.region === region);
    if (w) return from(w, "region");
  }
  return list || local ? CLEAR : NONE;
}

/** 航行小画面的天况与风：旗舰队所在处（local_weather）。 */
export function voyageWeather(overview: Pick<Overview, "local_weather" | "weather"> | null): SceneWeather {
  const local = overview?.local_weather ?? null;
  if (local) return from(local, "local");
  return overview?.weather ? CLEAR : NONE;
}

/** 高速下天况变化的最短间隔（毫秒）：一天短于 2 秒时，天况至少停留这么久才换，免得雨、晴来回闪。 */
export const WEATHER_HOLD_MS = 2000;

/**
 * 防闪烁的天况：光照跟随时钟时（1×、2× 与暂停）天况一变就换；更高速时，两次变化至少相隔 WEATHER_HOLD_MS，
 * 期间的变化合并成最后一次。key 相同表示天况没有变化。
 */
export function useHeldWeather(w: SceneWeather, speed: number): SceneWeather {
  const key = `${w.sky ?? "-"}|${w.windX ?? "-"}|${w.windStrength ?? "-"}`;
  const hold = !lightingFollowsClock(speed);
  const [shown, setShown] = useState<{ key: string; w: SceneWeather }>({ key, w });
  const latest = useRef(w);
  const last = useRef(0);
  useEffect(() => {
    latest.current = w;
  });
  useEffect(() => {
    if (key === shown.key) return;
    const now = Date.now();
    const wait = hold ? last.current + WEATHER_HOLD_MS - now : 0;
    if (wait <= 0) {
      last.current = now;
      setShown({ key, w: latest.current });
      return;
    }
    const id = setTimeout(() => {
      last.current = Date.now();
      setShown({ key, w: latest.current });
    }, wait);
    return () => clearTimeout(id);
  }, [key, hold, shown.key]);
  // 不需要等待时当帧就用新天况（不必等下一次渲染）
  return key === shown.key || !hold ? w : shown.w;
}
