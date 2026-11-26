// 航海图上按海区画当天的天气（PixiJS）：
// 暴风雨的海区压暗、斜落的雨线、偶尔的闪电照亮；雨轻一些；雾是一层淡雾；雪是飘落的雪片；晴天与多云不加东西。
//
// 图层：压暗与雾（under）在海图之上、天况小标记之下；雨线、雪片、闪电与照亮（over）在天况小标记之上。两层都在迷雾之下
// （未探索的海域看不见），地点、舰队、航线与界面都在上面，不挡点选（PixiJS 的这两层不接收指针事件）。
// 随地图平移缩放：压暗是按格的位图（与海图一起缩放、对齐海区，海区边缘分几级台阶渐淡）；雨线以海图坐标摆放，
// 画成 1–3 个 CSS 像素一格的“像素”（随镜头倍数取整），位置也对齐到这个像素格上。
// 数量有上限（视口里落着的雨线随视口面积、设备像素比与视野里下雨的比例增减，手机更少）；天气在 4× 及以上至少隔 2 秒才换一次
// （与航行小画面的防闪烁同一规则），换的时候新旧压暗交叉淡入淡出。
// 系统要求减少动态效果时只留静止的压暗与雨线（雨线钉在海上、不动），不闪电；“天气特效”关掉时整层不画。
// 纯逻辑（海区划分、渐淡、雨线池、闪电时钟、上限）在 weatherFx.ts。
import type { Container, Sprite, Texture } from "pixi.js";
import { drawLightningBolt, drawRainStreak, drawSnowFlake } from "../art/map";
import type { Px } from "../art/px";
import { h2 } from "../art/scenery/util";
import type { Overview } from "../ipc/types";
import type { ChartGrid } from "./weather";
import { screenFlash } from "./weatherFlash";
import {
  DropPool,
  FALL_SNOW,
  LightningClock,
  centersKey,
  dropBudget,
  dropShape,
  fxPixel,
  lightningAllowed,
  paintWeather,
  regionField,
  texelAt,
  weatherSignature,
  type Drop,
  type FallKind,
  type RegionField,
  type WeatherPaint,
} from "./weatherFx";

type Pixi = typeof import("pixi.js");

/** 天气特效的开关（由航海图按设置与系统偏好给出）。 */
export interface WeatherFxOptions {
  /** 设置里的“天气特效”开着 */
  enabled: boolean;
  /** 系统要求减少动态效果：只留静止的压暗与雨线，不闪电 */
  reduced: boolean;
  /** 海图自己闪电（玩家在暴风雨里时由全画面效果闪，海图跟着它一起亮，这里关掉免得各闪各的） */
  lightning: boolean;
}

/** 镜头：倍数、视野（海图像素）与视口（CSS 像素）。 */
export interface WeatherView {
  s: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cssW: number;
  cssH: number;
}

export interface WeatherLayerHost {
  /** 海图网格（'#' 为陆地） */
  grid: ChartGrid;
  /** 东西相连 */
  wrap: boolean;
  /** 海图的像素宽高与每格像素 */
  MW: number;
  MH: number;
  cell: number;
  /** 四周画框压着的格数（画框上不画天气） */
  frameCells: number;
  view(): WeatherView;
  /** 像素图 → 纹理（按键缓存，由渲染器统一释放） */
  tex(key: string, make: () => Px): Texture;
  /** 设备像素比 */
  dpr(): number;
  /** 手机（雨线更少） */
  phone(): boolean;
  /** 记账：压暗与照亮两张画布的字节数（map/memory.ts） */
  account?(bytes: number): void;
}

export interface WeatherLayer {
  /** 压暗与雾：海图之上、天况标记之下 */
  readonly under: Container;
  /** 雨线、雪片、闪电与照亮：天况标记之上（仍在迷雾之下） */
  readonly over: Container;
  /** 概览变了（各海区当天的天气、海区中心、速度）。 */
  update(o: Overview | null): void;
  /** 每帧：雨线下落、闪电、新旧压暗的交叉淡入淡出。 */
  frame(dtMs: number): void;
  /** 镜头变了：重估视野里下雨的比例（静止模式下重新摆雨线）。 */
  relayout(): void;
  setOptions(opts: WeatherFxOptions): void;
  destroy(): void;
}

/** 新旧压暗交叉淡入淡出的时长（毫秒）。 */
export const SHADE_FADE_MS = 900;
/** 4× 及以上天气至少隔这么久才换（同 components/port/sceneLook.ts 的 WEATHER_HOLD_MS）。 */
export const WEATHER_HOLD_MS = 2000;
/** 闪电照亮的颜色与最亮时的不透明度（冷白，不晃眼）。 */
export const FLASH_TINT = 0xdfe8ff;
export const FLASH_ALPHA = 0.3;
/** 海图上一道闪电的高（特效像素）。 */
const BOLT_H = 26;
/** 闪电的形状种类（按第几次闪电轮换，记忆化的图不会越积越多）。 */
const BOLT_VARIANTS = 8;

interface Shade {
  box: Container;
  textures: Texture[];
}

export function createWeatherLayer(PIXI: Pixi, host: WeatherLayerHost): WeatherLayer {
  const under = new PIXI.Container();
  const over = new PIXI.Container();
  const flashLayer = new PIXI.Container();
  const dropLayer = new PIXI.Container();
  const bolt = new PIXI.Sprite(PIXI.Texture.EMPTY);
  bolt.visible = false;
  flashLayer.visible = false;
  over.addChild(flashLayer, dropLayer, bolt);
  // 这两层不接收指针事件：点选港口与船队照旧
  under.eventMode = "none";
  over.eventMode = "none";
  under.interactiveChildren = false;
  over.interactiveChildren = false;

  let opts: WeatherFxOptions = { enabled: true, reduced: false, lightning: true };
  let field: RegionField | null = null;
  let paint: WeatherPaint | null = null;
  /** 已画上的天气签名、最近一次的概览数据（关掉时只记下，开着时再画） */
  let shownSig = "";
  let latest: { sig: string; o: Overview } | null = null;
  let clock = 0;
  let paintedAt = -Infinity;
  let speed = 0;
  let shade: Shade | null = null;
  let oldShade: Shade | null = null;
  let flash: Shade | null = null;
  let fade = 1;
  const pool = new DropPool();
  const sprites: Sprite[] = [];
  const lightning = new LightningClock();
  let boltSeq = 0;
  let boltOn = false;
  /** 视野里该落着的雨线数、视野里有没有暴风雨 */
  let budget = 0;
  let stormInView = false;

  const copies = host.wrap ? [-host.MW, 0, host.MW] : [0];

  /** RGBA → 最近邻缩放的画布纹理（没有 2D 画布时为 null）。 */
  const canvasTexture = (w: number, h: number, data: Uint8ClampedArray<ArrayBuffer>): Texture | null => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    const source = new PIXI.CanvasSource({ resource: c });
    source.scaleMode = "nearest";
    return new PIXI.Texture({ source });
  };

  /** 一张按纹素的位图铺满整张海图（环绕地图左右各多铺一份，共用纹理）。 */
  const makeShade = (t: Texture, step: number, parent: Container): Shade => {
    const box = new PIXI.Container();
    for (const off of copies) {
      const s = new PIXI.Sprite(t);
      s.position.set(off, 0);
      s.scale.set(host.cell * step);
      box.addChild(s);
    }
    parent.addChild(box);
    return { box, textures: [t] };
  };

  const dropShadeObj = (s: Shade | null) => {
    if (!s) return;
    s.box.destroy({ children: true });
    for (const t of s.textures) t.destroy(true);
  };

  const applyFade = () => {
    if (shade) shade.box.alpha = fade;
    if (oldShade) {
      oldShade.box.alpha = 1 - fade;
      if (fade >= 1) {
        dropShadeObj(oldShade);
        oldShade = null;
      }
    }
  };

  /** 视野里下雨的比例（8 × 8 个取样点，按浓度加权）→ 该落着几条雨线；顺便看视野里有没有暴风雨。 */
  const estimate = () => {
    budget = 0;
    stormInView = false;
    if (!paint) return;
    const v = host.view();
    const N = 8;
    let sum = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const px = v.x0 + ((i + 0.5) / N) * (v.x1 - v.x0);
        const py = v.y0 + ((j + 0.5) / N) * (v.y1 - v.y0);
        const t = texelAt(paint, px, py, host.cell, host.wrap ? host.MW : undefined);
        if (t < 0) continue;
        if (paint.fall[t]) sum += paint.level[t] / 255;
        if (paint.storm[t]) stormInView = true;
      }
    }
    budget = Math.round(dropBudget(v.cssW, v.cssH, host.dpr(), host.phone()) * (sum / (N * N)));
  };

  /** 在视野里找一处下雨的海面（按浓度取舍）。 */
  const spawn = (rng: () => number) => {
    if (!paint?.falls) return null;
    const v = host.view();
    for (let k = 0; k < 8; k++) {
      const x = v.x0 + rng() * (v.x1 - v.x0);
      const y = v.y0 + rng() * (v.y1 - v.y0);
      const t = texelAt(paint, x, y, host.cell, host.wrap ? host.MW : undefined);
      if (t < 0 || !paint.fall[t]) continue;
      if (rng() * 255 >= paint.level[t]) continue;
      return { x, y, kind: paint.fall[t] as FallKind, wind: paint.wind[t] };
    }
    return null;
  };

  const dropTexture = (d: Drop): Texture =>
    d.kind === FALL_SNOW
      ? host.tex(`fx-snow:${d.near ? 1 : 0}`, () => drawSnowFlake(d.near))
      : host.tex(`fx-rain:${d.len}:${d.run}:${d.dir}:${d.near ? 1 : 0}`, () => drawRainStreak(d.len, d.run, d.dir, "day", d.near));

  /** 把雨线池画成精灵：每个“特效像素” pix 个 CSS 像素，位置对齐到这个像素格上。 */
  const drawDrops = () => {
    const v = host.view();
    const pix = fxPixel(v.s);
    const k = pix / v.s;
    const list = pool.drops;
    while (sprites.length < list.length) {
      const sp = new PIXI.Sprite(PIXI.Texture.EMPTY);
      dropLayer.addChild(sp);
      sprites.push(sp);
    }
    const snap = (u: number) => (Math.round((u * v.s) / pix) * pix) / v.s;
    for (let i = 0; i < sprites.length; i++) {
      const sp = sprites[i];
      const d = list[i];
      if (!d) {
        sp.visible = false;
        continue;
      }
      sp.visible = true;
      sp.texture = dropTexture(d);
      sp.scale.set(k);
      sp.alpha = d.near ? 1 : 0.8;
      sp.position.set(snap(d.x), snap(d.y));
    }
  };

  /** 静止模式（减少动态效果）：雨线按海图上的网格钉在海面上（哈希决定位置与长短），平移时跟着海走，不动。 */
  const layoutStill = () => {
    pool.clear();
    if (paint?.falls) {
      const v = host.view();
      const full = dropBudget(v.cssW, v.cssH, host.dpr(), host.phone());
      const area = Math.max(1, (v.x1 - v.x0) * (v.y1 - v.y0));
      // 格距取 2 的幂：同一档缩放下格子不变，雨线钉在原处
      const g = Math.pow(2, Math.round(Math.log2(Math.max(2, Math.sqrt(area / Math.max(1, full))))));
      for (let gy = Math.floor(v.y0 / g); gy * g < v.y1; gy++) {
        for (let gx = Math.floor(v.x0 / g); gx * g < v.x1; gx++) {
          if (pool.drops.length >= full) break;
          const x = (gx + h2(0x3a01, gx, gy)) * g;
          const y = (gy + h2(0x3a02, gx, gy)) * g;
          const t = texelAt(paint, x, y, host.cell, host.wrap ? host.MW : undefined);
          if (t < 0 || !paint.fall[t] || h2(0x3a03, gx, gy) * 255 >= paint.level[t]) continue;
          const kind = paint.fall[t] as FallKind;
          const near = h2(0x3a04, gx, gy) < 0.45;
          const shape = dropShape(kind, near, paint.wind[t], h2(0x3a05, gx, gy));
          pool.drops.push({ x, y, vx: 0, vy: 0, age: 0, life: Infinity, kind, near, ...shape });
        }
      }
    }
    drawDrops();
  };

  /** 画上一天的天气：新的压暗淡入、旧的淡出（第一次与静止模式直接换上）。 */
  const applyPaint = (p: WeatherPaint, instant: boolean) => {
    paint = p;
    dropShadeObj(oldShade);
    oldShade = shade;
    shade = null;
    if (p.any) {
      const t = canvasTexture(p.w, p.h, p.rgba);
      if (t) shade = makeShade(t, p.step, under);
    }
    // 闪电照亮的遮罩：暴风雨的范围（白色，不透明度为渐淡的浓度）
    dropShadeObj(flash);
    flash = null;
    if (p.storms) {
      const data = new Uint8ClampedArray(p.w * p.h * 4);
      for (let i = 0; i < p.storm.length; i++) {
        if (!p.storm[i]) continue;
        data[i * 4] = 255;
        data[i * 4 + 1] = 255;
        data[i * 4 + 2] = 255;
        data[i * 4 + 3] = p.storm[i];
      }
      const t = canvasTexture(p.w, p.h, data);
      if (t) {
        flash = makeShade(t, p.step, flashLayer);
        flash.box.tint = FLASH_TINT;
      }
    }
    host.account?.((shade ? 1 : 0) * p.w * p.h * 4 + (flash ? 1 : 0) * p.w * p.h * 4);
    fade = instant || !oldShade ? 1 : 0;
    applyFade();
    estimate();
    if (opts.reduced) layoutStill();
  };

  /** 把最近一次的概览画上（开关关着时等开了再画；高速时至少隔 2 秒）。 */
  const sync = (force = false) => {
    if (!latest || !opts.enabled || latest.sig === shownSig) return;
    if (!force && !lightningAllowed(speed) && clock - paintedAt < WEATHER_HOLD_MS) return;
    const o = latest.o;
    const weather = o.weather ?? [];
    const centers = (o.winds ?? []).map((w) => ({ region: w.region, x: w.x, y: w.y }));
    if (!field || field.key !== centersKey(centers)) field = regionField(host.grid, centers, host.wrap, undefined, host.frameCells);
    const first = shownSig === "";
    shownSig = latest.sig;
    paintedAt = clock;
    applyPaint(paintWeather(field, weather), first || opts.reduced);
  };

  const clearAll = () => {
    paint = null;
    shownSig = "";
    dropShadeObj(shade);
    dropShadeObj(oldShade);
    dropShadeObj(flash);
    shade = oldShade = flash = null;
    pool.clear();
    drawDrops();
    bolt.visible = false;
    boltOn = false;
    host.account?.(0);
  };

  /** 闪电开始：在视野里暴风雨最浓的海面上找一处落下一道闪电（找不到就只照亮，不画闪电）。 */
  const placeBolt = () => {
    boltOn = false;
    if (!paint) return;
    const v = host.view();
    const rng = Math.random;
    for (let k = 0; k < 24; k++) {
      const x = v.x0 + (0.1 + rng() * 0.8) * (v.x1 - v.x0);
      const y = v.y0 + (0.25 + rng() * 0.7) * (v.y1 - v.y0);
      const t = texelAt(paint, x, y, host.cell, host.wrap ? host.MW : undefined);
      if (t < 0 || paint.storm[t] < 192) continue;
      const pix = fxPixel(v.s);
      const unit = pix / v.s;
      bolt.texture = host.tex(`fx-bolt:${BOLT_H}:${lightning.seq % BOLT_VARIANTS}`, () => drawLightningBolt(BOLT_H, lightning.seq % BOLT_VARIANTS));
      bolt.scale.set(unit);
      const snap = (u: number) => (Math.round((u * v.s) / pix) * pix) / v.s;
      bolt.position.set(snap(x - (bolt.texture.width * unit) / 2), snap(y - bolt.texture.height * unit));
      boltOn = true;
      return;
    }
  };

  return {
    under,
    over,
    update(o) {
      speed = o?.speed ?? 0;
      const weather = o?.weather ?? [];
      const winds = o?.winds ?? [];
      // 旧后端没有天气：什么都不画
      if (!o || weather.length === 0 || winds.length === 0) {
        latest = null;
        if (paint || shade) clearAll();
        return;
      }
      const centers = winds.map((w) => ({ region: w.region, x: w.x, y: w.y }));
      latest = { sig: `${weatherSignature(weather)}|${centersKey(centers)}`, o };
      sync();
    },
    frame(dt) {
      clock += dt;
      sync();
      const on = opts.enabled && !!paint;
      under.visible = on;
      over.visible = on;
      if (!on || !paint) return;
      if (fade < 1) {
        fade = opts.reduced ? 1 : Math.min(1, fade + dt / SHADE_FADE_MS);
        applyFade();
      }
      if (!opts.reduced) {
        const v = host.view();
        pool.step(dt, budget, spawn, fxPixel(v.s) / v.s);
        drawDrops();
      }
      // 闪电：海图自己的（看得见暴风雨、没在减少动态效果、4× 以下），以及全画面效果带着的
      const own = lightning.step(dt, opts.lightning && !opts.reduced && stormInView && lightningAllowed(speed));
      if (own > 0 && lightning.seq !== boltSeq) {
        boltSeq = lightning.seq;
        placeBolt();
      }
      const f = opts.reduced ? 0 : Math.max(own, stormInView ? screenFlash() : 0);
      flashLayer.visible = f > 0 && !!flash;
      flashLayer.alpha = f * FLASH_ALPHA;
      bolt.visible = boltOn && lightning.flashing;
      if (!lightning.flashing) boltOn = false;
    },
    relayout() {
      if (!paint) return;
      estimate();
      if (opts.reduced) layoutStill();
    },
    setOptions(next) {
      const was = opts;
      opts = { ...next };
      if (!opts.enabled) {
        under.visible = false;
        over.visible = false;
        bolt.visible = false;
        return;
      }
      // 刚打开：画上关着时攒下的最近一次天气（不等 2 秒）
      if (!was.enabled) sync(true);
      if (opts.reduced !== was.reduced && paint) {
        if (opts.reduced) {
          fade = 1;
          applyFade();
          layoutStill();
        } else {
          pool.clear();
          drawDrops();
        }
      }
    },
    destroy() {
      clearAll();
      under.destroy({ children: true });
      over.destroy({ children: true });
    },
  };
}
