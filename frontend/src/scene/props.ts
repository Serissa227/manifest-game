// 街景合成专用的小图：挡土墙与岸壁的砌石、系缆桩、小划艇、城门楼（备用画法）、城外田野、前景草地、悬停描边。
// 这些只在港口街景里用到，所以放在 scene/ 而不是 art/；画法同样遵守 docs/ART.md：
// 共享调色板、光源在左上、描边用最暗一阶、只用确定性随机。
import { baseStyle, seedTag, type ArchStyle, type TownStyle } from "../art/buildings";
import { P, ink, overlay } from "../art/palette";
import { Px } from "../art/px";
import { memo } from "../art/render";
import { rng } from "../art/rng";
import type { Climate } from "../art/scenery";

/** 各风格的砌石材质（由暗到亮）：挡土墙、岸壁、城门楼。 */
export function wallRamp(style: ArchStyle): readonly string[] {
  switch (style) {
    case "mediterranean":
      // 浅暖色的石灰华，与白墙相配
      return [P.plaster[0], P.parchmentDark, P.parchment, P.paper, P.white];
    case "frontier":
      return P.stone.slice(0, 4);
    case "lowland":
      return P.brick;
    case "desert":
    case "islands":
      // 群岛的珊瑚石与沙漠的砂岩都偏暖，和茅草、土坯协调
      return P.sand;
    case "nordic":
      return P.stone.slice(0, 4);
    default:
      return P.stone;
  }
}

/**
 * 砌石墙面：错缝的石块，每块左上受光、右下为灰缝阴影。
 * 同一 seed 画出同样的石块明暗。
 */
export function masonry(w: number, h: number, ramp: readonly string[], seed: string, bw = 10, bh = 5): Px {
  const n = ramp.length;
  const mortar = ramp[Math.max(0, n - 4)];
  const face = ramp[n - 3];
  const faceHi = ramp[n - 2];
  const edge = ramp[n - 1];
  const p = new Px(w, h).fill(mortar);
  const r = rng(seed);
  for (let row = 0; row * bh < h; row++) {
    const off = row % 2 ? Math.floor(bw / 2) : 0;
    for (let bx = -off; bx < w; bx += bw) {
      const y = row * bh;
      const lighter = r.chance(0.22);
      const darker = !lighter && r.chance(0.18);
      const f = darker ? mortar : lighter ? faceHi : face;
      p.rect(bx, y, bw - 1, bh - 1, f);
      // 顶边与左边受光
      p.hline(bx, bx + bw - 2, y, darker ? face : lighter ? edge : faceHi);
      if (!darker) p.vline(bx, y, y + bh - 2, lighter ? edge : faceHi);
    }
  }
  return p;
}

/**
 * 上下两街之间的挡土墙：顶部压顶石 + 砌石 + 底部的阴影与苔痕。
 * 高 h；snow 时压顶石上积雪。
 */
export function terraceWall(w: number, h: number, style: ArchStyle, seed: string, snow: boolean, season = 0): Px {
  return memo(`scene-terrace|${w}|${h}|${style}|${seed}|${snow}|${season}`, () => {
    const ramp = wallRamp(style);
    const n = ramp.length;
    // 墙面比建筑暗一阶，上下两街的层次才分得开
    const dark = ramp.slice(0, n - 1);
    const p = new Px(w, h).blit(masonry(w, h, dark, `terrace-${seed}`, 12, 6), 0, 0);
    const r = rng(`terrace-${seed}`);
    // 排水孔：每隔一段一个小黑洞，下方一道水渍
    for (let x = r.int(10, 30); x < w - 6; x += r.int(34, 60)) {
      const y = r.int(12, 22);
      p.rect(x, y, 3, 2, ink.deep).vline(x + 1, y + 2, y + 2 + r.int(4, 9), dark[0]);
    }
    // 越往下越暗：墙脚被下街建筑遮挡的阴影
    p.dither(0, h - 12, w, 5, overlay.shadowLight, 1);
    p.dither(0, h - 7, w, 7, overlay.shadow, 2);
    // 压顶石（用原色阶，比墙面亮）
    p.rect(0, 0, w, 3, ramp[n - 2]);
    p.hline(0, w - 1, 0, ramp[n - 1]);
    p.hline(0, w - 1, 3, ramp[Math.max(0, n - 5)] ?? ink.deep);
    p.dither(0, 4, w, 2, overlay.shadow, 2);
    // 从压顶石垂下的藤蔓（按季节换色；寒冷的冬天没有）
    const vine: readonly string[] | null = snow
      ? null
      : style === "desert"
        ? null
        : season === 2
          ? [P.autumn[0], P.autumn[1], P.autumn[2]]
          : season === 3
            ? [P.leaf[0], P.leaf[1], P.straw[1]]
            : [P.leaf[1], P.leaf[2], P.leaf[3]];
    if (vine) {
      for (let x = r.int(0, 20); x < w - 4; x += r.int(18, 44)) {
        const len = r.int(5, 16);
        const width = r.int(3, 7);
        for (let i = 0; i < width; i++) {
          const l = Math.max(2, len - Math.abs(i - width / 2) * 3 + r.int(-2, 2));
          for (let y = 3; y < 3 + l; y++) {
            if ((x + i + y) % 3 === 0 && y > 4) continue;
            p.set(x + i, y, y < 5 ? vine[2] : (x + i + y) % 2 ? vine[1] : vine[0]);
          }
        }
        p.set(x + 1, 3, vine[2]).set(x + 2, 4, vine[2]);
      }
    }
    if (snow) {
      p.hline(0, w - 1, 0, P.snow[3]);
      p.hline(0, w - 1, 1, P.snow[2]);
      for (let x = 0; x < w; x += r.int(3, 7)) p.set(x, 2, P.snow[1]);
    }
    return p;
  });
}

/**
 * 从下街通往上街的石阶（沿挡土墙斜上，左下起右上止），带扶栏。宽 w 高 h。
 */
export function stairs(w: number, h: number, style: ArchStyle, snow: boolean): Px {
  return memo(`scene-stairs|${w}|${h}|${style}|${snow}`, () => {
    const ramp = wallRamp(style);
    const n = ramp.length;
    const p = new Px(w, h);
    const steps = Math.max(4, Math.floor(h / 4));
    const run = w / steps;
    for (let i = 0; i < steps; i++) {
      const x0 = Math.round(i * run);
      const y0 = h - (i + 1) * 4;
      // 台阶的踏面（亮）与踢面（暗），下面填实成斜坡
      p.rect(x0, y0, w - x0, 4, ramp[n - 3]);
      p.hline(x0, x0 + Math.ceil(run), y0, snow ? P.snow[3] : ramp[n - 1]);
      p.hline(x0, x0 + Math.ceil(run), y0 + 1, ramp[n - 2]);
      p.vline(x0, y0, y0 + 3, ramp[Math.max(0, n - 4)]);
    }
    // 阶梯侧面的阴影与扶栏
    p.dither(0, 0, w, h, overlay.shadowLight, 1);
    p.line(0, h - 12, w - 1, -8, P.wood[2]);
    p.line(0, h - 11, w - 1, -7, P.wood[1]);
    for (let i = 1; i < steps; i += 3) {
      const x = Math.round(i * run);
      const y = h - (i + 1) * 4;
      p.vline(x, y - 8, y - 1, P.wood[1]);
    }
    return p;
  });
}

/** 大气透视：把一张图的不透明像素向远景色混合 t（0–1），用于远处的船。 */
export function hazed(src: Px, key: string, color: string, t: number): Px {
  return memo(`scene-haze|${key}|${color}|${t}`, () => {
    const out = src.clone();
    const c = Number.parseInt(color.slice(1, 7), 16);
    const cr = (c >> 16) & 0xff;
    const cg = (c >> 8) & 0xff;
    const cb = c & 0xff;
    for (let i = 0; i < out.data.length; i++) {
      const v = out.data[i];
      const a = v & 0xff;
      if (!a) continue;
      const r = Math.round(((v >>> 24) & 0xff) * (1 - t) + cr * t);
      const g = Math.round(((v >>> 16) & 0xff) * (1 - t) + cg * t);
      const b = Math.round(((v >>> 8) & 0xff) * (1 - t) + cb * t);
      out.data[i] = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    }
    return out;
  });
}

/**
 * 岸壁：大块条石的码头边，顶上有系缆桩，贴近水面处有深色苔痕。宽 w 高 h。
 */
export function quayWall(w: number, h: number, style: ArchStyle, seed: string, snow: boolean): Px {
  return memo(`scene-quay|${w}|${h}|${style}|${seed}|${snow}`, () => {
    const s = style;
    const ramp = s === "islands" || s === "desert" ? wallRamp(s) : P.stone;
    const n = ramp.length;
    const p = new Px(w, h).blit(masonry(w, h, ramp, `quay-${seed}`, 14, 4), 0, 0);
    // 压顶条石：亮边 + 下方阴影线
    p.rect(0, 0, w, 2, ramp[n - 2]);
    p.hline(0, w - 1, 0, ramp[n - 1]);
    p.hline(0, w - 1, 2, ramp[Math.max(0, n - 4)]);
    // 水线附近的苔痕与湿痕
    p.dither(0, h - 3, w, 3, P.leaf[1], 2);
    p.hline(0, w - 1, h - 1, P.leaf[0]);
    if (snow) p.hline(0, w - 1, 0, P.snow[3]);
    // 系缆桩（铁）：每隔 36 像素一个，立在压顶石上方由调用方另画；这里只画桩脚的铁环
    for (let x = 18; x < w - 4; x += 36) {
      p.set(x, 3, P.iron[1]).set(x + 1, 3, P.iron[1]).set(x, 4, P.iron[0]);
    }
    return p;
  });
}

/** 系缆桩（5×5，立在岸壁或栈桥上）。 */
export function bollard(): Px {
  return memo("scene-bollard", () =>
    new Px(5, 5)
      .rect(1, 1, 3, 4, P.iron[2])
      .rect(0, 0, 5, 2, P.iron[2])
      .hline(0, 4, 0, P.iron[3])
      .vline(3, 2, 4, P.iron[1])
      .hline(0, 4, 1, P.iron[1])
      .set(4, 0, P.iron[1]),
  );
}

/** 小划艇（侧视，约 24×8），系在岸边或栈桥下；variant 决定船身颜色。 */
export function rowboat(variant: number): Px {
  return memo(`scene-rowboat|${variant % 3}`, () => {
    const hull = [P.wood, P.teal, P.red][variant % 3];
    const p = new Px(26, 9);
    // 船身：两头上翘
    p.poly(
      [
        [1, 3],
        [25, 2],
        [22, 8],
        [4, 8],
      ],
      hull[2],
    );
    p.hline(2, 24, 3, hull[3]);
    p.hline(2, 24, 4, hull[1]);
    p.rect(4, 7, 18, 1, hull[1]);
    // 船舷内侧（深色）与横座板
    p.hline(3, 23, 2, P.wood[0]);
    p.rect(12, 1, 3, 2, P.wood[3]);
    // 船桨斜放
    p.line(6, 0, 17, 3, P.wood[3]);
    return p.outlined(ink.brown);
  });
}

/** 旗帜（挂在杆上，frame 0..3 飘动），宽约 9 高 6。 */
export function pennant(color: string, frame: number): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`scene-pennant|${color}|${f}`, () => {
    const p = new Px(10, 7);
    const wave = [0, 1, 1, 0][f];
    for (let x = 0; x < 9; x++) {
      const dy = (x + f) % 4 < 2 ? 0 : 1;
      const len = 5 - Math.floor(x / 3);
      p.vline(x + 1, 1 + dy * wave, dy * wave + len, color);
    }
    p.vline(0, 0, 6, P.wood[1]);
    return p;
  });
}

/**
 * 城门楼（备用画法：buildings.ts 尚未提供时使用）。约 46×104：砌石塔身、拱形门洞、开着的木门、垛口与势力旗。
 * 砌石按粗分的风格；望楼的屋顶颜色按城镇风格（第九批的文化风格各有屋顶色）。
 */
export function gateTower(style: TownStyle, flag: string): Px {
  return memo(`scene-gate|${style}|${flag}`, () => {
    const s = style;
    const ramp = wallRamp(baseStyle(s));
    const n = ramp.length;
    const w = 46;
    const h = 104;
    const p = new Px(w, h);
    const bodyTop = 16;
    p.blit(masonry(w - 4, h - bodyTop, ramp, `gate-${seedTag(s)}`, 8, 5), 2, bodyTop);
    // 右侧背光
    p.dither(w - 10, bodyTop, 8, h - bodyTop, overlay.shadow, 2);
    p.rect(w - 4, bodyTop, 2, h - bodyTop, overlay.shadow);
    // 垛口
    for (let x = 0; x < w; x += 8) p.rect(x, bodyTop - 6, 5, 6, ramp[n - 2]).hline(x, x + 4, bodyTop - 6, ramp[n - 1]);
    p.rect(0, bodyTop - 1, w, 3, ramp[n - 3]).hline(0, w - 1, bodyTop - 1, ramp[n - 1]);
    // 顶上的小望楼屋顶（按风格取色）
    const roof = {
      eastern: P.jade,
      nordic: P.slate,
      lowland: P.brick,
      desert: P.sand,
      islands: P.straw,
      mediterranean: P.brick,
      frontier: P.wood,
      japanese: P.stone,
      ming: P.brick,
      ottoman: P.slate,
      swahili: P.straw,
      malay: P.straw,
      maya: P.straw,
    }[s];
    p.poly(
      [
        [10, bodyTop - 6],
        [23, bodyTop - 16],
        [36, bodyTop - 6],
      ],
      roof[2],
    );
    p.line(10, bodyTop - 6, 23, bodyTop - 16, roof[roof.length - 1]);
    p.hline(10, 36, bodyTop - 6, roof[0]);
    // 旗杆与旗
    p.vline(23, 0, bodyTop - 16, P.wood[1]);
    p.rect(24, 1, 8, 5, flag).hline(24, 31, 1, "#ffffff55");
    // 箭窗
    for (const [x, y] of [
      [12, 30],
      [32, 30],
      [22, 48],
    ] as const) {
      p.rect(x, y, 2, 6, ink.deep).set(x, y - 1, ramp[0]);
    }
    // 拱形门洞与开着的门
    const gx = 13;
    const gw = 20;
    const gTop = h - 30;
    p.rect(gx, gTop + 6, gw, h - gTop - 6, ink.deep);
    p.ellipse(gx + gw / 2 - 0.5, gTop + 6, gw / 2 - 0.5, 6, ink.deep);
    // 门洞里的远处亮光（城外）
    p.rect(gx + 4, gTop + 8, gw - 8, h - gTop - 8, P.sky[3]);
    p.dither(gx + 4, gTop + 8, gw - 8, h - gTop - 8, P.leaf[3], 2);
    p.rect(gx + 4, h - 6, gw - 8, 6, P.sand[3]);
    // 门扇
    p.rect(gx, gTop + 8, 4, h - gTop - 8, P.wood[1]).vline(gx, gTop + 8, h - 1, P.wood[2]);
    p.rect(gx + gw - 4, gTop + 8, 4, h - gTop - 8, P.wood[0]);
    // 拱石
    p.ring(gx + gw / 2 - 0.5, gTop + 6, gw / 2 + 0.5, 7, ramp[n - 1]);
    return p.outlined(ramp[0]);
  });
}

/**
 * 城外的田野（城门外、道路两旁）：按季节换色的条田、树篱与抖动过渡。宽 w 高 h（上远下近）。
 */
export function fields(w: number, h: number, climate: Climate, season: number, snow: boolean, seed: string): Px {
  return memo(`scene-fields|${w}|${h}|${climate}|${season}|${snow}|${seed}`, () => {
    const p = new Px(w, h);
    const r = rng(`fields-${seed}`);
    const crop: readonly string[] =
      snow
        ? [P.snow[1], P.snow[2], P.snow[3]]
        : climate === "arid"
          ? [P.sand[2], P.sand[3], P.sand[4]]
          : season === 1
            ? [P.gold[1], P.gold[2], P.straw[3]]
            : season === 2
              ? [P.autumn[1], P.straw[2], P.autumn[3]]
              : season === 3
                ? [P.straw[0], P.straw[1], P.leaf[1]]
                : [P.leaf[2], P.leaf[3], P.leaf[4]];
    let y = 0;
    let band = 3;
    while (y < h) {
      const c = r.pick(crop);
      p.rect(0, y, w, band, c);
      // 垄沟
      if (!snow) p.dither(0, y + band - 1, w, 1, crop[0], 2);
      // 树篱
      if (r.chance(0.35) && !snow) p.hline(0, w - 1, y, climate === "arid" ? P.sand[1] : P.leaf[1]);
      y += band;
      band = Math.min(12, band + r.int(1, 3));
    }
    // 远处与天空交界处加一层薄雾
    p.dither(0, 0, w, 3, overlay.fog, 2);
    return p;
  });
}

/**
 * 内陆城市的前景草地（街面以下）：季节色草地、花丛、一段木栅栏。
 */
export function verge(w: number, h: number, climate: Climate, season: number, snow: boolean, seed: string): Px {
  return memo(`scene-verge|${w}|${h}|${climate}|${season}|${snow}|${seed}`, () => {
    const r = rng(`verge-${seed}`);
    const grass: readonly string[] = snow
      ? [P.snow[0], P.snow[1], P.snow[2], P.snow[3]]
      : climate === "arid"
        ? [P.sand[1], P.sand[2], P.sand[3], P.sand[4]]
        : season === 2
          ? [P.autumn[0], P.straw[1], P.straw[2], P.autumn[3]]
          : season === 3
            ? [P.leaf[0], P.leaf[1], P.straw[1], P.straw[2]]
            : [P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4]];
    const p = new Px(w, h).fill(grass[1]);
    // 近处更暗（下方），远处更亮
    p.dither(0, 0, w, 16, grass[2], 1);
    p.dither(0, h - 10, w, 10, grass[0], 2);
    // 草丛：成簇的亮色短竖线
    for (let i = 0; i < w / 4; i++) {
      const x = r.int(0, w - 1);
      const y = r.int(14, h - 3);
      p.vline(x, y - 2, y, grass[3]).set(x + 1, y - 1, grass[2]).set(x - 1, y, grass[2]);
    }
    // 花（春夏）
    if (!snow && (season === 0 || season === 1) && climate !== "arid") {
      for (let i = 0; i < w / 10; i++) {
        const x = r.int(0, w - 2);
        const y = r.int(16, h - 4);
        const c = r.pick([P.blossom[1], P.blossom[2], P.gold[3], P.white]);
        p.set(x, y, c).set(x + 1, y, c).set(x, y - 1, c).set(x, y + 1, P.leaf[1]);
      }
    }
    // 街沿的路缘石
    p.rect(0, 0, w, 3, P.stone[2]).hline(0, w - 1, 0, P.stone[3]).hline(0, w - 1, 3, P.stone[0]);
    for (let x = r.int(0, 8); x < w; x += r.int(10, 16)) p.vline(x, 0, 2, P.stone[1]);
    // 路边的矮篱：温带是修剪成团的灌木，干旱地区是土坯矮墙，积雪时是雪堆
    if (snow) {
      for (let x = -4; x < w; x += r.int(10, 18)) p.ellipse(x, 6, r.int(6, 10), 3, P.snow[3]).hline(x - 4, x + 4, 8, P.snow[1]);
    } else if (climate === "arid") {
      p.rect(0, 4, w, 7, P.sand[2]).hline(0, w - 1, 4, P.sand[4]).hline(0, w - 1, 5, P.sand[3]).hline(0, w - 1, 10, P.sand[0]);
      for (let x = r.int(4, 20); x < w; x += r.int(26, 50)) p.rect(x, 6, 4, 3, P.sand[1]);
    } else {
      const hedge = season === 2 ? [P.autumn[0], P.autumn[1], P.autumn[2]] : [P.leaf[0], P.leaf[1], P.leaf[2]];
      for (let x = -4; x < w; x += r.int(7, 11)) {
        const rr = r.int(4, 6);
        p.ellipse(x, 9, rr, 5, hedge[1]).ellipse(x - 1, 8, rr - 2, 3, hedge[2]).set(x - 2, 6, P.leaf[3]);
      }
      p.hline(0, w - 1, 13, hedge[0]).dither(0, 12, w, 2, hedge[0], 2);
    }
    return p;
  });
}

/** 悬停高亮：沿建筑轮廓外侧画两像素宽的亮描边（内亮外暗）。返回的图比原图四周各大 2 像素。 */
export function glowRing(src: Px, key: string): Px {
  return memo(`scene-glow|${key}`, () => {
    const d1 = src.outlined(P.lamp[2]);
    const d2 = d1.outlined(P.gold[2]);
    const out = new Px(d2.w, d2.h);
    for (let y = 0; y < d2.h; y++) {
      for (let x = 0; x < d2.w; x++) {
        if (src.isOpaque(x - 2, y - 2)) continue;
        const v = d2.get(x, y);
        if (v & 0xff) out.put(x, y, v);
      }
    }
    return out;
  });
}

/** 纯色矩形小图（天空与地面之间的过渡、底色等）。 */
export function block(w: number, h: number, color: string): Px {
  return memo(`scene-block|${w}|${h}|${color}`, () => new Px(Math.max(1, w), Math.max(1, h)).fill(color));
}

/**
 * 挡土墙的端头：转角处上下交错的隅石（大小石块交替）+ 顶上的压顶石。宽 7 高 h。
 */
export function terraceEnd(h: number, style: ArchStyle, snow: boolean): Px {
  return memo(`scene-terrace-end|${h}|${style}|${snow}`, () => {
    const ramp = wallRamp(style);
    const n = ramp.length;
    const p = new Px(8, h);
    for (let y = 0, i = 0; y < h; i++) {
      const bh = i % 2 ? 5 : 7;
      const bw = i % 2 ? 6 : 8;
      p.rect(0, y, bw, bh - 1, ramp[n - 2]);
      p.hline(0, bw - 1, y, ramp[n - 1]);
      p.vline(bw - 1, y, y + bh - 2, ramp[Math.max(0, n - 4)]);
      p.hline(0, bw - 1, y + bh - 1, ramp[Math.max(0, n - 5)] ?? ramp[0]);
      y += bh;
    }
    p.dither(0, h - 6, 8, 6, overlay.shadow, 2);
    if (snow) p.rect(0, 0, 8, 2, P.snow[3]);
    return p.outlined(ramp[0]);
  });
}

/**
 * 远方海岬与灯塔（贴在海平线上，带大气透视的淡色）。约 76×34。
 */
export function farHeadland(climate: Climate, snow: boolean): Px {
  return memo(`scene-headland|${climate}|${snow}`, () => {
    const w = 76;
    const h = 34;
    const p = new Px(w, h);
    const base = h - 1;
    // 岩岬剪影：左低右高，远处的颜色偏向天空
    const rock = climate === "arid" ? [P.sand[1], P.sand[2]] : [P.stone[1], P.stone[2]];
    p.poly(
      [
        [0, base + 1],
        [10, base - 4],
        [26, base - 7],
        [40, base - 12],
        [52, base - 13],
        [64, base - 9],
        [76, base - 6],
        [76, base + 1],
      ],
      rock[1],
    );
    p.poly(
      [
        [30, base + 1],
        [44, base - 10],
        [56, base - 11],
        [70, base - 5],
        [76, base + 1],
      ],
      rock[0],
    );
    // 岬顶的草或雪
    const top = snow ? P.snow[2] : climate === "arid" ? P.sand[3] : P.leaf[2];
    p.line(10, base - 4, 26, base - 7, top).line(26, base - 7, 40, base - 12, top).line(40, base - 12, 52, base - 13, top);
    // 大气透视：整体蒙一层天色
    p.dither(0, base - 14, w, 15, P.sky[3] + "88", 2);
    // 灯塔：白塔红箍，顶上灯室
    const lx = 46;
    const ly = base - 13;
    p.rect(lx, ly - 16, 5, 16, P.white);
    p.vline(lx + 4, ly - 16, ly - 1, P.plaster[1]);
    p.rect(lx, ly - 12, 5, 2, P.red[2]).rect(lx, ly - 6, 5, 2, P.red[2]);
    p.rect(lx - 1, ly - 19, 7, 3, P.iron[1]).rect(lx, ly - 18, 5, 1, P.lamp[1]);
    p.poly(
      [
        [lx - 1, ly - 19],
        [lx + 2.5, ly - 23],
        [lx + 6, ly - 19],
      ],
      P.red[1],
    );
    // 灯塔旁的小屋
    p.rect(lx + 6, ly - 4, 6, 4, P.plaster[2]).hline(lx + 5, lx + 12, ly - 5, P.red[1]);
    return p;
  });
}

/** 浮标（红白两色，4×7）。 */
export function buoy(): Px {
  return memo("scene-buoy", () =>
    new Px(5, 8)
      .rect(1, 2, 3, 4, P.red[2])
      .rect(1, 4, 3, 1, P.white)
      .vline(1, 2, 5, P.red[3])
      .vline(2, 0, 1, P.iron[1])
      .set(2, 0, P.lamp[1])
      .hline(0, 4, 6, P.red[1])
      .hline(0, 4, 7, "#d8f4f880"),
  );
}
