// 界面贴图：窗口木框与黄铜框、标题牌匾、卷轴、缎带、木板、羊皮纸、黄铜横条、区块装饰与开机画面的徽记和像素标题。
// 全部用 Px 画成“九宫格”或“可平铺”的小图；启动时由 installUiTheme() 放大 UI_SCALE 倍、转成 data: URL，
// 写入根元素的 CSS 变量（如 --ui-frame-wood），styles.css 用 border-image / background-image 引用。
// 没有画布（测试环境）时不写变量，CSS 自动回退到纯色边框与底色。
//
// 九宫格约定：每张图的四角是固定的角块，四边是沿边平铺的边块，中间是填充块。
// 各 *_SLICE 常量记录九宫格贴图的切片宽度（美术像素），CSS 里的 border-image-slice 要乘以 UI_SCALE。
import { P, ink } from "./palette";
import { Px } from "./px";
import { canDraw, toDataURL } from "./render";
import { rng } from "./rng";

/** 贴图放大倍数：1 个美术像素 = UI_SCALE 个 CSS 像素。 */
export const UI_SCALE = 2;

const W = P.wood;
const G = P.gold;

/** 按周期取模画点（可平铺贴图用）。 */
function wrapSet(p: Px, x: number, y: number, c: string) {
  p.set(((x % p.w) + p.w) % p.w, ((y % p.h) + p.h) % p.h, c);
}

// ---------------------------------------------------------------------------
// 窗口边框（九宫格）

/** 边框厚度（切片宽度）。 */
export const FRAME_SLICE = 8;
/** 沿边平铺的边块长度。 */
const FRAME_TILE = 16;

export type FrameKind = "wood" | "brass";

type Side = "top" | "right" | "bottom" | "left";

/**
 * 边框截面：由外向内 8 个像素的颜色。光源在左上：上边与左边外侧受光、内侧背光；
 * 下边与右边外侧背光、内侧（朝上、朝左的斜面）受光。最内一圈是贴着羊皮纸的镶边。
 */
function frameProfile(kind: FrameKind, side: Side): string[] {
  const lit = side === "top" || side === "left";
  if (kind === "wood") {
    return lit
      ? [ink.brown, W[4], W[3], W[3], W[2], W[1], ink.brown, G[2]]
      : [ink.brown, W[1], W[1], W[2], W[2], W[3], ink.brown, G[1]];
  }
  return lit
    ? [ink.deep, G[4], G[3], G[2], G[2], G[1], ink.deep, W[1]]
    : [ink.deep, G[1], G[1], G[2], G[2], G[3], ink.deep, W[0]];
}

/** 一条边的纹理：返回 [沿边位置][深度] 的颜色表（沿边长度为 FRAME_TILE，首尾可无缝衔接）。 */
function frameStrip(kind: FrameKind, side: Side): string[][] {
  const prof = frameProfile(kind, side);
  const strip = Array.from({ length: FRAME_TILE }, () => [...prof]);
  const r = rng(`ui-frame-${kind}-${side}`);
  if (kind === "wood") {
    // 木纹：沿边方向的深色短纹，落在木料主体（深度 2–4）上，彼此错开
    for (let n = 0; n < 4; n++) {
      const d = 2 + (n % 3);
      const start = r.int(0, FRAME_TILE - 1);
      const len = r.int(4, 9);
      const base = prof[d];
      const darker = base === W[3] ? W[2] : base === W[2] ? W[1] : W[1];
      for (let i = 0; i < len; i++) strip[(start + i) % FRAME_TILE][d] = darker;
    }
  } else {
    // 黄铜：每 8 像素一颗铆钉（左上受光）
    for (const at of [3, 11]) {
      strip[at][2] = G[4];
      strip[at + 1][2] = G[3];
      strip[at][3] = G[3];
      strip[at + 1][3] = G[1];
      strip[at + 2][3] = G[1];
      strip[at + 1][4] = G[1];
    }
    // 细密的压花：在内侧斜面上每隔一像素点一个暗点
    for (let i = 0; i < FRAME_TILE; i += 2) if (strip[i][4] === G[2]) strip[i][4] = G[1];
  }
  return strip;
}

/** 角上的护角：6×6 的金属片，中间一颗铆钉。 */
function cornerPlate(p: Px, x: number, y: number, kind: FrameKind) {
  const rim = kind === "wood" ? ink.brown : ink.deep;
  const hi = kind === "wood" ? G[3] : G[4];
  const lo = kind === "wood" ? G[1] : G[0];
  const mid = kind === "wood" ? G[2] : G[1];
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 6; i++) {
      const edge = i === 0 || j === 0 || i === 5 || j === 5;
      let c: string = mid;
      if (edge) c = rim;
      else if (i === 1 || j === 1) c = hi;
      else if (i === 4 || j === 4) c = lo;
      p.put(x + i, y + j, c);
    }
  }
  // 铆钉（2×2）
  p.put(x + 2, y + 2, G[4]);
  p.put(x + 3, y + 2, G[3]);
  p.put(x + 2, y + 3, G[3]);
  p.put(x + 3, y + 3, ink.brown);
}

/** 窗口边框（九宫格，切片 FRAME_SLICE，整图 32×32，中间透明）。 */
export function drawFrame(kind: FrameKind): Px {
  const S = FRAME_SLICE;
  const T = FRAME_TILE;
  const N = S * 2 + T;
  const p = new Px(N, N);
  const strips: Record<Side, string[][]> = {
    top: frameStrip(kind, "top"),
    right: frameStrip(kind, "right"),
    bottom: frameStrip(kind, "bottom"),
    left: frameStrip(kind, "left"),
  };
  const prof: Record<Side, string[]> = {
    top: frameProfile(kind, "top"),
    right: frameProfile(kind, "right"),
    bottom: frameProfile(kind, "bottom"),
    left: frameProfile(kind, "left"),
  };
  // 四边
  for (let i = 0; i < T; i++) {
    for (let d = 0; d < S; d++) {
      p.put(S + i, d, strips.top[i][d]);
      p.put(S + i, N - 1 - d, strips.bottom[i][d]);
      p.put(d, S + i, strips.left[i][d]);
      p.put(N - 1 - d, S + i, strips.right[i][d]);
    }
  }
  // 四角：45° 斜接
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 左上
      p.put(x, y, y <= x ? prof.top[y] : prof.left[x]);
      // 右上：dx 为进入右边的深度
      p.put(N - 1 - x, y, y <= x ? prof.top[y] : prof.right[x]);
      // 左下
      p.put(x, N - 1 - y, y < x ? prof.bottom[y] : prof.left[x]);
      // 右下
      p.put(N - 1 - x, N - 1 - y, y <= x ? prof.bottom[y] : prof.right[x]);
    }
  }
  // 护角
  cornerPlate(p, 0, 0, kind);
  cornerPlate(p, N - 6, 0, kind);
  cornerPlate(p, 0, N - 6, kind);
  cornerPlate(p, N - 6, N - 6, kind);
  // 最外侧四个角点挖空（倒角）
  for (const [x, y] of [
    [0, 0],
    [N - 1, 0],
    [0, N - 1],
    [N - 1, N - 1],
  ] as const) {
    p.put(x, y, null);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 细边框（头像、命令栏按钮用），九宫格切片 3

export const THIN_SLICE = 3;

/** 细黄铜框（10×10，切片 3，中间透明）。 */
export function drawThinFrame(): Px {
  const N = 10;
  const p = new Px(N, N);
  for (let i = 0; i < N; i++) {
    for (let d = 0; d < 3; d++) {
      const litTop = [ink.deep, G[3], G[1]][d];
      const litLeft = [ink.deep, G[3], G[1]][d];
      const dark = [ink.deep, G[1], G[3]][d];
      p.put(i, d, litTop);
      p.put(d, i, litLeft);
      p.put(i, N - 1 - d, dark);
      p.put(N - 1 - d, i, dark);
    }
  }
  // 角：外侧描边收口
  p.put(0, 0, null).put(N - 1, 0, null).put(0, N - 1, null).put(N - 1, N - 1, null);
  p.put(1, 1, G[4]).put(N - 2, 1, G[2]).put(1, N - 2, G[2]).put(N - 2, N - 2, G[0]);
  return p;
}

// ---------------------------------------------------------------------------
// 标题牌匾（九宫格：上下 4、左右 9；高度固定为 16 美术像素）

export const PLAQUE_SLICE = { v: 4, h: 9 } as const;
export const PLAQUE_H = 16;

/** 黄铜牌匾：倒角外框、受光的上沿、刻线内框、两端各一颗铆钉；中间是可拉伸的平整铜面。 */
export function drawPlaque(): Px {
  const w = PLAQUE_SLICE.h * 2 + 4;
  const h = PLAQUE_H;
  const p = new Px(w, h);
  p.rect(1, 1, w - 2, h - 2, G[2]);
  // 外框（倒角）
  p.hline(1, w - 2, 0, ink.brown).hline(1, w - 2, h - 1, ink.brown);
  p.vline(0, 1, h - 2, ink.brown).vline(w - 1, 1, h - 2, ink.brown);
  // 受光的上沿与左沿、背光的下沿与右沿
  p.hline(1, w - 2, 1, G[4]).vline(1, 1, h - 2, G[4]);
  p.hline(2, w - 2, h - 2, G[0]).vline(w - 2, 2, h - 2, G[0]);
  p.put(w - 2, 1, G[3]).put(1, h - 2, G[1]);
  p.hline(2, w - 3, 2, G[3]);
  p.hline(2, w - 3, h - 3, G[1]);
  // 刻线内框：暗线 + 下 / 右侧一条亮线
  const x0 = 3;
  const x1 = w - 4;
  const y0 = 3;
  const y1 = h - 4;
  p.hline(x0, x1, y0, G[1]).hline(x0, x1, y1, G[1]).vline(x0, y0, y1, G[1]).vline(x1, y0, y1, G[1]);
  p.hline(x0 + 1, x1 - 1, y0 + 1, G[3]).vline(x0 + 1, y0 + 1, y1 - 1, G[3]);
  p.hline(x0, x1, y1 + 1, G[3]).vline(x1 + 1, y0, y1 + 1, G[3]);
  // 两端的铆钉
  const my = Math.floor(h / 2) - 1;
  for (const rx of [5, w - 7]) {
    p.put(rx, my, G[4]).put(rx + 1, my, G[3]).put(rx, my + 1, G[3]).put(rx + 1, my + 1, ink.brown);
    p.put(rx - 1, my + 1, G[1]).put(rx, my + 2, G[1]).put(rx + 1, my + 2, G[1]);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 卷轴（提示条，九宫格：上下 4、左右 6；上下两端的纸边与卷轴头可随高度平铺）

export const SCROLL_SLICE = { v: 4, h: 6 } as const;

/** 卷轴：左右两根纸卷（圆柱受光在左），上下是纸边；中间填羊皮纸。 */
export function drawScroll(): Px {
  const { v, h } = SCROLL_SLICE;
  const w = h * 2 + 4;
  const H = v * 2 + 4;
  const p = new Px(w, H);
  // 纸面
  p.rect(h, 2, w - h * 2, H - 4, P.paper);
  p.hline(h, w - h - 1, 1, ink.brown).hline(h, w - h - 1, H - 2, ink.brown);
  p.hline(h, w - h - 1, 2, P.white).hline(h, w - h - 1, H - 3, P.parchment);
  // 纸卷：圆柱截面由左到右
  const roll = [ink.brown, P.paper, P.white, P.parchment, P.parchmentDark, ink.brown];
  for (const x0 of [0, w - h]) {
    for (let i = 0; i < h; i++) p.vline(x0 + i, 1, H - 2, roll[i]);
    // 卷轴头（上下两端各伸出纸边一像素，端面是深色的卷心）
    p.hline(x0 + 1, x0 + h - 2, 0, ink.brown).hline(x0 + 1, x0 + h - 2, H - 1, ink.brown);
    p.hline(x0 + 1, x0 + h - 2, 1, P.parchmentDark).hline(x0 + 1, x0 + h - 2, H - 2, P.parchmentDeep);
    p.put(x0 + 2, 1, P.parchment).put(x0 + 3, 1, P.parchmentDeep);
    p.put(x0, 0, null).put(x0 + h - 1, 0, null).put(x0, H - 1, null).put(x0 + h - 1, H - 1, null);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 缎带（结局横幅的标题，九宫格：上下 3、左右 12；高度固定 20 美术像素，两端燕尾）

export const RIBBON_SLICE = { v: 3, h: 12 } as const;
export const RIBBON_H = 20;

export type RibbonKind = "won" | "lost";

/** 燕尾缎带：中间是平直的缎面，两端向后折、剪出燕尾。 */
export function drawRibbon(kind: RibbonKind): Px {
  const { h } = RIBBON_SLICE;
  const w = h * 2 + 4;
  const H = RIBBON_H;
  const ramp = kind === "won" ? P.red : P.slate;
  const trim = kind === "won" ? G : P.stone;
  const line = kind === "won" ? P.red[0] : ink.blue;
  const p = new Px(w, H);
  // 两端的尾片：比主缎带低 3 像素，颜色更暗，外端剪出 V 形燕尾
  const tailTop = 3;
  const tailBot = H - 1;
  for (const side of [0, 1] as const) {
    for (let y = tailTop; y <= tailBot; y++) {
      const t = Math.abs(y - (tailTop + tailBot) / 2) / ((tailBot - tailTop) / 2);
      const notch = Math.round((1 - t) * 4);
      for (let i = notch; i < 8; i++) {
        const x = side === 0 ? i : w - 1 - i;
        const edge = i === notch || y === tailTop || y === tailBot;
        p.put(x, y, edge ? line : y < tailTop + 2 ? ramp[2] : ramp[1]);
      }
    }
  }
  // 折痕处的阴影三角
  for (const side of [0, 1] as const) {
    for (let k = 0; k < 3; k++) {
      const x = side === 0 ? 8 + k : w - 9 - k;
      p.vline(x, H - 3 - (2 - k), H - 1, ramp[0]);
      p.put(x, H - 1, line);
    }
  }
  // 主缎带：第 0–16 行
  const top = 0;
  const bot = H - 4;
  for (let y = top; y <= bot; y++) {
    for (let x = 10; x <= w - 11; x++) {
      let c: string = ramp[2];
      if (y === top || y === bot) c = line;
      else if (y === top + 1) c = ramp[3];
      else if (y === bot - 1) c = ramp[1];
      else if (y === top + 2 || y === bot - 2) c = trim[3];
      p.put(x, y, c);
    }
    // 左右两端的竖边
    p.put(10, y, line).put(w - 11, y, line);
  }
  // 主缎带两端的高光与阴影
  p.vline(11, top + 1, bot - 1, ramp[3]).vline(w - 12, top + 1, bot - 1, ramp[1]);
  p.put(11, top + 2, trim[3]).put(w - 12, top + 2, trim[3]).put(11, bot - 2, trim[3]).put(w - 12, bot - 2, trim[3]);
  return p;
}

// ---------------------------------------------------------------------------
// 平铺贴图

/** 深色木板（顶栏、命令栏、窗口标题栏的底纹）：48×16，两块横板，错缝接头带钉子。 */
export function drawPlanks(): Px {
  const w = 48;
  const h = 16;
  const p = new Px(w, h).fill(W[1]);
  const r = rng("ui-planks");
  for (let k = 0; k < 2; k++) {
    const y0 = k * 8;
    p.hline(0, w - 1, y0, W[2]);
    p.hline(0, w - 1, y0 + 7, ink.brown);
    p.hline(0, w - 1, y0 + 6, W[0]);
    // 木纹
    for (let n = 0; n < 7; n++) {
      const y = y0 + r.int(1, 5);
      const x = r.int(0, w - 1);
      const len = r.int(4, 11);
      const c = r.chance(0.7) ? W[0] : W[2];
      for (let i = 0; i < len; i++) wrapSet(p, x + i, y, c);
    }
    // 接头：竖向暗缝，右侧一道高光，缝旁一颗铁钉
    const jx = k === 0 ? 30 : 9;
    p.vline(jx, y0, y0 + 6, ink.brown).vline(jx + 1, y0 + 1, y0 + 5, W[2]);
    const nx = jx + 3;
    p.put(nx, y0 + 3, P.iron[3]).put(nx + 1, y0 + 3, P.iron[2]).put(nx, y0 + 4, P.iron[2]).put(nx + 1, y0 + 4, P.iron[0]);
  }
  return p;
}

/** 纸面的中间色：比纸略深一点，只用于大块的淡斑与纤维，保证深色文字的对比度。 */
const PAPER_MID = "#eedcb6";
/** 更深一阶的斑心（很少量）。 */
const PAPER_LOW = "#e8d3a8";

/** 羊皮纸（窗口内容区的底纹）：96×96，不规则的淡斑（边缘用抖动过渡）与稀疏的纤维，保证深棕色文字清晰。 */
export function drawParchment(): Px {
  const n = 96;
  const p = new Px(n, n).fill(P.paper);
  const r = rng("ui-parchment");
  const at = (x: number, y: number) => [((x % n) + n) % n, ((y % n) + n) % n] as const;
  // 斑块：每块由 2–3 个错开的椭圆拼成，形状不规则；外圈 50% 抖动过渡，中心偶尔更深；可跨边平铺
  for (let k = 0; k < 7; k++) {
    const cx = r.int(0, n - 1);
    const cy = r.int(0, n - 1);
    const lobes = Array.from({ length: r.int(2, 3) }, () => ({
      x: cx + r.int(-6, 6),
      y: cy + r.int(-3, 3),
      rx: r.int(5, 11),
      ry: r.int(3, 6),
    }));
    const deep = r.chance(0.35);
    for (let y = cy - 12; y <= cy + 12; y++) {
      for (let x = cx - 20; x <= cx + 20; x++) {
        let d = Infinity;
        for (const l of lobes) d = Math.min(d, ((x - l.x) / l.rx) ** 2 + ((y - l.y) / l.ry) ** 2);
        const [X, Y] = at(x, y);
        if (deep && d <= 0.25) p.put(X, Y, PAPER_LOW);
        else if (d <= 0.75) p.put(X, Y, PAPER_MID);
        else if (d <= 1.1 && (X + Y) % 2 === 0) p.put(X, Y, PAPER_MID);
      }
    }
  }
  // 纤维：稀疏的短横线
  for (let k = 0; k < 14; k++) {
    const x = r.int(0, n - 1);
    const y = r.int(0, n - 1);
    const len = r.int(3, 7);
    for (let i = 0; i < len; i++) wrapSet(p, x + i, y, PAPER_MID);
  }
  // 少量小污点
  for (let k = 0; k < 4; k++) {
    const [x, y] = at(r.int(0, n - 1), r.int(0, n - 1));
    p.put(x, y, PAPER_LOW).put((x + 1) % n, y, PAPER_LOW);
  }
  return p;
}

/** 黄铜横条（顶栏下沿、命令栏上沿）：16×6，每 8 像素一颗铆钉。 */
export function drawRail(): Px {
  const p = new Px(16, 6);
  const rows = [ink.deep, G[4], G[3], G[2], G[1], ink.deep];
  rows.forEach((c, y) => p.hline(0, 15, y, c));
  for (const x of [3, 11]) {
    p.put(x, 2, G[4]).put(x + 1, 2, G[3]).put(x, 3, G[3]).put(x + 1, 3, G[0]);
  }
  return p;
}

/** 深海底纹（开机画面与标题画面的背景）：32×32，稀疏的浪纹。 */
export function drawSeaTile(): Px {
  const n = 32;
  const p = new Px(n, n).fill(P.sea[0]);
  const wave = [".aa..", "a..bb"];
  const key = { a: P.sea[1], b: "#123a6699" };
  for (const [x, y] of [
    [2, 4],
    [18, 9],
    [9, 17],
    [25, 23],
    [4, 28],
  ] as const) {
    for (let j = 0; j < wave.length; j++) {
      for (let i = 0; i < wave[j].length; i++) {
        const ch = wave[j][i] as keyof typeof key;
        if (ch in key) wrapSet(p, x + i, y + j, key[ch]);
      }
    }
  }
  return p;
}

/** 区块标题前的罗盘星（9×9）。 */
export function drawOrnament(): Px {
  const rows = [
    "....o....",
    "...oho...",
    "...oho...",
    ".oo2h2oo.",
    "ohhh1dddo",
    ".oo2d2oo.",
    "...odo...",
    "...odo...",
    "....o....",
  ];
  return new Px(9, 9).stamp(rows, { o: ink.brown, h: G[4], "1": G[3], "2": G[2], d: G[1] });
}

/** 绳纹（区块标题后的分隔线）：4×4，可横向平铺的麻绳。 */
export function drawRope(): Px {
  // 每 4 像素一股，自左下向右上斜绕
  const rows = ["ooll", "olhm", "lhmd", "hmdo"];
  return new Px(4, 4).stamp(rows, { o: P.straw[0], l: P.straw[2], h: P.straw[3], m: P.straw[2], d: P.straw[1] });
}

/** 蜡封（错误提示用）：12×12。 */
export function drawSeal(): Px {
  const p = new Px(12, 12);
  const R = P.red;
  p.circle(5.5, 5.5, 5, R[1]);
  p.circle(5.5, 5.5, 4, R[2]);
  // 边缘的蜡滴
  p.put(0, 7, R[1]).put(10, 2, R[1]).put(3, 11, R[1]);
  // 压印：一个小锚
  p.vline(5, 3, 8, R[0]).hline(4, 6, 3, R[0]).hline(3, 7, 7, R[0]).put(3, 6, R[0]).put(7, 6, R[0]);
  // 高光
  p.put(3, 2, R[4]).put(2, 3, R[3]).put(4, 2, R[3]);
  return p.outlined(R[0]);
}

// ---------------------------------------------------------------------------
// 开机画面：徽记（罗盘 + 舵轮）与像素标题

/** 64×64 的徽记：金色罗盘星衬底，木质舵轮，黄铜轮毂。 */
export function drawEmblem(): Px {
  const n = 64;
  const c = 31.5;
  const p = new Px(n, n);
  // 罗盘星：四长四短，每个尖角分成受光与背光两半
  const point = (ang: number, len: number, wid: number, light: string, dark: string) => {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const tip: [number, number] = [c + dx * len, c + dy * len];
    const l: [number, number] = [c - dy * wid, c + dx * wid];
    const r: [number, number] = [c + dy * wid, c - dx * wid];
    p.poly([[c, c], l, tip], light);
    p.poly([[c, c], tip, r], dark);
  };
  for (let k = 0; k < 4; k++) point(Math.PI / 4 + (k * Math.PI) / 2, 25, 3, P.paper, P.parchmentDark);
  for (let k = 0; k < 4; k++) point(-Math.PI / 2 + (k * Math.PI) / 2, 31, 4, G[3], G[1]);
  // 轮内是深色的底，让辐条清楚
  p.circle(c, c, 15, P.sea[1]);
  p.circle(c, c, 13, P.sea[0]);
  // 舵轮：辐条与握柄（握柄在罗盘尖角之间）
  const spokes = 8;
  for (let k = 0; k < spokes; k++) {
    const a = (k * Math.PI * 2) / spokes + Math.PI / 8;
    const x1 = c + Math.cos(a) * 23;
    const y1 = c + Math.sin(a) * 23;
    p.line(c, c, x1, y1, W[1]);
    p.line(c - 0.6 * Math.sin(a), c + 0.6 * Math.cos(a), x1 - 0.6 * Math.sin(a), y1 + 0.6 * Math.cos(a), W[3]);
    // 握柄：外侧一颗圆头，左上一点高光
    const hx = c + Math.cos(a) * 26;
    const hy = c + Math.sin(a) * 26;
    p.circle(hx, hy, 2, ink.brown);
    p.circle(hx, hy, 1.4, W[2]);
    p.set(Math.round(hx) - 1, Math.round(hy) - 1, W[4]);
  }
  p.ring(c, c, 18, 18, ink.brown);
  p.ring(c, c, 17, 17, W[3]);
  p.ring(c, c, 16, 16, W[2]);
  p.ring(c, c, 15, 15, W[1]);
  p.ring(c, c, 14, 14, ink.brown);
  // 轮缘左上受光
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 15.5 && d < 17.5 && dx + dy < -8) p.put(x, y, W[4]);
    }
  }
  // 轮毂
  p.circle(c, c, 5, ink.brown);
  p.circle(c, c, 4, G[2]);
  p.circle(c - 1, c - 1, 2, G[3]);
  p.put(Math.floor(c) - 1, Math.floor(c) - 2, G[4]);
  p.put(Math.floor(c) + 2, Math.floor(c) + 2, G[1]);
  return p.outlined(ink.deep);
}

/** 标题用的 7×9 粗体像素字母（只收录标题需要的字母）。 */
const GLYPHS: Record<string, string[]> = {
  M: ["##...##", "###.###", "#######", "##.#.##", "##...##", "##...##", "##...##", "##...##", "##...##"],
  A: ["..###..", ".##.##.", "##...##", "##...##", "#######", "##...##", "##...##", "##...##", "##...##"],
  N: ["##...##", "###..##", "###..##", "####.##", "##.####", "##..###", "##..###", "##...##", "##...##"],
  I: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
  F: ["#######", "##.....", "##.....", "##.....", "######.", "##.....", "##.....", "##.....", "##....."],
  E: ["#######", "##.....", "##.....", "##.....", "######.", "##.....", "##.....", "##.....", "#######"],
  S: [".#####.", "##...##", "##.....", ".##....", "..###..", "....##.", ".....##", "##...##", ".#####."],
  T: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
};

/** 像素标题：金色字面（上亮下暗）、深色描边、右下 1 像素投影。未收录的字母跳过。 */
export function drawTitle(text: string): Px {
  const letters = [...text.toUpperCase()].filter((ch) => GLYPHS[ch]);
  const widths = letters.map((ch) => GLYPHS[ch][0].length);
  const gap = 2;
  const w = Math.max(1, widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, letters.length - 1));
  const face = new Px(w, 9);
  const shade = [G[4], G[4], G[3], G[3], G[3], G[2], G[2], G[1], G[1]];
  let x = 0;
  letters.forEach((ch, i) => {
    const rows = GLYPHS[ch];
    rows.forEach((row, y) => {
      for (let k = 0; k < row.length; k++) if (row[k] === "#") face.put(x + k, y, shade[y]);
    });
    x += widths[i] + gap;
  });
  const out = face.outlined(ink.brown, true);
  const p = new Px(out.w + 1, out.h + 1);
  p.blit(out, 1, 1, { tint: ink.deep });
  return p.blit(out, 0, 0);
}

// ---------------------------------------------------------------------------
// 九宫格合成（预览与测试用：模拟 CSS border-image 的效果）

/** 把九宫格贴图铺成 w×h 的图：四角原样，四边沿边平铺（从中间向两端对齐），中间按 fill 平铺或留空。 */
export function nineSlice(
  src: Px,
  slice: { t: number; r: number; b: number; l: number },
  w: number,
  h: number,
  fill = false,
): Px {
  const out = new Px(w, h);
  const cw = src.w - slice.l - slice.r;
  const ch = src.h - slice.t - slice.b;
  const iw = w - slice.l - slice.r;
  const ih = h - slice.t - slice.b;
  const offX = Math.floor((iw % cw) / 2) - (iw % cw === 0 ? 0 : 0);
  const offY = Math.floor((ih % ch) / 2);
  const tileX = (x: number) => (((x - offX) % cw) + cw) % cw;
  const tileY = (y: number) => (((y - offY) % ch) + ch) % ch;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx: number;
      let sy: number;
      if (x < slice.l) sx = x;
      else if (x >= w - slice.r) sx = src.w - (w - x);
      else sx = slice.l + tileX(x - slice.l);
      if (y < slice.t) sy = y;
      else if (y >= h - slice.b) sy = src.h - (h - y);
      else sy = slice.t + tileY(y - slice.t);
      const inner = x >= slice.l && x < w - slice.r && y >= slice.t && y < h - slice.b;
      if (inner && !fill) continue;
      out.data[y * w + x] = src.get(sx, sy);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 安装到 CSS

export interface UiTexture {
  /** 贴图名（也是缓存键） */
  name: string;
  /** 写入的 CSS 变量 */
  cssVar: string;
  draw: () => Px;
}

/** 界面贴图清单：CSS 变量名与画法。styles.css 引用这些变量，未安装时回退到纯色。 */
export const UI_TEXTURES: readonly UiTexture[] = [
  { name: "frame-wood", cssVar: "--ui-frame-wood", draw: () => drawFrame("wood") },
  { name: "frame-brass", cssVar: "--ui-frame-brass", draw: () => drawFrame("brass") },
  { name: "frame-thin", cssVar: "--ui-frame-thin", draw: drawThinFrame },
  { name: "plaque", cssVar: "--ui-plaque", draw: drawPlaque },
  { name: "scroll", cssVar: "--ui-scroll", draw: drawScroll },
  { name: "ribbon-won", cssVar: "--ui-ribbon-won", draw: () => drawRibbon("won") },
  { name: "ribbon-lost", cssVar: "--ui-ribbon-lost", draw: () => drawRibbon("lost") },
  { name: "planks", cssVar: "--ui-planks", draw: drawPlanks },
  { name: "parchment", cssVar: "--ui-parchment", draw: drawParchment },
  { name: "rail", cssVar: "--ui-rail", draw: drawRail },
  { name: "sea", cssVar: "--ui-sea", draw: drawSeaTile },
  { name: "ornament", cssVar: "--ui-ornament", draw: drawOrnament },
  { name: "rope", cssVar: "--ui-rope", draw: drawRope },
  { name: "seal", cssVar: "--ui-seal", draw: drawSeal },
];

/**
 * 生成全部界面贴图并写入 CSS 变量（放大 UI_SCALE 倍，值形如 url("data:…")）。
 * 没有画布时什么也不做并返回 false；成功时在根元素上标记 data-ui-theme="pixel"。
 */
export function installUiTheme(root?: HTMLElement): boolean {
  if (!canDraw() || typeof document === "undefined") return false;
  const el = root ?? document.documentElement;
  for (const tex of UI_TEXTURES) {
    const url = toDataURL(tex.draw().scaled(UI_SCALE), `ui:${tex.name}`);
    if (!url) return false;
    el.style.setProperty(tex.cssVar, `url("${url}")`);
  }
  el.dataset.uiTheme = "pixel";
  return true;
}
