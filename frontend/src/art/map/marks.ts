// 海图上的动态与装饰标记：罗盘玫瑰、风向箭头、选中框、旗舰光圈与指示箭头、商队、目的地、航线点、航迹、
// 图例用的迷雾小样，以及航行状态的小画面。全部是纯函数，结果按参数记忆化。
import { P, ink } from "../palette";
import { Px } from "../px";
import { memo } from "../render";

// ───────────────────────────── 罗盘玫瑰 ─────────────────────────────

/** 罗盘玫瑰（半径 radius 像素）：8 个尖角、外圈与北向的红色标记。 */
export function drawCompassRose(radius: number): Px {
  const r = Math.max(6, Math.round(radius));
  return memo(`rose:${r}`, () => {
    const size = r * 2 + 7;
    const c = Math.floor(size / 2);
    const p = new Px(size, size);
    // 外圈
    p.ring(c, c, r - 1, r - 1, P.parchmentDeep);
    p.ring(c, c, r - 3, r - 3, P.parchmentDark);
    // 刻度：32 个方位点
    for (let k = 0; k < 32; k++) {
      const a = (k * Math.PI) / 16;
      p.set(Math.round(c + Math.sin(a) * (r - 2)), Math.round(c - Math.cos(a) * (r - 2)), k % 4 === 0 ? P.paper : P.parchmentDeep);
    }
    const point = (a: number, len: number, wid: number, light: string, dark: string) => {
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      const tip: [number, number] = [c + 0.5 + dx * len, c + 0.5 + dy * len];
      const left: [number, number] = [c + 0.5 - dy * wid, c + 0.5 + dx * wid];
      const right: [number, number] = [c + 0.5 + dy * wid, c + 0.5 - dx * wid];
      const mid: [number, number] = [c + 0.5, c + 0.5];
      p.poly([mid, left, tip], light);
      p.poly([mid, tip, right], dark);
    };
    const diag = r * 0.62;
    for (let k = 0; k < 4; k++) point(Math.PI / 4 + (k * Math.PI) / 2, diag, r * 0.2, P.parchmentDark, P.parchmentDeep);
    for (let k = 0; k < 4; k++) {
      const north = k === 0;
      point((k * Math.PI) / 2, r + 1, r * 0.24, north ? P.red[3] : P.paper, north ? P.red[1] : P.parchmentDark);
    }
    // 中心的金色圆钉
    p.circle(c, c, Math.max(1, Math.round(r / 8)), P.gold[2]);
    p.set(c - 1, c - 1, P.gold[4]);
    // 北向顶上的小三角
    p.poly(
      [
        [c + 0.5, c - r - 3.5],
        [c + 3, c - r + 0.5],
        [c - 2, c - r + 0.5],
      ],
      P.red[2],
    );
    return p.outlined(ink.brown);
  });
}

/** 风向（0 = 北，顺时针 8 方向）对应的单位向量。 */
export const WIND_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** 风向箭头：带尾羽的白色箭头，长度随风力（0–10）增加。图的中心就是箭头的中点。 */
export function drawWindArrow(dir: number, strength: number): Px {
  const d = ((Math.round(dir) % 8) + 8) % 8;
  const s = Math.max(0, Math.min(10, Math.round(strength)));
  return memo(`wind:${d}:${s}`, () => {
    const len = 8 + Math.round(s * 0.9);
    const size = len + 10;
    const c = Math.floor(size / 2);
    const [dx, dy] = WIND_DIRS[d];
    const diag = dx !== 0 && dy !== 0;
    const half = diag ? Math.round(len / 2 / Math.SQRT2) : Math.round(len / 2);
    const p = new Px(size, size);
    const tx = c - dx * half;
    const ty = c - dy * half;
    const hx = c + dx * half;
    const hy = c + dy * half;
    p.line(tx, ty, hx, hy, P.snow[3]);
    // 箭头
    const px = -dy;
    const py = dx;
    const back = diag ? 2 : 3;
    p.poly(
      [
        [hx + 0.5 + dx * 2, hy + 0.5 + dy * 2],
        [hx + 0.5 - dx * back + px * 3, hy + 0.5 - dy * back + py * 3],
        [hx + 0.5 - dx * back - px * 3, hy + 0.5 - dy * back - py * 3],
      ],
      P.snow[3],
    );
    // 尾羽：两道斜向后方的短羽
    for (const k of [0, 2]) {
      const bx = tx + dx * k;
      const by = ty + dy * k;
      p.line(bx, by, bx - dx * 2 + px * 2, by - dy * 2 + py * 2, P.teal[4]);
      p.line(bx, by, bx - dx * 2 - px * 2, by - dy * 2 - py * 2, P.teal[4]);
    }
    return p.outlined(ink.blue);
  });
}

/** 选中框的动画帧数。 */
export const SELECT_FRAMES = 4;

/** 选中地点的高亮框：四个金色角标，随帧向外脉动。图的中心对准地点。 */
export function drawSelectFrame(frame: number): Px {
  const f = ((frame % SELECT_FRAMES) + SELECT_FRAMES) % SELECT_FRAMES;
  return memo(`select:${f}`, () => {
    const off = [0, 1, 2, 1][f];
    const size = 27;
    const p = new Px(size, size);
    const a = 2 + (2 - off);
    const b = size - 3 - (2 - off);
    const L = 5;
    const corner = (x: number, y: number, sx: number, sy: number) => {
      p.hline(x, x + sx * (L - 1), y, P.gold[3]);
      p.vline(x, y, y + sy * (L - 1), P.gold[3]);
      p.set(x, y, P.gold[4]);
    };
    corner(a, a, 1, 1);
    corner(b, a, -1, 1);
    corner(a, b, 1, -1);
    corner(b, b, -1, -1);
    return p.outlined(ink.deep).crop(0, 0, size + 2, size + 2);
  });
}

/** 旗舰标记的动画帧数。 */
export const FLAGSHIP_FRAMES = 8;

/** 旗舰队脚下的金色光圈（虚线椭圆，随帧转动）。图的中心对准船的吃水线。 */
export function drawFlagshipRing(frame: number): Px {
  const f = ((frame % FLAGSHIP_FRAMES) + FLAGSHIP_FRAMES) % FLAGSHIP_FRAMES;
  return memo(`fring:${f}`, () => {
    const p = new Px(29, 11);
    const cx = 14;
    const cy = 5;
    const n = 48;
    for (let k = 0; k < n; k++) {
      // 3 亮 1 空的虚线，每帧转过一格
      if ((k + f * 2) % 6 >= 4) continue;
      const a = (k / n) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * 13);
      const y = Math.round(cy + Math.sin(a) * 4);
      p.set(x, y, y > cy ? P.gold[4] : P.gold[2]);
    }
    return p.outlined("#1a1423aa");
  });
}

/** 旗舰队头顶的指示箭头（向下的金色 V 形，随帧上下跳动）。 */
export function drawChevron(frame: number): Px {
  const f = ((frame % FLAGSHIP_FRAMES) + FLAGSHIP_FRAMES) % FLAGSHIP_FRAMES;
  return memo(`chev:${f}`, () => {
    const bob = [0, 0, 1, 2, 2, 2, 1, 0][f];
    const p = new Px(11, 9);
    p.stamp(
      ["hhhhhhhhh", "hmmmmmmmd", ".hmmmmmd.", "..hmmmd..", "...hmd...", "....d...."],
      { h: P.gold[4], m: P.gold[3], d: P.gold[1] },
      1,
      bob,
    );
    return p.outlined(ink.brown);
  });
}

/** 商队的动画帧数。 */
export const CARAVAN_FRAMES = 2;

/** 商队：驮着货包、插着小旗的骡子（侧视，头朝右），约 18×15。 */
export function drawCaravanMarker(frame: number): Px {
  const f = ((frame % CARAVAN_FRAMES) + CARAVAN_FRAMES) % CARAVAN_FRAMES;
  return memo(`caravan:${f}`, () => {
    const p = new Px(16, 13);
    const hide = [P.wood[1], P.wood[2], P.wood[3]];
    // 身体：上亮下暗
    p.rect(3, 6, 8, 4, hide[1]);
    p.hline(3, 10, 6, hide[2]);
    p.hline(4, 10, 9, hide[0]);
    // 脖子与头（朝右），长耳朵
    p.rect(10, 4, 2, 3, hide[1]);
    p.rect(11, 3, 3, 3, hide[1]);
    p.hline(11, 13, 3, hide[2]);
    p.rect(13, 5, 2, 2, hide[2]);
    p.set(14, 6, hide[0]);
    p.set(12, 4, ink.deep);
    p.vline(11, 0, 2, hide[1]).vline(12, 1, 2, hide[2]);
    // 尾巴
    p.set(2, 6, hide[0]).set(1, 7, hide[0]).set(1, 8, hide[0]);
    // 腿：两帧交替迈步
    const legs = f === 0 ? [3, 5, 8, 10] : [4, 5, 9, 10];
    for (const x of legs) p.vline(x, 10, 12, hide[0]);
    // 货包：两只麻袋与捆绳，顶上一面小红旗
    p.rect(4, 3, 3, 4, P.straw[2]);
    p.rect(7, 3, 3, 4, P.straw[3]);
    p.hline(4, 9, 3, P.straw[3]);
    p.vline(7, 3, 6, P.straw[1]);
    p.hline(4, 9, 5, P.wood[1]);
    p.vline(5, 0, 2, P.wood[1]);
    p.rect(6, 0, 2, 2, P.red[2]);
    p.set(6, 0, P.red[3]);
    return p.outlined(ink.brown);
  });
}

/** 目的地标记：红色的“×”，随帧闪烁。 */
export function drawDestPin(frame: number): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`dest:${f}`, () => {
    const p = new Px(9, 9);
    const c = f === 3 ? P.red[3] : P.red[2];
    for (let k = 0; k < 7; k++) {
      p.set(1 + k, 1 + k, c).set(2 + k, 1 + k, c);
      p.set(7 - k, 1 + k, c).set(8 - k, 1 + k, c);
    }
    p.set(1, 1, P.red[4]).set(7, 1, P.red[4]);
    return p.outlined(ink.deep);
  });
}

/** 新发现物闪光的动画帧数。 */
export const FLASH_FRAMES = 6;

/**
 * 新发现物的闪光（31×31）：一圈金色光环自中心向外扩散、逐帧变淡成虚线，八道短光芒交替转动。
 * 图的中心对准发现物；画在发现物图标下面，图标盖住中心部分。
 */
export function drawDiscoveryFlash(frame: number): Px {
  const f = ((frame % FLASH_FRAMES) + FLASH_FRAMES) % FLASH_FRAMES;
  return memo(`dflash:${f}`, () => {
    const size = 31;
    const c = 15;
    const p = new Px(size, size);
    // 光环：半径 8 → 14，前两帧白亮，之后金色，后半程变成虚线
    const r = 8 + f * 1.2;
    const ringColor = f < 2 ? P.white : f < 4 ? P.gold[4] : P.gold[3];
    const n = 44;
    for (let k = 0; k < n; k++) {
      if (f >= 3 && k % 2 === 1) continue;
      if (f >= 5 && k % 4 === 2) continue;
      const a = (k / n) * Math.PI * 2;
      p.set(Math.round(c + Math.cos(a) * r), Math.round(c + Math.sin(a) * r), ringColor);
    }
    // 光芒：八个方向各 3 像素，随帧外移；奇数帧转过半格，像星光闪烁
    for (let d = 0; d < 8; d++) {
      const a = (d / 8) * Math.PI * 2 + ((f % 2) * Math.PI) / 8;
      for (let s = 0; s < 3; s++) {
        const rr = 5 + f + s;
        p.set(Math.round(c + Math.cos(a) * rr), Math.round(c + Math.sin(a) * rr), s === 0 ? P.white : P.gold[4 - Math.min(2, s)]);
      }
    }
    return p;
  });
}

/** 航线上的点：route 为已出航的航线（金色），plan 为待确认的规划航线（白色）。 */
export function drawRouteDot(kind: "route" | "plan"): Px {
  return memo(`rdot:${kind}`, () => {
    const p = new Px(2, 2).fill(kind === "route" ? P.gold[3] : P.white);
    p.set(0, 0, kind === "route" ? P.gold[4] : P.white);
    return p.outlined(kind === "route" ? ink.brown : ink.blue);
  });
}

/** 航迹：船尾拖出的白色浪花（船头朝右时放在船左侧），随帧变化。 */
export function drawWake(frame: number): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`wake:${f}`, () => {
    const p = new Px(9, 4);
    const rows = [
      ["..xx.x...", "xx..x.xx."],
      [".xx.x....", "x..xx.xx."],
      ["x.xx.....", ".xx..xxx."],
      [".x.xx....", "xx.x..xx."],
    ][f];
    p.stamp(rows, { x: P.foam }, 0, 1);
    return p;
  });
}

/** 图例用的迷雾小样：一小块云团，带描边。 */
export function fogSwatch(): Px {
  return memo("fog-swatch", () => {
    const p = new Px(16, 12);
    p.fill(P.parchment);
    p.circle(5, 6, 4, P.parchmentDark).circle(5, 6, 3, P.paper);
    p.circle(11, 7, 3, P.parchmentDark).circle(11, 7, 2, P.paper);
    p.set(3, 4, P.white).set(4, 3, P.white).set(10, 5, P.white);
    p.hline(1, 14, 10, P.parchment).hline(2, 13, 11, P.parchmentDark);
    return p.outlined(ink.brown);
  });
}

/** 航行状态小画面的帧数。 */
export const VIGNETTE_FRAMES = 8;

/**
 * 航行状态小画面（不含船）：天空、远方的云与起伏的海面。frame 让浪花与云缓缓移动。
 * 返回的图里，海平线在 horizon 行；船应当画在 waterline 行（由调用方叠加）。
 */
export function drawSeaVignette(w: number, h: number, frame: number): { px: Px; horizon: number; waterline: number } {
  const f = ((frame % VIGNETTE_FRAMES) + VIGNETTE_FRAMES) % VIGNETTE_FRAMES;
  const horizon = Math.floor(h * 0.48);
  const waterline = Math.floor(h * 0.72);
  const px = memo(`vignette:${w}x${h}:${f}`, () => {
    const p = new Px(w, h);
    p.gradient(0, 0, w, horizon, [P.sky[2], P.sky[3], P.sky[4]]);
    // 远处的两朵云，缓缓右移
    const cloud = (x: number, y: number) => {
      p.ellipse(x, y, 5, 2, P.white).ellipse(x + 4, y + 1, 4, 2, P.white).ellipse(x - 4, y + 1, 3, 1, P.snow[2]);
      p.hline(x - 6, x + 7, y + 3, P.snow[1]);
    };
    cloud(((f * 1 + 10) % (w + 20)) - 10, 5);
    cloud(((f * 1 + Math.floor(w * 0.62)) % (w + 20)) - 10, 9);
    // 海平线上的远岛
    p.ellipse(Math.floor(w * 0.82), horizon, 7, 2, P.sea[1]);
    // 海面：由远到近变亮，浪花随帧向左流动
    p.rect(0, horizon, w, h - horizon, P.sea[2]);
    p.hline(0, w - 1, horizon, P.sea[3]);
    p.dither(0, horizon + 1, w, 2, P.sea[3], 1);
    p.rect(0, waterline + 2, w, h - waterline - 2, P.sea[1]);
    p.dither(0, waterline, w, 2, P.sea[1], 2);
    for (let row = 0; row < 4; row++) {
      const y = horizon + 3 + row * Math.max(3, Math.floor((h - horizon - 4) / 4));
      const step = 9 + row * 3;
      const off = (f * (row + 1)) % step;
      for (let x = -step + (row % 2) * 4; x < w + step; x += step) {
        const xx = x - off;
        p.hline(xx, xx + 1 + row, y, row < 2 ? P.sea[3] : P.sea[4]);
        if (row >= 2) p.set(xx + 1, y - 1, P.foam);
      }
    }
    return p;
  });
  return { px, horizon, waterline };
}
