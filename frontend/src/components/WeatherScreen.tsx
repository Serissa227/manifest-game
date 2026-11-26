// 玩家所在处的全画面天气：旗舰队（手动航行的世界里也是它）在海上、
// 所在海区当天是暴风雨时，整个海图视口（含航行 HUD 背后）出现雨幕、压暗与闪电（闪白很短、间隔 5–13 秒，不晃眼）；
// 下雨时轻一些、不闪电；起雾时四周一层淡雾；下雪时飘雪。驶出后淡出。停泊在港、港口街景与养成画面不加。
//
// 摆放：航海图（MapView）里一份（世界图：海图画布之上，左侧栏、缩放按钮与对话框之下），航行视图（NavigationView）里一份
// （航行海图之上、仪表与罗经盘之下）；航行视图盖着世界图时世界图那一份不画。整层不接收指针事件，不挡点海面、点港口。
//
// 画法（像素风）：两张低分辨率画布按整像素放大（image-rendering: pixelated）——一个像素块至少 2 个 CSS 像素、按设备像素取整对齐，
// 画布像素数有上限（大屏时像素块更大，手机上限更低）。底下一张是静止的压暗：四边三级台阶的暗角（圆角矩形，不用渐变与抖动噪点）；
// 上面一张逐帧画雨线 / 雪片与闪电。闪电照亮是一层冷白的 div，只改它的不透明度。颜色取海图与夜航的配色（夜里雨线压暗偏蓝）。
// 性能与无障碍：requestAnimationFrame，页面隐藏时停；雨线数随视口面积与设备像素比有上限（手机更少）；系统要求减少动态效果时
// 只画一帧静止的压暗与雨线纹理、不闪电、不淡入淡出；4× 及以上不闪电；天况在 4× 及以上至少停留 2 秒才换（与航行小画面同一规则）；
// 设置里“天气特效”关掉时不画。纯逻辑在 map/weatherFx.ts。
import { useEffect, useMemo, useRef, useState } from "react";
import { drawLightningBolt, drawRainStreak, drawSnowFlake, type FxTone } from "../art/map";
import type { Px } from "../art/px";
import { toCanvas } from "../art/render";
import { h2 } from "../art/scenery/util";
import { useScenePhase } from "../hooks/useClock";
import { navActive, useNavStore } from "../hooks/useNavigation";
import { isCompact, useLayout } from "../hooks/useViewport";
import {
  DropPool,
  FALL_RAIN,
  FALL_SNOW,
  FALL_STORM,
  LightningClock,
  dropBudget,
  dropShape,
  playerSky,
  screenCanvas,
  screenFx,
  vignetteAlpha,
  vignetteBand,
  type Drop,
  type FallKind,
  type ScreenFx,
} from "../map/weatherFx";
import { setScreenFlash, takeFlashRequest } from "../map/weatherFlash";
import { useWeatherFxPref } from "../map/weatherPref";
import { useGame } from "../store/game";
import { useHeldWeather, windXOf } from "./port/sceneLook";
import { usePageHidden, usePrefersReducedMotion } from "./portrait/motion";

/** 驶出后淡出的时长（毫秒；与样式里的淡出动画一致）。 */
export const SCREEN_FADE_MS = 900;
/** 闪电照亮最亮时的不透明度（冷白，闪白很短，不晃眼）。 */
export const SCREEN_FLASH_ALPHA = 0.22;
/** 闪电照亮的颜色（与航行小画面的闪电同一种冷白）。 */
const FLASH_COLOR = "#ecf2ff";
/** 闪电的形状种类（按第几次闪电轮换）。 */
const BOLT_VARIANTS = 8;

/** 画面时段 → 雨线的色调。 */
function toneOf(phase: string): FxTone {
  if (phase === "night") return "night";
  return phase === "dusk" || phase === "dawn" ? "dusk" : "day";
}

/** "#rrggbb" → [r, g, b]。 */
function rgbOf(c: string): [number, number, number] {
  const v = Number.parseInt(c.slice(1, 7), 16);
  return [(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function fallKind(fx: ScreenFx): FallKind {
  return fx.fall === "snow" ? FALL_SNOW : fx.heavy ? FALL_STORM : FALL_RAIN;
}

/** 雨线 / 雪片的小图（画布，按形状缓存）。 */
function dropArt(cache: Map<string, HTMLCanvasElement | null>, d: Pick<Drop, "kind" | "len" | "run" | "dir" | "near">, tone: FxTone): HTMLCanvasElement | null {
  const key = d.kind === FALL_SNOW ? `s:${d.near ? 1 : 0}` : `r:${d.len}:${d.run}:${d.dir}:${d.near ? 1 : 0}`;
  let c = cache.get(key);
  if (c === undefined) {
    const px: Px = d.kind === FALL_SNOW ? drawSnowFlake(d.near, tone) : drawRainStreak(d.len, d.run, d.dir, tone, d.near);
    c = toCanvas(px);
    cache.set(key, c);
  }
  return c;
}

interface CanvasProps {
  fx: ScreenFx;
  tone: FxTone;
  windX: number;
  phone: boolean;
  hidden: boolean;
}

/** 两张画布与闪电照亮：底下静止的压暗（静止模式连雨线一起），上面逐帧的雨线与闪电。 */
function ScreenCanvases({ fx, tone, windX, phone, hidden }: CanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const dims = screenCanvas(size.w, size.h, dpr, phone);

  // 画布大小跟随视口
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const sync = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // 底下一张：压暗的暗角（静止模式另画一层钉住的雨线）。只在尺寸、天况、色调变了时画一次
  useEffect(() => {
    const c = base.current;
    const ctx = c?.getContext("2d") ?? null;
    if (!c || !ctx || dims.w <= 0 || dims.h <= 0) return;
    c.width = dims.w;
    c.height = dims.h;
    const img = ctx.createImageData(dims.w, dims.h);
    const [r, g, b] = rgbOf(fx.tint);
    const alphas = [0, 1, 2, 3].map((band) => Math.round(vignetteAlpha(band, fx.center, fx.edge) * 255));
    const d = img.data;
    for (let y = 0; y < dims.h; y++) {
      for (let x = 0; x < dims.w; x++) {
        const i = (y * dims.w + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = alphas[vignetteBand(x, y, dims.w, dims.h)];
      }
    }
    ctx.putImageData(img, 0, 0);
    if (fx.still && fx.fall) {
      // 减少动态效果：一帧静止的雨线纹理（按画布上的网格用哈希摆，每次一样）
      ctx.imageSmoothingEnabled = false;
      const kind = fallKind(fx);
      const n = dropBudget(size.w, size.h, dpr, phone, fx.density);
      const g = Math.max(4, Math.round(Math.sqrt((dims.w * dims.h) / Math.max(1, n))));
      const cache = new Map<string, HTMLCanvasElement | null>();
      for (let gy = 0; gy * g < dims.h; gy++) {
        for (let gx = 0; gx * g < dims.w; gx++) {
          const near = h2(0x5c01, gx, gy) < 0.45;
          const shape = dropShape(kind, near, windX, h2(0x5c02, gx, gy));
          const art = dropArt(cache, { kind, near, ...shape }, tone);
          if (art) ctx.drawImage(art, Math.floor((gx + h2(0x5c03, gx, gy)) * g), Math.floor((gy + h2(0x5c04, gx, gy)) * g));
        }
      }
    }
  }, [dims.w, dims.h, fx, tone, windX, size.w, size.h, dpr, phone]);

  // 上面一张：逐帧的雨线、雪片与闪电（静止模式、页面隐藏、没有画布时不跑）
  useEffect(() => {
    const c = top.current;
    const ctx = c?.getContext("2d") ?? null;
    const glow = flash.current;
    if (!c || !ctx || dims.w <= 0 || dims.h <= 0 || fx.still || hidden || typeof requestAnimationFrame !== "function") {
      setScreenFlash(0);
      return;
    }
    c.width = dims.w;
    c.height = dims.h;
    ctx.imageSmoothingEnabled = false;
    const pool = new DropPool();
    const clock = new LightningClock();
    const kind = fx.fall ? fallKind(fx) : null;
    const target = kind === null ? 0 : dropBudget(size.w, size.h, dpr, phone, fx.density);
    const cache = new Map<string, HTMLCanvasElement | null>();
    // 新的一滴：画布上任意处（左右各多出一点，斜落的雨线从边上进来）
    const spawn = (rng: () => number) => (kind === null ? null : { x: rng() * (dims.w + 24) - 12, y: rng() * (dims.h + 8) - 8, kind, wind: windX });
    let last = -1;
    let seq = 0;
    let bolt: { art: HTMLCanvasElement | null; x: number } | null = null;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last < 0 ? 0 : now - last;
      last = now;
      pool.step(dt, target, spawn, 1);
      ctx.clearRect(0, 0, dims.w, dims.h);
      for (const d of pool.drops) {
        const art = dropArt(cache, d, tone);
        if (art) ctx.drawImage(art, Math.round(d.x), Math.round(d.y));
      }
      // 截图与调试要求的那一次一定劈下一道
      const asked = takeFlashRequest() && fx.lightning;
      if (asked) clock.trigger();
      const f = clock.step(dt, fx.lightning);
      if (f > 0 && clock.seq !== seq) {
        seq = clock.seq;
        // 七成的闪电劈下一道（从画面上沿往下，高约画面的四成），其余只照亮
        if (asked || Math.random() < 0.7) {
          const h = Math.min(160, Math.max(24, Math.round((dims.h * 0.42) / 8) * 8));
          const art = toCanvas(drawLightningBolt(h, seq % BOLT_VARIANTS));
          bolt = { art, x: Math.round(dims.w * (0.12 + Math.random() * 0.76)) };
        } else bolt = null;
      }
      if (!clock.flashing) bolt = null;
      if (bolt?.art && f > 0) ctx.drawImage(bolt.art, bolt.x - Math.floor(bolt.art.width / 2), 0);
      if (glow) glow.style.opacity = String(f * SCREEN_FLASH_ALPHA);
      setScreenFlash(f);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      setScreenFlash(0);
      if (glow) glow.style.opacity = "0";
      ctx.clearRect(0, 0, dims.w, dims.h);
    };
  }, [dims.w, dims.h, fx, tone, windX, hidden, size.w, size.h, dpr, phone]);

  const style = { width: `${dims.cssW}px`, height: `${dims.cssH}px` };
  return (
    <div ref={box} className="wx-screen-box">
      <canvas ref={base} className="wx-screen-base" width={dims.w} height={dims.h} style={style} data-testid="weather-screen-base" />
      <canvas ref={top} className="wx-screen-fall" width={dims.w} height={dims.h} style={style} />
      <div ref={flash} className="wx-screen-flash" style={{ backgroundColor: FLASH_COLOR, opacity: 0 }} />
    </div>
  );
}

/**
 * 全画面天气。layer：世界图（chart）还是航行视图（nav）里的那一份——航行视图盖着世界图时世界图那一份不画。
 */
export default function WeatherScreen({ layer }: { layer: "chart" | "nav" }) {
  // 按字段选取（P14a）：只取倍速、玩家头顶的天况、当地风向与“是不是在手动航行”这几个值——都是原始值，没变就不重渲染
  const speed = useGame((s) => s.overview?.speed ?? 0);
  const sky = useGame((s) => playerSky(s.overview));
  const windDir = useGame((s) => s.overview?.local_weather?.wind_dir ?? null);
  const navOn = useGame((s) => navActive(s.statics, s.overview));
  const navView = useNavStore((s) => s.view);
  const enabled = useWeatherFxPref((s) => s.on);
  const reduced = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const phase = useScenePhase();
  const phone = isCompact(useLayout());
  const windX = windDir !== null ? windXOf(windDir) : 0;
  // 防闪烁：4× 及以上天况至少停留 2 秒才换（驶进驶出也一样）
  const held = useHeldWeather({ sky: sky ?? undefined, windX, windStrength: undefined, source: sky ? "local" : "none" }, speed);
  const covered = layer === "chart" && navOn && navView === "nav";
  const fx = covered ? null : screenFx(held.sky ?? null, { enabled, reduced, speed });
  const fxKey = fx ? `${fx.sky}|${fx.lightning ? 1 : 0}|${fx.still ? 1 : 0}` : "";

  // 驶出后淡出：效果没了以后再留一会儿（减少动态效果、开关关掉、换到航行视图时立即收起）
  const latest = useRef<ScreenFx | null>(fx);
  const [leaving, setLeaving] = useState<ScreenFx | null>(null);
  const quiet = reduced || !enabled || covered;
  useEffect(() => {
    const was = latest.current;
    latest.current = fx;
    if (fx || !was || quiet) {
      setLeaving(null);
      return;
    }
    setLeaving(was);
    const id = setTimeout(() => setLeaving(null), SCREEN_FADE_MS);
    return () => clearTimeout(id);
    // fx 每次渲染都是新对象：只按它的内容（fxKey）决定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxKey, quiet]);

  // 内容相同时用同一个效果对象（画布不必重画）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => fx, [fxKey]);
  const shown = fx ? stable : leaving;
  if (!shown) return null;
  return (
    <div
      className="wx-screen"
      data-testid="weather-screen"
      data-layer={layer}
      data-sky={shown.sky}
      data-state={fx ? "in" : "out"}
      data-lightning={shown.lightning && fx ? "on" : "off"}
      data-motion={shown.still ? "still" : "live"}
      aria-hidden="true"
    >
      <ScreenCanvases fx={shown} tone={toneOf(phase)} windX={windX} phone={phone} hidden={hidden} />
    </div>
  );
}
