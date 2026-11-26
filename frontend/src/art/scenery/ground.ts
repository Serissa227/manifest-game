// 街道地面：东方青石板、北地粗石、低地砖路、沙漠夯土、群岛木板与沙地。
// 所有纹理都以图宽 w 为周期（石块在行内“绕一圈”排布、噪声的格点取模），所以横向平铺无接缝。
import { drawnStyle, type ArchStyle } from "../buildings";
import { P } from "../palette";
import { Px, rgba, type Color, type Rgba } from "../px";
import { ditherHit, h2, mix, seasonOf } from "./util";

/** 以 w 为周期的二维值噪声（横向无缝），返回 [0, 1)。 */
function pnoise(seed: number, x: number, y: number, w: number, cell: number, cellY = cell): number {
  const n = Math.max(1, Math.round(w / cell));
  const u = (((x % w) + w) % w) * (n / w);
  const v = y / cellY;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = h2(seed, i % n, j);
  const b = h2(seed, (i + 1) % n, j);
  const c = h2(seed, i % n, j + 1);
  const d = h2(seed, (i + 1) % n, j + 1);
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}

interface Cell {
  /** 石块序号（行内唯一） */
  id: number;
  /** 在石块内的横向位置与石块宽度 */
  lx: number;
  sw: number;
}

/** 一行石块的“环形”排布：宽度随机、总和恰为 w，起点随行错开。 */
function rowLayout(seed: number, row: number, w: number, minW: number, maxW: number): (x: number) => Cell {
  const widths: number[] = [];
  let sum = 0;
  let k = 0;
  while (sum < w) {
    const sw = minW + Math.floor(h2(seed, row, k++) * (maxW - minW + 1));
    widths.push(sw);
    sum += sw;
  }
  const over = sum - w;
  widths[widths.length - 1] -= over;
  if (widths.length > 1 && widths[widths.length - 1] < Math.ceil(minW / 2)) {
    const last = widths.pop() ?? 0;
    widths[widths.length - 1] += last;
  }
  const starts: number[] = [];
  let acc = 0;
  for (const sw of widths) {
    starts.push(acc);
    acc += sw;
  }
  const off = Math.floor(h2(seed + 7, row) * w);
  return (x: number) => {
    const u = (((x - off) % w) + w) % w;
    let i = widths.length - 1;
    while (i > 0 && starts[i] > u) i--;
    return { id: i, lx: u - starts[i], sw: widths[i] };
  };
}

interface StonePaint {
  joint: Rgba;
  dark: Rgba;
  mid: readonly Rgba[];
  lit: Rgba;
  hi: Rgba;
  /** 圆角（削掉四个角）：粗石、卵石 */
  round: boolean;
}

/** 按行铺石块；rows 为各行高度（含 1 像素的缝）。返回每个像素所在石块的信息，供季节装饰使用。 */
function paveRows(p: Px, y0: number, y1: number, rows: readonly number[], seed: number, minW: number, maxW: number, s: StonePaint): Uint8Array {
  const joints = new Uint8Array(p.w * p.h);
  let y = y0;
  let r = 0;
  while (y < y1) {
    const rh = rows[Math.min(rows.length - 1, r)];
    const lay = rowLayout(seed, r, p.w, minW, maxW);
    for (let x = 0; x < p.w; x++) {
      const c = lay(x);
      const tone = s.mid[Math.floor(h2(seed + 3, r, c.id) * s.mid.length)];
      for (let dy = 0; dy < rh && y + dy < y1; dy++) {
        const yy = y + dy;
        const i = yy * p.w + x;
        const lastRow = dy === rh - 1;
        const lastCol = c.lx === c.sw - 1;
        const corner = s.round && (dy === 0 || dy === rh - 2) && (c.lx === 0 || c.lx === c.sw - 2);
        if (lastRow || lastCol || corner) {
          p.data[i] = s.joint;
          joints[i] = 1;
          continue;
        }
        let col = tone;
        if (dy === 0 || c.lx === 0) col = dy === 0 && c.lx < c.sw - 3 ? s.hi : s.lit;
        else if (dy === rh - 2 || c.lx === c.sw - 2) col = s.dark;
        p.data[i] = col;
      }
    }
    y += rh;
    r++;
  }
  return joints;
}

/** 在缝里 / 表面撒上季节装饰：苔藓、落叶、花瓣、积雪。 */
function seasonal(p: Px, joints: Uint8Array, season: number, style: ArchStyle, seed: number): void {
  const w = p.w;
  const snowy = season === 3 && style !== "desert" && style !== "islands";
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const n = h2(seed + 11, x, y);
      if (snowy) {
        // 积雪成片：靠墙的上缘与路边更厚，路中间被踩出几块空；雪堆上缘亮、下缘暗
        const heavy = style === "nordic";
        const th = heavy ? 0.4 : 0.58;
        const cover = (yy: number) => {
          const edge = 1 - Math.min(yy, p.h - 1 - yy) / Math.max(1, p.h / 2);
          return pnoise(seed + 12, x, yy, w, heavy ? 18 : 14, heavy ? 6 : 5) + edge * 0.24;
        };
        if (cover(y) > th) {
          const up = y === 0 || cover(y - 1) <= th;
          const down = y < p.h - 1 && cover(y + 1) <= th;
          p.data[i] = rgba(up ? P.snow[3] : down ? P.snow[1] : P.snow[2]);
        } else if (joints[i] && n < 0.45) p.data[i] = rgba(P.snow[2]);
        continue;
      }
      if (!joints[i]) continue;
      const moss = style === "lowland" ? 0.025 : style === "nordic" ? 0.045 : 0.07;
      if ((season === 0 || season === 1) && style !== "desert" && n < moss) {
        p.data[i] = rgba(season === 0 ? P.leaf[3] : P.leaf[2]);
        if (y > 0 && n < moss * 0.35) p.data[i - w] = rgba(P.leaf[3]);
      }
    }
  }
  // 落叶与花瓣：2–3 像素的小团
  if (season === 2 || (season === 0 && style === "eastern")) {
    const cols: Color[] = season === 2 ? [P.autumn[2], P.gold[3], P.autumn[1]] : [P.blossom[2], P.blossom[3]];
    const count = Math.round((w * p.h) / 90);
    for (let k = 0; k < count; k++) {
      const x = Math.floor(h2(seed + 21, k) * w);
      const y = 1 + Math.floor(h2(seed + 22, k) * (p.h - 2));
      const c = cols[k % cols.length];
      p.put(x, y, c).put((x + 1) % w, y, c);
      if (k % 3 === 0) p.put(x, y + 1, mix(c, P.autumn[0], 0.3));
    }
  }
}

/** 顶边：与建筑相接处的一道阴影（压暗两行，第二行抖动）。 */
function topShade(p: Px, k = 0.35): void {
  for (let x = 0; x < p.w; x++) {
    p.data[x] = mix(p.data[x], P.stone[0], k);
    if (p.h > 1 && ditherHit(x, 1, 0.5)) p.data[p.w + x] = mix(p.data[p.w + x], P.stone[0], k * 0.6);
  }
}

function perspectiveRows(h: number, base: number): number[] {
  const out: number[] = [];
  let y = 0;
  while (y < h) {
    const rh = base + Math.floor((y / Math.max(1, h)) * 3);
    out.push(rh);
    y += rh;
  }
  return out;
}

function eastern(p: Px, season: number): void {
  const t = (a: string, b: string, k = 0.5) => mix(a, b, k);
  const joints = paveRows(p, 0, p.h, perspectiveRows(p.h, 6), 0xc1, 14, 26, {
    joint: t(P.slate[0], P.stone[0]),
    dark: t(P.slate[1], P.stone[1]),
    mid: [t(P.slate[2], P.stone[2]), t(P.slate[2], P.stone[2], 0.25), t(P.slate[2], P.jade[1], 0.3)],
    lit: t(P.slate[3], P.stone[3]),
    hi: t(P.slate[4], P.stone[3], 0.6),
    round: false,
  });
  seasonal(p, joints, season, "eastern", 0xc1);
  topShade(p);
}

function nordic(p: Px, season: number): void {
  const joints = paveRows(p, 0, p.h, perspectiveRows(p.h, 4), 0x51, 5, 9, {
    joint: rgba(P.stone[0]),
    dark: rgba(P.stone[1]),
    mid: [rgba(P.stone[2]), mix(P.stone[2], P.stone[1], 0.35), mix(P.stone[2], P.sand[2], 0.2)],
    lit: rgba(P.stone[3]),
    hi: mix(P.stone[3], P.stone[4], 0.5),
    round: true,
  });
  seasonal(p, joints, season, "nordic", 0x51);
  topShade(p);
}

function lowland(p: Px, season: number): void {
  // 顶上一道青石路缘，下面是错缝铺砌的红砖
  const curb = Math.min(3, p.h);
  const joints = new Uint8Array(p.w * p.h);
  const curbLay = rowLayout(0x72, 0, p.w, 12, 18);
  for (let x = 0; x < p.w; x++) {
    const c = curbLay(x);
    for (let y = 0; y < curb; y++) p.put(x, y, c.lx === c.sw - 1 ? P.stone[1] : y === 0 ? P.stone[3] : y === curb - 1 ? P.stone[1] : P.stone[2]);
  }
  const brick = paveRows(p, curb, p.h, perspectiveRows(p.h - curb, 3), 0x71, 6, 8, {
    joint: mix(P.sand[3], P.stone[3], 0.5),
    dark: rgba(P.brick[1]),
    mid: [rgba(P.brick[2]), mix(P.brick[2], P.brick[1], 0.35), mix(P.brick[2], P.brick[3], 0.3)],
    lit: rgba(P.brick[3]),
    hi: rgba(P.brick[3]),
    round: false,
  });
  for (let i = 0; i < joints.length; i++) joints[i] = brick[i];
  seasonal(p, joints, season, "lowland", 0x71);
  topShade(p, 0.25);
}

function desert(p: Px, season: number): void {
  const w = p.w;
  const base = season === 3 ? mix(P.sand[2], P.stone[2], 0.15) : rgba(P.sand[2]);
  const lite = mix(base, P.sand[3], 0.7);
  const dark = mix(base, P.sand[1], 0.7);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < w; x++) {
      const n = pnoise(0xa1, x, y, w, 9);
      const m = pnoise(0xa2, x, y, w, 4);
      let c = base;
      if (n > 0.62) c = ditherHit(x, y, (n - 0.62) * 8) ? lite : base;
      if (n < 0.3) c = ditherHit(x, y, (0.3 - n) * 8) ? dark : base;
      if (m > 0.8 && n > 0.45) c = lite;
      p.data[y * w + x] = c;
    }
  }
  // 车辙：两道横向的暗带
  for (const ry of [Math.round(p.h * 0.45), Math.round(p.h * 0.72)]) {
    for (let x = 0; x < w; x++) {
      if (pnoise(0xa3, x, ry, w, 12) < 0.25) continue;
      p.put(x, ry, dark);
      p.put(x, ry + 1, ditherHit(x, ry + 1, 0.5) ? lite : base);
    }
  }
  // 裂纹与小石子
  for (let k = 0; k < Math.round(w / 18); k++) {
    let x = Math.floor(h2(0xa4, k) * w);
    let y = 2 + Math.floor(h2(0xa5, k) * Math.max(1, p.h - 4));
    const len = 3 + Math.floor(h2(0xa6, k) * 5);
    for (let i = 0; i < len; i++) {
      p.put(((x % w) + w) % w, y, P.sand[1]);
      x += 1;
      if (h2(0xa7, k, i) < 0.4) y += h2(0xa8, k, i) < 0.5 ? 1 : -1;
    }
  }
  for (let k = 0; k < Math.round((w * p.h) / 70); k++) {
    const x = Math.floor(h2(0xa9, k) * w);
    const y = 1 + Math.floor(h2(0xaa, k) * (p.h - 2));
    p.put(x, y, P.sand[3]).put((x + 1) % w, y, P.sand[1]);
    p.put(x, y + 1, P.sand[1]);
  }
  topShade(p, 0.25);
  void season;
}

function islands(p: Px, season: number): void {
  const w = p.w;
  const hb = Math.max(3, Math.round(p.h * 0.55));
  // 木板栈道：顺着街道铺的长木板，错缝，板头各钉两枚钉子
  const plank = paveRows(p, 0, hb, [4], 0xb1, 18, 30, {
    joint: rgba(P.wood[1]),
    dark: mix(P.wood[2], P.wood[3], 0.3),
    mid: [mix(P.wood[3], P.straw[2], 0.3), mix(P.wood[3], P.wood[2], 0.3), mix(P.wood[3], P.sand[3], 0.45)],
    lit: rgba(P.wood[4]),
    hi: rgba(P.wood[4]),
    round: false,
  });
  for (let y = 0; y < hb; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // 板头的钉子：竖缝左侧一格
      if (!plank[i] && plank[y * w + ((x + 1) % w)] && y % 4 === 1) p.data[i] = rgba(P.iron[2]);
    }
    p.put(0, hb, P.wood[1]);
  }
  for (let x = 0; x < w; x++) p.put(x, hb, P.wood[1]);
  // 沙地：浅黄底，抖动的深浅斑，贝壳与小草
  const sand = rgba(P.straw[3]);
  const sandD = mix(P.straw[3], P.sand[3], 0.6);
  for (let y = hb + 1; y < p.h; y++) {
    for (let x = 0; x < w; x++) {
      const n = pnoise(0xb4, x, y, w, 7);
      let c = sand;
      if (n < 0.4) c = ditherHit(x, y, (0.4 - n) * 6) ? sandD : sand;
      if (y === hb + 1) c = mix(sandD, P.wood[1], 0.35);
      p.data[y * w + x] = c;
    }
  }
  const shells: Color[] = [P.blossom[2], P.white, P.blossom[1]];
  for (let k = 0; k < Math.round(w / 14); k++) {
    const x = Math.floor(h2(0xb5, k) * w);
    const y = hb + 2 + Math.floor(h2(0xb6, k) * Math.max(1, p.h - hb - 3));
    if (h2(0xb7, k) < 0.6) {
      const c = shells[k % shells.length];
      p.put(x, y, c).put((x + 1) % w, y, c).put(x, y + 1, P.sand[2]).put((x + 1) % w, y + 1, P.blossom[0]);
    } else if (season !== 3) {
      // 一小丛沙草
      p.put(x, y, P.leaf[3]).put((x + 1) % w, y - 1, P.leaf[3]).put((x + 2) % w, y, P.leaf[2]).put((x + 1) % w, y, P.leaf[2]);
    }
  }
  topShade(p, 0.2);
}

/** 街道地面（铺石、夯土、木板、沙地），宽 w 高 h。横向可无缝平铺；冬季的东方、北地、低地有积雪。 */
export function drawGround(w: number, h: number, style: ArchStyle, season: number): Px {
  const s = seasonOf(season);
  const p = new Px(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  // mediterranean、frontier 暂借用 lowland、nordic 的地面
  switch (drawnStyle(style)) {
    case "nordic":
      nordic(p, s);
      break;
    case "lowland":
      lowland(p, s);
      break;
    case "desert":
      desert(p, s);
      break;
    case "islands":
      islands(p, s);
      break;
    default:
      eastern(p, s);
  }
  return p;
}
