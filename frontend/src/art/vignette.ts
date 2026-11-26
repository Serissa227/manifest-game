// 航行小画面的昼夜与天气（EXPANSION.md §9.3）：在航海图模块的 drawSeaVignette（白天晴）基础上，
// 天空按时段与天况换色（夜里有星与月，黎明、黄昏有低低的日轮），云与海面按时段、天况调色，
// 叠加雨丝（暴风雨更密、浪更大、整体更暗）、雪花与雾带。白天晴天时原样返回航海图模块的画面。
import { drawSeaVignette, VIGNETTE_FRAMES } from "./map";
import { P } from "./palette";
import { memo } from "./render";
import { Px, rgba } from "./px";
import {
  drawFogLayer,
  drawRainLayer,
  drawSnowLayer,
  fogOffset,
  gradeColor,
  skyStops,
  SNOW_FRAMES,
  type TimeOfDay,
  type Weather,
} from "./scenery";
import { bands, h2, mix } from "./scenery/util";

export interface VignetteOpts {
  time?: TimeOfDay;
  weather?: Weather;
  /** 风的东西分量 −1..1：雨丝、雪花朝风的去向斜落 */
  windX?: number;
  /** 季节 0–3（天空的季节色；缺省夏） */
  season?: number;
}

export interface Vignette {
  px: Px;
  horizon: number;
  waterline: number;
  /** 船的起伏倍数：暴风雨浪大（2），雨天稍大，其余为 1 */
  swell: number;
}

const CLOUD_COLORS = new Set([rgba(P.white), rgba(P.snow[2]), rgba(P.snow[1])]);
/** 海平线上远岛的颜色：天空换色时保留（只调色）。 */
const ISLAND = rgba(P.sea[1]);

/** 航行小画面（不含船）：frame 以 VIGNETTE_FRAMES 为周期。 */
export function drawVoyageVignette(w: number, h: number, frame: number, opts: VignetteOpts = {}): Vignette {
  const time = opts.time ?? "day";
  const weather = opts.weather ?? "clear";
  const swell = weather === "storm" ? 2 : weather === "rain" ? 1.4 : 1;
  const f = ((Math.floor(frame) % VIGNETTE_FRAMES) + VIGNETTE_FRAMES) % VIGNETTE_FRAMES;
  const base = drawSeaVignette(w, h, f);
  if (time === "day" && weather === "clear") return { ...base, swell };
  const wx = Math.round(Math.max(-1, Math.min(1, opts.windX ?? 0.5)) * 2) / 2;
  const season = opts.season ?? 1;
  const { horizon, waterline } = base;
  const px = memo(`voyage-vignette:${w}x${h}:${f}:${time}:${weather}:${wx}:${season}`, () => {
    const p = base.px.clone();
    // 天空：色带换成当前时段与天况的天空，云按时段调色
    const sky = new Px(w, Math.max(1, horizon));
    bands(sky.data, w, 0, sky.h, skyStops({ season, time, weather }), 0.5);
    for (let y = 0; y < horizon; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = p.data[i];
        if (v === ISLAND) p.data[i] = gradeColor(v, time, weather);
        else if (CLOUD_COLORS.has(v)) p.data[i] = weather === "storm" || weather === "rain" ? gradeColor(mix(v, P.stone[2], 0.5), time, weather) : gradeColor(v, time, weather);
        else p.data[i] = sky.data[i];
      }
    }
    if (weather === "clear" || weather === "cloudy") {
      if (time === "night") {
        // 几颗星与一弯新月
        for (let k = 0; k < Math.floor(w / 9); k++) {
          const x = Math.floor(h2(0x7e01, k) * w);
          const y = Math.floor(h2(0x7e02, k) * horizon * 0.8);
          if (weather === "clear" || k % 3 === 0) p.put(x, y, k % 4 === 0 ? P.white : P.snow[1]);
        }
        const mx = Math.floor(w * 0.78);
        p.put(mx, 3, P.snow[2]).put(mx + 1, 2, P.snow[2]).put(mx + 1, 3, P.snow[3]).put(mx + 1, 4, P.snow[2]).put(mx, 4, P.snow[1]);
      } else if (time === "dusk" || time === "dawn") {
        // 贴近海平线的日轮：黄昏在西（左），黎明在东（右）
        const sx = time === "dusk" ? Math.floor(w * 0.2) : Math.floor(w * 0.8);
        const c = time === "dusk" ? P.lamp[1] : P.lamp[2];
        p.ellipse(sx, horizon - 2, 3, 2, c);
        p.hline(sx - 1, sx + 1, horizon - 4, P.white);
      }
    }
    // 海面：按时段与天况调色
    for (let i = horizon * w; i < p.data.length; i++) p.data[i] = gradeColor(p.data[i], time, weather);
    if (weather === "storm") {
      // 暴风雨：浪尖泛白、浪更多
      const foam = gradeColor(P.foam, time, weather);
      for (let row = 0; row < 3; row++) {
        const y = horizon + 2 + row * Math.max(3, Math.floor((h - horizon - 3) / 3));
        const step = 7 + row * 2;
        const off = (f * (row + 2)) % step;
        for (let x = -step; x < w + step; x += step) {
          const xx = x + off;
          p.hline(xx, xx + 2 + row, y, foam);
          p.hline(xx + 1, xx + 3 + row, y + 1, gradeColor(P.sea[0], time, weather));
        }
      }
    }
    // 天气叠加层
    const fx = { time, windX: wx, heavy: weather === "storm" };
    if (weather === "rain" || weather === "storm") {
      // 小画面里格子少，叠两层错开的雨丝才显得出雨势
      p.blit(drawRainLayer(w, h, f, fx), 0, 0);
      p.blit(drawRainLayer(w, h, f + 3, fx), 7, -5);
    }
    if (weather === "snow") p.blit(drawSnowLayer(w, h, f * (SNOW_FRAMES / VIGNETTE_FRAMES), fx), 0, 0);
    if (weather === "fog") {
      const fog = memo(`voyage-fog:${w}x${h}:${time}`, () =>
        drawFogLayer(w, h, {
          time,
          bands: [
            { cy: horizon, hh: 4, k: 0.9 },
            { cy: waterline + 3, hh: 3, k: 0.5 },
          ],
        }),
      );
      p.blit(fog, -fogOffset(f * 6, wx < 0 ? -1 : 1, 1), 0);
    }
    return p;
  });
  return { px, horizon, waterline, swell };
}
