// 帽子与头饰（原创设计）：每种帽子有前层（压在头发上）与可选的后层（头巾尾、兜帽背面、头纱），
// 以及 clipY——帽子压住头发的高度，这一行以上的头发会被裁掉，避免“贴纸感”。
// 坐标：64×64 画布，颅顶 y≈8，额前发际线 y≈16，帽檐大多压在 y≈14..17。
import { P } from "../palette";
import { Px, luma, rgba, type Pt } from "../px";
import type { HatKind, PortraitSpec } from "./spec";
import { CLOTH, CLOTH_DEEP, METAL, faceRamp, type ClothColor, type Ramp3 } from "./tones";
import type { ArchStyle } from "../buildings";

const S = 64;
const ON = "#ffffffff";

export interface HatDef {
  clipY: number;
  front: (p: Px, spec: PortraitSpec) => void;
  back?: (p: Px, spec: PortraitSpec) => void;
  /** 帽檐在额头投下阴影的行（皮肤色调写成暗面） */
  shadeRows?: readonly number[];
  /** 是否保留后层头发（兜帽、头纱会把长发整个包住） */
  keepBack?: boolean;
  /** 是否盖住耳朵（不画耳环与精灵尖耳） */
  coversEars?: boolean;
}

/** 把遮罩按“左上亮、右下暗、边缘最暗”上色。 */
function shadeMask(p: Px, m: Px, r: Ramp3 | readonly string[], opts: { lightX?: number; darkX?: number; edge?: boolean } = {}): void {
  const { lightX = 25, darkX = 41, edge = true } = opts;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      let c = r[1];
      const top = !m.isOpaque(x, y - 1);
      if (x <= lightX && (top || !m.isOpaque(x - 1, y) || !m.isOpaque(x, y - 2))) c = r[2];
      if (x >= darkX) c = r[0];
      if (edge && (!m.isOpaque(x, y + 1) || !m.isOpaque(x + 1, y))) c = r[0];
      p.set(x, y, c);
    }
  }
}

function mask(draw: (m: Px) => void): Px {
  const m = new Px(S, S);
  draw(m);
  return m;
}

function hatRamp(spec: PortraitSpec): Ramp3 {
  return CLOTH[spec.hatColor];
}

/** 浅色的布（头巾碎花只画在这些布上）。 */
const LIGHT_CLOTH: readonly ClothColor[] = ["white", "cream", "sand", "coral"];

/**
 * 头巾一类软帽的布褶：两道与下缘平行的弧形褶线（赛璐璐式的利落线条，而不是斜向的抖动条纹）。
 * 第一道离下缘 3 行、横贯帽身中段，第二道再往上 step 行、短一些。
 */
function folds(p: Px, m: Px, dark: string, step = 5): void {
  for (let x = 0; x < S; x++) {
    let bottom = -1;
    for (let y = 0; y < 24; y++) if (m.isOpaque(x, y)) bottom = y;
    if (bottom < 0) continue;
    for (const [d, x0, x1] of [
      [3, 19, 40],
      [3 + step, 23, 35],
    ] as const) {
      const y = bottom - d;
      if (x < x0 || x > x1) continue;
      if (m.isOpaque(x, y - 1) && m.isOpaque(x, y + 1) && m.isOpaque(x - 1, y) && m.isOpaque(x + 1, y)) p.set(x, y, dark);
    }
  }
}

/** 小花：花瓣 + 花心。 */
function flower(p: Px, x: number, y: number, petal: readonly string[], big = false): void {
  if (big) {
    p.circle(x - 2, y - 1, 2, petal[1]);
    p.circle(x + 1, y - 3, 2, petal[2]);
    p.circle(x + 3, y + 1, 2, petal[1]);
    p.circle(x - 1, y + 3, 2, petal[0]);
    p.circle(x - 3, y + 2, 1.5, petal[1]);
    p.set(x - 3, y - 2, petal[2]);
    p.set(x, y - 4, petal[2]);
    p.rect(x - 1, y - 1, 3, 3, P.gold[3]);
    p.set(x + 1, y + 1, P.gold[1]);
  } else {
    p.set(x, y - 1, petal[2]);
    p.set(x - 1, y, petal[1]);
    p.set(x + 1, y, petal[1]);
    p.set(x, y + 1, petal[0]);
    p.set(x - 1, y - 1, petal[2]);
    p.set(x + 1, y + 1, petal[0]);
    p.set(x, y, P.gold[3]);
  }
}

function leaf(p: Px, x: number, y: number, dx: number): void {
  p.set(x, y, P.leaf[3]);
  p.set(x + dx, y + 1, P.leaf[2]);
  p.set(x + dx * 2, y + 1, P.leaf[2]);
  p.set(x + dx * 3, y + 2, P.leaf[1]);
}

/** 羽毛：沿折线的一根弯羽，羽轴亮、两侧羽枝交错。 */
function plume(p: Px, pts: readonly Pt[], r: readonly string[], width = 2): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const w = width * (1 - (i + t) / pts.length) + 0.8;
      p.ellipse(x, y + 0.5, w, w * 0.8, r[1]);
      p.set(x, y + w * 0.6 + 0.5, r[0]);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r[2]);
  // 羽枝的锯齿
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    p.set(x + 1, y + 2, r[0]);
    p.set(x - 1, y - 1, r[2]);
  }
}

/** 缠头布：鼓起的布团，沿斜向每 5 像素一道褶（褶上亮下暗），远侧整体压暗一阶。tall 为官员的高缠头。 */
function wrapTurban(p: Px, r: Ramp3, tall: boolean): void {
  const m = mask((m) => {
    m.ellipse(31.5, tall ? 7 : 9, 16.5, tall ? 10.5 : 8.5, ON);
    m.ellipse(25.5, tall ? 4 : 7, 10.5, 6.5, ON);
    m.rect(14, 9, 34, 7, ON);
    for (let x = 0; x < S; x++) for (let y = 16; y < S; y++) if (y > 15 + (x < 19 ? 1 : 0)) m.set(x, y, null);
  });
  // 一圈圈缠绕的布：每 6 行一层，层与层之间一道暗褶（沿头顶的弧度弯曲），近侧上沿受光、远侧整体暗一阶
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      const t = y + (x - 14) * 0.3 - (x - 31) * (x - 31) * 0.012;
      const k = ((Math.floor(t) % 6) + 6) % 6;
      let c: string = k === 5 ? r[0] : k === 0 && x < 32 ? r[2] : r[1];
      if (x >= 42 && c !== r[0]) c = x >= 45 ? r[0] : r[1];
      if (!m.isOpaque(x, y + 1) || !m.isOpaque(x + 1, y)) c = r[0];
      if (!m.isOpaque(x, y - 1) && x < 35) c = r[2];
      p.set(x, y, c);
    }
  }
}

/** 宽檐：以 (cx, cy) 为中心的扁椭圆，上沿亮、下半与远侧暗。 */
function brim(p: Px, cx: number, cy: number, rx: number, ry: number, r: readonly string[], deep: string): void {
  const m = mask((m) => m.ellipse(cx, cy, rx, ry, ON));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      let c: string = y <= cy - 1 ? r[2] : r[1];
      if (y > cy) c = r[0];
      if (!m.isOpaque(x, y + 1)) c = deep;
      if (x > cx + rx - 5 && y >= cy) c = deep;
      p.set(x, y, c);
    }
  }
}

/** 毛皮色阶（4 阶）：白狐、灰狼、棕熊。 */
function furTones(c: string): readonly string[] {
  if (c === "white" || c === "cream" || c === "slate") return [P.snow[0], P.snow[1], P.snow[2], P.white];
  if (c === "iron" || c === "navy" || c === "black") return [P.stone[0], P.stone[1], P.stone[2], P.stone[3]];
  return [P.wood[1], P.wood[2], P.wood[3], P.wood[4]];
}

/** 毛皮：竖向的毛丝、参差的上下缘，左亮右暗。 */
function furBand(p: Px, m: Px, fur: readonly string[]): void {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      // 平涂的毛皮：上沿与近侧受光、下半一阶暗面、下缘与远侧最暗（毛感只靠边缘的毛尖）
      let c = fur[2];
      const top = !m.isOpaque(x, y - 1) || !m.isOpaque(x, y - 2);
      if (top || (!m.isOpaque(x - 1, y) && x < 30)) c = fur[3];
      else if (!m.isOpaque(x, y + 2)) c = fur[1];
      // 一簇簇毛：每 4 列一道从下缘往上两像素的暗簇、错开的亮簇从上缘往下（簇与簇之间留出平涂）
      else if (x % 4 === 0 && !m.isOpaque(x, y + 3)) c = fur[1];
      else if (x % 4 === 2 && !m.isOpaque(x, y - 3) && x < 40) c = fur[3];
      if (!m.isOpaque(x, y + 1) || !m.isOpaque(x + 1, y)) c = fur[0];
      if (x >= 44 && c !== fur[0]) c = c === fur[3] ? fur[2] : fur[1];
      p.set(x, y, c);
    }
  }
  // 上下缘的毛尖：每隔两列探出一根
  for (let x = 0; x < S; x++) {
    let top = -1;
    let bot = -1;
    for (let y = 0; y < S; y++) {
      if (!m.isOpaque(x, y)) continue;
      if (top < 0) top = y;
      bot = y;
    }
    if (top < 0) continue;
    if (x % 3 === 0) p.set(x, top - 1, x < 40 ? fur[3] : fur[2]);
    if (x % 3 === 1) p.set(x, bot + 1, fur[0]);
  }
}
const TRICORN: Pt[] = [
  [9.5, 16],
  [9.5, 9],
  [13.5, 4],
  [20, 2.7],
  [27, 6.7],
  [32, 2.7],
  [41.5, 2.7],
  [47, 6.7],
  [52, 13.3],
  [49.5, 16],
  [39, 16],
  [28, 17.3],
  [17.5, 17.3],
];

/** 官帽的样子随文化变化；未指定时按地中海（默认风格）。 */
function officialLook(spec: PortraitSpec): ArchStyle {
  return spec.region ?? "mediterranean";
}

const HATS: Readonly<Record<Exclude<HatKind, "none">, HatDef>> = {
  tricorn: {
    clipY: 15,
    shadeRows: [18],
    front: (p, spec) => {
      const r = spec.role === "captain" ? CLOTH[spec.hatColor === "gold" ? "black" : spec.hatColor] : hatRamp(spec);
      const m = mask((m) => m.poly(TRICORN, ON));
      shadeMask(p, m, r, { lightX: 22, darkX: 42 });
      // 帽冠在两道翻檐之间露出一块，稍暗
      p.poly(
        [
          [23, 8],
          [27, 7],
          [31, 4],
          [30, 11],
          [23, 12],
        ],
        r[0],
      );
      // 翻檐下沿的内侧阴影
      p.line(11, 15, 27, 16, r[0]);
      p.line(27, 16, 47, 15, r[0]);
      // 金边
      const edge = spec.role === "captain" || spec.role === "pirate" ? METAL.gold[2] : r[2];
      p.line(9, 9, 13, 4, edge);
      p.line(13, 4, 20, 3, edge);
      p.line(20, 3, 27, 7, edge);
      p.line(32, 3, 41, 3, edge);
      p.line(41, 3, 47, 7, edge);
      p.line(47, 7, 52, 13, spec.role === "captain" ? METAL.gold[1] : r[1]);
      // 帽徽（花结）
      if (spec.role === "captain" || spec.role === "mate") {
        const a = CLOTH[spec.accent === "gold" ? "crimson" : spec.accent];
        p.circle(14, 9, 2, a[1]);
        p.set(13, 8, a[2]);
        p.set(15, 10, a[0]);
        p.set(14, 9, METAL.gold[3]);
      }
      // 海盗：原创标记——交叉的两道白线，交叉点上方一块小小的白斑（像一枚徽记，而不是抖动）
      if (spec.role === "pirate") {
        p.line(34, 6, 38, 10, P.white);
        p.line(38, 6, 34, 10, P.white);
        p.hline(35, 37, 7, P.white);
        p.set(36, 6, P.white);
      }
    },
  },
  cap: {
    clipY: 13,
    shadeRows: [17],
    front: (p, spec) => {
      const r = CLOTH[spec.main === "crimson" ? "navy" : spec.main];
      // 平顶帽冠（略向前倾）
      const crown = mask((m) =>
        m.poly(
          [
            [15, 7],
            [20, 4],
            [40, 4],
            [46, 7],
            [44, 13],
            [16, 13],
          ],
          ON,
        ),
      );
      shadeMask(p, crown, r);
      p.hline(20, 39, 4, r[2]);
      // 帽墙与帽顶的分界
      p.line(15, 7, 46, 7, r[0]);
      // 黑色帽带 + 金色帽徽
      p.rect(16, 12, 29, 3, CLOTH.black[0]);
      p.hline(16, 44, 12, CLOTH.black[1]);
      const g = METAL.gold;
      p.rect(32, 8, 4, 4, g[2]);
      p.set(32, 8, g[3]);
      p.set(35, 11, g[0]);
      p.line(28, 12, 39, 12, g[1]);
      // 帽檐（向右前方伸出，漆面反光）
      p.poly(
        [
          [29, 15],
          [44, 13],
          [50, 15],
          [47, 17],
          [35, 17],
        ],
        CLOTH.black[0],
      );
      p.line(32, 15, 46, 14, CLOTH.black[2]);
    },
  },
  bandana: {
    clipY: 13,
    shadeRows: [16],
    front: (p, spec) => {
      const r = hatRamp(spec);
      const m = mask((m) => {
        m.ellipse(31.5, 15, 16, 10.5, ON);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y > 15 + Math.max(0, Math.floor((24 - x) / 2.5))) m.set(x, y, null);
        // 脑后的结
        m.ellipse(14, 19, 3, 3, ON);
      });
      shadeMask(p, m, r, { darkX: 43 });
      folds(p, m, r[0], 5);
      // 下缘的卷边
      p.line(20, 16, 46, 15, r[0]);
      p.line(20, 15, 45, 14, r[2]);
      // 海盗头巾：白点
      if (spec.role === "pirate") {
        for (const [x, y] of [
          [20, 8],
          [28, 6],
          [36, 8],
          [24, 12],
          [32, 11],
          [40, 12],
          [16, 13],
        ] as const)
          p.set(x, y, P.white).set(x + 1, y, P.snow[1]);
      }
      p.set(13, 18, r[2]);
    },
    back: (p, spec) => {
      const r = hatRamp(spec);
      // 两条垂下的布尾
      p.poly(
        [
          [12, 19],
          [15, 20],
          [11, 34],
          [7, 33],
        ],
        r[1],
      );
      p.poly(
        [
          [13, 20],
          [16, 20],
          [16, 30],
          [13, 31],
        ],
        r[0],
      );
      p.line(11, 21, 8, 31, r[2]);
    },
  },
  kerchief: {
    clipY: 12,
    shadeRows: [16],
    front: (p, spec) => {
      const r = hatRamp(spec);
      // 包住整个头顶、垂到后颈的头巾，在后颈打结
      const m = mask((m) => {
        m.ellipse(31.5, 13.5, 16, 10.5, ON);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y > 15 + Math.max(0, Math.floor((22 - x) * 1.4))) m.set(x, y, null);
        m.poly(
          [
            [13, 13],
            [20, 16],
            [20, 27],
            [15, 31],
            [12, 24],
          ],
          ON,
        );
      });
      shadeMask(p, m, r, { darkX: 43 });
      folds(p, m, r[0], 6);
      // 稀疏的小碎花（修复自精致 JRPG 方案：原来 x 的起点算成了小数，一朵都画不出来）：
      // 只画在浅色布上，花瓣用点缀色（点缀色太浅时用柔粉）、花心金色；深色与黄色的布不画，免得读成一排白色铆钉
      if (LIGHT_CLOTH.includes(spec.hatColor)) {
        const acc = CLOTH[spec.accent];
        const petal = LIGHT_CLOTH.includes(spec.accent) || spec.accent === "gold" ? [P.blossom[0], P.blossom[1]] : [acc[0], acc[1]];
        for (let y = 5; y < 30; y += 6) {
          for (let x = 17 + (Math.floor(y / 6) % 2) * 3; x < 42; x += 7) {
            if (!m.isOpaque(x - 1, y) || !m.isOpaque(x + 1, y) || !m.isOpaque(x, y - 1) || !m.isOpaque(x, y + 1)) continue;
            p.set(x - 1, y, petal[1]).set(x + 1, y, petal[1]).set(x, y - 1, petal[1]).set(x, y + 1, petal[0]);
            p.set(x, y, P.gold[3]);
          }
        }
      }
      // 前沿卷边
      p.line(21, 16, 46, 15, r[0]);
      p.line(21, 15, 45, 14, r[2]);
      // 后颈的结
      p.circle(15, 28, 2.5, r[1]);
      p.set(14, 27, r[2]);
      p.set(16, 29, r[0]);
    },
    back: (p, spec) => {
      const r = hatRamp(spec);
      p.poly(
        [
          [13, 28],
          [16, 29],
          [13, 40],
          [9, 39],
        ],
        r[1],
      );
      p.poly(
        [
          [15, 29],
          [18, 29],
          [18, 37],
          [15, 38],
        ],
        r[0],
      );
    },
  },
  official: {
    clipY: 13,
    shadeRows: [16],
    front: (p, spec) => {
      const look = officialLook(spec);
      const g = METAL.gold;
      if (look === "eastern") {
        // 黑漆硬冠：前低后高，冠前一块翠玉，冠后两片横出的短冠翅
        const k = CLOTH.black;
        const m = mask((m) => {
          m.poly(
            [
              [16, 15],
              [17, 7],
              [24, 4],
              [29, 4],
              [29, 0],
              [20, 0],
              [15, 4],
              [15, 15],
            ],
            ON,
          );
          m.poly(
            [
              [17, 15],
              [19, 7],
              [27, 4],
              [37, 4],
              [44, 8],
              [45, 15],
            ],
            ON,
          );
        });
        shadeMask(p, m, k, { darkX: 41 });
        p.line(16, 5, 29, 5, k[0]);
        // 冠翅
        p.rect(6, 7, 10, 2, k[1]);
        p.hline(6, 15, 7, k[2]);
        p.ellipse(5, 7.5, 2.5, 2.5, k[1]);
        p.set(4, 6, k[2]);
        p.rect(45, 5, 10, 2, k[0]);
        p.hline(45, 54, 5, k[1]);
        p.ellipse(56, 5.5, 2.5, 2.5, k[0]);
        // 翠玉
        p.rect(32, 9, 4, 4, P.jade[3]);
        p.set(32, 9, P.jade[4]);
        p.set(35, 12, P.jade[1]);
        p.hline(17, 45, 14, g[1]);
      } else if (look === "nordic") {
        // 诺德海姆的官帽：圆顶的石板蓝呢帽，前面立一块银徽（嵌蓝宝石），宽毛皮帽圈，一根黑羽斜插
        const s = CLOTH.slate;
        const m = mask((m) => {
          m.ellipse(31.5, 7.5, 13, 7.5, ON);
          m.rect(19, 7, 26, 6, ON);
        });
        shadeMask(p, m, s, { darkX: 40 });
        p.line(26, 1, 31, 0, s[2]);
        p.line(31, 1, 33, 12, s[0]);
        plume(
          p,
          [
            [40, 8],
            [45, 3],
            [50, 0],
          ],
          [P.cloth.black[0], P.cloth.black[1], P.cloth.black[2]],
          1.4,
        );
        furBand(
          p,
          mask((m) =>
            m.poly(
              [
                [14, 17],
                [15, 11],
                [48, 11],
                [49, 17],
              ],
              ON,
            ),
          ),
          furTones("white"),
        );
        const sv = METAL.silver;
        p.poly(
          [
            [28, 11],
            [28, 5],
            [31, 3],
            [34, 5],
            [34, 11],
          ],
          sv[2],
        );
        p.line(28, 5, 31, 3, sv[3]);
        p.vline(34, 5, 11, sv[0]);
        p.rect(30, 6, 2, 3, P.cloth.blue[1]);
        p.set(30, 6, P.sky[3]);
      } else if (look === "lowland") {
        // 高顶宽边帽：黑呢，金链帽带，银方扣
        const b = CLOTH.black;
        const crown = mask((m) =>
          m.poly(
            [
              [19, 13],
              [21, 1],
              [40, 1],
              [42, 13],
            ],
            ON,
          ),
        );
        shadeMask(p, crown, b);
        brim(p, 31, 14, 20, 2.2, b, P.night[0]);
        for (let x = 20; x <= 41; x++) p.set(x, 11, x % 2 ? g[2] : g[0]);
        p.hline(20, 41, 10, g[1]);
        p.rect(28, 8, 5, 5, METAL.silver[2]);
        p.rect(29, 9, 3, 3, b[0]);
        p.set(28, 8, METAL.silver[3]);
      } else if (look === "desert") {
        // 高缠头：层层斜裹的白布，金边，前额一颗红宝石，插一根白羽
        wrapTurban(p, CLOTH.cream, true);
        p.line(15, 15, 46, 14, g[1]);
        plume(p, [[36, 7], [39, 3], [42, 0]], [P.snow[1], P.white, P.white], 1.2);
        p.circle(35, 9, 2, P.red[2]);
        p.set(34, 8, P.red[4]);
        p.ring(35, 9, 2, 2, g[2]);
      } else if (look === "islands") {
        // 群岛：羽冠（青、金、红羽扇形）+ 贝壳额带
        const cols = [P.teal[3], P.gold[3], P.teal[2], P.red[2], P.teal[3], P.gold[2], P.teal[2], P.red[3], P.teal[3]];
        for (let i = 0; i < 9; i++) {
          const x = 16 + i * 3.4;
          const tip = 1 + Math.abs(4 - i) * 1.3;
          p.line(x, 13, x - 4 + i, tip, cols[i]);
          p.line(x + 1, 13, x - 3 + i, tip + 1, P.teal[1]);
        }
        p.rect(15, 12, 32, 4, P.straw[2]);
        p.hline(15, 46, 12, P.straw[3]);
        p.hline(15, 46, 15, P.straw[0]);
        for (let x = 18; x <= 44; x += 5) {
          p.rect(x, 13, 2, 2, P.blossom[3]);
          p.set(x + 1, 14, P.blossom[1]);
        }
      } else if (look === "frontier") {
        // 开拓者总督：两角帽（双角翻檐），金边，一枚铜星
        const r = CLOTH.navy;
        const m = mask((m) =>
          m.poly(
            [
              [7, 15],
              [13, 6],
              [22, 2],
              [31, 1],
              [40, 2],
              [49, 6],
              [55, 15],
              [42, 13],
              [31, 12],
              [20, 13],
            ],
            ON,
          ),
        );
        shadeMask(p, m, r, { darkX: 44 });
        p.line(7, 15, 13, 6, g[2]);
        p.line(13, 6, 22, 2, g[2]);
        p.line(22, 2, 40, 2, g[3]);
        p.line(40, 2, 49, 6, g[1]);
        p.line(49, 6, 55, 15, g[1]);
        p.circle(31, 7, 2.5, g[2]);
        p.set(31, 4, g[3]);
        p.set(28, 7, g[3]);
        p.set(34, 7, g[1]);
        p.set(31, 10, g[1]);
        p.set(31, 7, g[0]);
      } else {
        // 地中海：黑丝绒扁帽，一枚金章，白色鸵羽垂向脑后
        const k = CLOTH.black;
        const m = mask((m) => m.ellipse(29, 10, 17, 5.5, ON).ellipse(32, 7, 12, 4.5, ON));
        shadeMask(p, m, k, { darkX: 42 });
        p.line(13, 14, 46, 13, k[0]);
        plume(
          p,
          [
            [24, 6],
            [18, 4],
            [12, 6],
            [9, 11],
            [8, 17],
          ],
          [P.snow[0], P.snow[2], P.white],
          2.2,
        );
        p.circle(35, 9, 2.5, g[2]);
        p.ring(35, 9, 2.5, 2.5, g[0]);
        p.set(34, 8, g[3]);
        p.set(35, 9, P.red[2]);
      }
    },
  },
  straw: {
    clipY: 13,
    shadeRows: [16, 17, 18],
    front: (p, spec) => {
      const s = P.straw;
      const crown = mask((m) => m.ellipse(30.5, 9, 11.5, 6.5, ON));
      const br = mask((m) => m.ellipse(31.5, 14.5, 21, 4, ON));
      // 帽檐：上沿亮、下半暗，编织纹
      // 平涂的草帽：帽檐上沿亮、下半暗；帽冠近侧亮、远侧暗，只用两道环形的编织线表现草编
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (!br.isOpaque(x, y)) continue;
          let c: string = y <= 13 ? s[3] : y <= 14 ? s[2] : s[1];
          if (!br.isOpaque(x, y + 1)) c = s[0];
          if (x > 46 && y > 14) c = s[0];
          p.set(x, y, c);
        }
      }
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (!crown.isOpaque(x, y) || y > 13) continue;
          let c: string = x < 27 ? s[3] : s[2];
          if (x > 37) c = s[1];
          if ((y === 6 || y === 9) && x > 20 && x < 40 && crown.isOpaque(x - 1, y) && crown.isOpaque(x + 1, y)) c = x > 37 ? s[0] : s[1];
          p.set(x, y, c);
        }
      }
      const band = CLOTH[spec.hatColor];
      p.rect(19, 11, 23, 3, band[1]);
      p.hline(19, 41, 11, band[2]);
      p.hline(19, 41, 13, band[0]);
    },
  },
  fur: {
    clipY: 14,
    shadeRows: [18],
    coversEars: true,
    front: (p, spec) => {
      const cloth = CLOTH[spec.main === "white" || spec.main === "cream" ? "crimson" : spec.main];
      // 布帽顶（高出毛圈），一道缝线
      const top = mask((m) => m.ellipse(31.5, 8, 12.5, 6.5, ON));
      shadeMask(p, top, cloth, { darkX: 38 });
      p.line(31, 2, 32, 10, cloth[0]);
      p.line(24, 4, 29, 2, cloth[2]);
      // 毛圈与近侧护耳
      furBand(
        p,
        mask((m) => {
          m.poly(
            [
              [13, 16],
              [14, 10],
              [22, 8.5],
              [40, 8.5],
              [48, 10],
              [49, 16],
              [40, 17],
              [22, 17],
            ],
            ON,
          );
          m.poly(
            [
              [13, 14],
              [21, 15],
              [21, 30],
              [18, 34],
              [14, 33],
              [12, 26],
            ],
            ON,
          );
        }),
        furTones(spec.hatColor),
      );
    },
  },
  turban: {
    clipY: 15,
    shadeRows: [17],
    front: (p, spec) => {
      const r = hatRamp(spec);
      wrapTurban(p, r, false);
      // 额前的结 / 宝石
      if (spec.role === "office" || spec.role === "guild" || spec.role === "bank" || spec.role === "captain") {
        p.circle(35, 11, 2, P.teal[3]);
        p.ring(35, 11, 2, 2, METAL.gold[2]);
        p.set(34, 10, P.teal[4]);
      } else {
        p.rect(34, 9, 4, 4, r[1]);
        p.set(34, 9, r[2]);
        p.set(37, 12, r[0]);
      }
    },
    back: (p, spec) => {
      const r = hatRamp(spec);
      // 脑后垂下的布尾
      p.poly(
        [
          [13, 11],
          [19, 12],
          [16, 30],
          [11, 29],
        ],
        r[1],
      );
      p.line(18, 13, 15, 29, r[0]);
      p.line(13, 12, 12, 27, r[2]);
    },
  },
  flower: {
    clipY: 0,
    front: (p, spec) => {
      const petals = spec.region === "islands" ? [P.red[1], P.red[2], P.red[3]] : [P.blossom[0], P.blossom[1], P.blossom[2]];
      leaf(p, 15, 21, -1);
      leaf(p, 21, 22, 1);
      flower(p, 18, 18, petals, true);
      flower(p, 22, 15, [P.plaster[2], P.plaster[3], P.white]);
    },
  },
  beanie: {
    clipY: 12,
    shadeRows: [17],
    front: (p, spec) => {
      const r = hatRamp(spec);
      const m = mask((m) => {
        m.ellipse(31.5, 11, 15.5, 9.5, ON);
        for (let y = 17; y < S; y++) for (let x = 0; x < S; x++) m.set(x, y, null);
      });
      shadeMask(p, m, r, { darkX: 42 });
      // 针织竖纹
      for (let y = 3; y < 12; y++) for (let x = 18; x < 44; x += 3) if (m.isOpaque(x, y) && m.isOpaque(x + 1, y)) p.set(x, y, r[0]);
      // 翻折的罗纹帽口
      for (let y = 12; y <= 16; y++) for (let x = 14; x <= 48; x++) if (m.isOpaque(x, y)) p.set(x, y, x % 3 === 0 ? r[0] : x < 27 ? r[2] : r[1]);
      p.hline(15, 47, 12, r[0]);
      // 帽顶的小揪
      p.rect(27, 0, 4, 3, r[1]);
      p.set(27, 0, r[2]);
      p.set(30, 2, r[0]);
    },
  },
  visor: {
    clipY: 0,
    shadeRows: [16, 17],
    front: (p) => {
      const g = P.jade;
      // 环绕额头的帽箍
      p.line(15, 15, 46, 12, g[0]);
      p.line(15, 16, 46, 13, g[1]);
      // 绿色赛璐珞帽檐：棋盘抖动表现半透明
      const m = mask((m) =>
        m.poly(
          [
            [27, 13],
            [46, 12],
            [53, 15],
            [50, 18],
            [32, 18],
          ],
          ON,
        ),
      );
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (m.isOpaque(x, y)) p.set(x, y, y <= 14 ? g[3] : g[2]);
      p.line(32, 18, 50, 18, g[1]);
      p.line(28, 13, 47, 12, g[4]);
    },
  },
  scholar: {
    clipY: 12,
    shadeRows: [16],
    front: (p, spec) => {
      const r = hatRamp(spec);
      const m = mask((m) =>
        m.poly(
          [
            [16, 15],
            [16, 7],
            [20, 1],
            [32, 1],
            [35, 4],
            [41, 3],
            [45, 8],
            [45, 15],
          ],
          ON,
        ),
      );
      shadeMask(p, m, r, { darkX: 40 });
      // 软帽正中的折痕
      p.line(32, 2, 31, 13, r[0]);
      p.line(16, 14, 45, 14, r[0]);
      p.line(17, 13, 44, 13, r[2]);
    },
    back: (p, spec) => {
      const r = hatRamp(spec);
      // 脑后两条垂带
      p.line(15, 12, 11, 32, r[1]);
      p.line(16, 12, 12, 32, r[0]);
      p.line(16, 13, 15, 29, r[0]);
    },
  },
  headband: {
    clipY: 0,
    front: (p, spec) => {
      const r = hatRamp(spec);
      // 两像素宽的布带绕过额头，只画在头发与头上（不伸出轮廓）
      for (let x = 13; x <= 48; x++) {
        const y = Math.round(15.5 - ((x - 13) * 3.5) / 35);
        if (p.isOpaque(x, y)) p.set(x, y, x < 32 ? r[2] : r[1]);
        if (p.isOpaque(x, y + 1)) p.set(x, y + 1, x >= 40 ? r[0] : r[1]);
      }
      // 脑后的结与两条布尾
      p.rect(10, 13, 4, 4, r[1]);
      p.set(10, 13, r[2]);
      p.line(10, 17, 6, 25, r[1]);
      p.line(12, 17, 9, 26, r[0]);
    },
  },
  hood: {
    clipY: 12,
    keepBack: false,
    coversEars: true,
    front: (p, spec) => {
      const r = hatRamp(spec);
      // 兜帽 / 包头纱：从头顶绕过近侧，盖住耳朵，垂到肩上
      const m = mask((m) => {
        m.ellipse(30.5, 15, 17.5, 13.5, ON);
        m.poly(
          [
            [11, 16],
            [22, 21],
            [23, 40],
            [16, 48],
            [8, 46],
          ],
          ON,
        );
        // 挖出脸
        m.ellipse(35, 28, 11.5, 16, null);
      });
      shadeMask(p, m, r, { lightX: 19, darkX: 42 });
      folds(p, m, r[0], 7);
      // 前沿翻边
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (m.isOpaque(x, y) && !m.isOpaque(x + 1, y) && x > 19 && x < 45) p.set(x, y, r[2]);
    },
    back: (p, spec) => {
      const r = hatRamp(spec);
      p.poly(
        [
          [11, 13],
          [45, 11],
          [51, 29],
          [53, 53],
          [5, 56],
          [7, 32],
        ],
        r[0],
      );
    },
  },
  wreath: {
    clipY: 0,
    front: (p) => {
      const cols = [
        [P.blossom[0], P.blossom[1], P.blossom[2]],
        [P.gold[1], P.gold[2], P.gold[3]],
        [P.plaster[2], P.plaster[3], P.white],
        [P.red[1], P.red[2], P.red[3]],
      ];
      let i = 0;
      for (let x = 15; x <= 45; x += 5) {
        const y = 11 + Math.round(Math.abs(x - 30) / 6);
        leaf(p, x - 3, y + 1, 1);
        flower(p, x, y, cols[i++ % cols.length]);
      }
    },
  },
  plumed: {
    clipY: 14,
    shadeRows: [17, 18],
    front: (p, spec) => {
      // 羽饰宽檐帽：略向近侧歪戴，宽檐一侧上翻，一根大鸵羽沿帽冠绕到脑后
      const r = CLOTH[spec.hatColor === "white" || spec.hatColor === "cream" ? "black" : spec.hatColor];
      const deep = CLOTH_DEEP[spec.hatColor === "white" || spec.hatColor === "cream" ? "black" : spec.hatColor];
      brim(p, 30, 15, 22, 3.5, r, deep);
      const crown = mask((m) =>
        m.poly(
          [
            [18, 14],
            [20, 5],
            [26, 2],
            [36, 2],
            [41, 5],
            [42, 14],
          ],
          ON,
        ),
      );
      shadeMask(p, crown, r, { darkX: 38 });
      // 帽带
      const a = CLOTH[spec.accent === spec.hatColor ? "gold" : spec.accent];
      p.rect(18, 11, 25, 3, a[1]);
      p.hline(18, 42, 11, a[2]);
      p.hline(18, 42, 13, a[0]);
      // 鸵羽：白羽或点缀色羽，从帽带前扣绕向脑后
      const feather = spec.role === "pirate" ? [P.red[1], P.red[2], P.red[3]] : [P.snow[0], P.snow[2], P.white];
      plume(
        p,
        [
          [36, 10],
          [30, 5],
          [22, 4],
          [15, 7],
          [10, 12],
          [8, 18],
        ],
        feather,
        2.4,
      );
      p.circle(37, 12, 1.8, METAL.gold[2]);
      p.set(36, 11, METAL.gold[3]);
    },
  },
  mantilla: {
    clipY: 0,
    front: (p, spec) => {
      // 头纱：从高梳上披下，盖住后脑与近侧的头发，垂到肩头；额前的头发露在外面
      lace(
        p,
        mask((m) =>
          m.poly(
            [
              [12, 8],
              [18, 3],
              [27, 2],
              [31, 6],
              [25, 12],
              [21, 20],
              [20, 32],
              [17, 44],
              [11, 54],
              [5, 52],
              [7, 36],
              [9, 20],
            ],
            ON,
          ),
        ),
        spec,
      );
      // 高梳：玳瑁色的扇形发梳，从头纱后面高高立起
      const comb = spec.hatColor === "white" || spec.hatColor === "cream" ? [P.plaster[1], P.plaster[2], P.white] : [P.wood[0], P.wood[2], P.wood[3]];
      const m = mask((m) => m.ellipse(22, 3.5, 8, 4.5, ON));
      for (let y = 6; y < S; y++) for (let x = 0; x < S; x++) m.set(x, y, null);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (!m.isOpaque(x, y)) continue;
          let c = comb[1];
          if (!m.isOpaque(x, y - 1) || x < 19) c = comb[2];
          if (x > 27 || !m.isOpaque(x, y + 1)) c = comb[0];
          p.set(x, y, c);
        }
      }
      for (let x = 16; x <= 28; x += 3) p.set(x, 1, P.gold[3]);
      // 鬓边一朵红花
      flower(p, 22, 16, [P.red[1], P.red[2], P.red[3]], true);
    },
    back: (p, spec) => {
      lace(
        p,
        mask((m) =>
          m.poly(
            [
              [12, 6],
              [30, 4],
              [44, 10],
              [51, 24],
              [54, 44],
              [56, 63],
              [4, 63],
              [6, 30],
            ],
            ON,
          ),
        ),
        spec,
      );
    },
  },
  capotain: {
    clipY: 14,
    shadeRows: [17, 18],
    front: (p, spec) => {
      // 高顶宽边帽：略收的高帽冠、平直的宽帽檐，帽带上一枚银方扣
      const r = spec.hatColor === "white" || spec.hatColor === "cream" || spec.hatColor === "gold" ? CLOTH.black : CLOTH[spec.hatColor === "brown" ? "brown" : "black"];
      const crown = mask((m) =>
        m.poly(
          [
            [19, 14],
            [21, 0],
            [39, 0],
            [42, 14],
          ],
          ON,
        ),
      );
      shadeMask(p, crown, r);
      p.hline(21, 39, 0, r[2]);
      brim(p, 31, 15, 20, 2.5, r, P.night[0]);
      p.rect(20, 10, 22, 3, CLOTH.black[0]);
      p.hline(20, 41, 10, r[2]);
      const s = METAL.silver;
      p.stroke(28, 9, 5, 5, s[2]);
      p.set(28, 9, s[3]);
      p.set(32, 13, s[0]);
    },
  },
  lacecap: {
    clipY: 0,
    front: (p) => {
      // 白麻布软帽：包住头顶偏后与近侧后脑，前沿从耳后斜上到远侧头顶，镶一圈蕾丝褶边；前额的头发露在外面
      const w = CLOTH.white;
      const m = mask((m) =>
        m.poly(
          [
            [13, 29],
            [12, 18],
            [15, 9],
            [22, 4],
            [31, 2.5],
            [40, 4],
            [45, 8],
            [36, 9],
            [27, 12],
            [22, 18],
            [20, 28],
          ],
          ON,
        ),
      );
      shadeMask(p, m, w, { lightX: 24, darkX: 44 });
      // 布帽上两道褶
      p.line(17, 10, 15, 22, w[0]);
      p.line(24, 6, 20, 14, w[1]);
      // 蕾丝褶边：沿前沿一串小扇贝（白与奶白交替），外缘一圈镂空点
      const edge: Pt[] = [
        [20, 29],
        [21, 22],
        [24, 15],
        [30, 10.5],
        [37, 8.5],
        [45, 8],
      ];
      for (let i = 0; i + 1 < edge.length; i++) {
        const [x0, y0] = edge[i];
        const [x1, y1] = edge[i + 1];
        const n = Math.round(Math.hypot(x1 - x0, y1 - y0));
        for (let k = 0; k <= n; k++) {
          const x = Math.round(x0 + ((x1 - x0) * k) / n);
          const y = Math.round(y0 + ((y1 - y0) * k) / n);
          const scallop = (x + y) % 3 === 0;
          p.set(x, y, P.white);
          p.set(x + 1, y, scallop ? w[0] : P.white);
          p.set(x + 1, y + 1, scallop ? null : w[1]);
        }
      }
      // 后颈的系带
      p.line(14, 29, 17, 36, w[1]);
      p.line(15, 29, 18, 36, w[0]);
    },
  },
  crown: {
    clipY: 0,
    front: (p) => {
      // 发冠：束在头顶发髻上的金冠，前嵌一颗红玉，一根长簪横穿
      const g = METAL.gold;
      const m = mask((m) =>
        m.poly(
          [
            [22, 8],
            [23, 2],
            [26, 4],
            [28, 0],
            [30, 4],
            [33, 2],
            [33, 8],
          ],
          ON,
        ),
      );
      shadeMask(p, m, [g[0], g[1], g[2]], { lightX: 27, darkX: 31 });
      p.hline(22, 33, 7, g[0]);
      p.set(28, 5, P.red[2]);
      p.set(27, 5, P.red[3]);
      // 横穿的玉簪
      p.line(15, 6, 40, 3, P.jade[3]);
      p.line(15, 7, 40, 4, P.jade[1]);
      p.circle(40, 3.5, 1.2, P.jade[4]);
    },
  },
  hairpin: {
    clipY: 0,
    front: (p, spec) => {
      // 发簪：斜插在发髻上的金簪，簪头一朵花，垂两串小珠
      const g = METAL.gold;
      const x = spec.hair === "twinbuns" ? 14 : 13;
      const y = spec.hair === "updo" ? 3 : spec.hair === "twinbuns" ? 3 : 7;
      p.line(x, y, x + 14, y + 6, g[1]);
      p.line(x, y - 1, x + 13, y + 5, g[2]);
      flower(p, x, y - 1, spec.hatColor === "jade" || spec.hatColor === "teal" ? [P.jade[2], P.jade[3], P.jade[4]] : [P.red[1], P.red[2], P.red[3]], false);
      for (let i = 0; i < 4; i++) {
        p.set(x - 1, y + 2 + i * 2, g[2]);
        p.set(x - 1, y + 3 + i * 2, i === 3 ? P.red[2] : g[0]);
        p.set(x + 2, y + 2 + i * 2, g[2]);
        p.set(x + 2, y + 3 + i * 2, i === 3 ? P.jade[3] : g[0]);
      }
      // 第二支：远侧的小玉簪
      p.line(36, 6, 44, 9, P.jade[3]);
      p.set(44, 9, P.jade[4]);
    },
  },
  slouch: {
    clipY: 14,
    shadeRows: [17, 18, 19],
    front: (p, spec) => {
      // 软宽檐帽：帽冠中间压出一道凹，帽檐前低后翘，皮质帽带
      const r = CLOTH[spec.hatColor === "white" || spec.hatColor === "cream" || spec.hatColor === "gold" ? "brown" : spec.hatColor];
      const deep = CLOTH_DEEP[spec.hatColor === "white" || spec.hatColor === "cream" || spec.hatColor === "gold" ? "brown" : spec.hatColor];
      const br = mask((m) => {
        m.ellipse(31, 15, 23, 4, ON);
        m.ellipse(12, 13, 5, 3, ON);
      });
      shadeMask(p, br, r, { lightX: 20, darkX: 46 });
      p.line(10, 18, 52, 18, deep);
      const crown = mask((m) =>
        m.poly(
          [
            [19, 15],
            [20, 6],
            [25, 3],
            [30, 5],
            [35, 3],
            [41, 6],
            [42, 15],
          ],
          ON,
        ),
      );
      shadeMask(p, crown, r, { darkX: 37 });
      p.line(30, 5, 30, 11, r[0]);
      p.rect(19, 12, 24, 3, CLOTH.leather[0]);
      p.hline(19, 42, 12, CLOTH.leather[1]);
      p.set(24, 13, METAL.silver[3]);
      p.set(25, 13, METAL.silver[1]);
    },
  },
  veil: {
    clipY: 12,
    keepBack: false,
    coversEars: true,
    front: (p, spec) => {
      const r = veilRamp(spec);
      // 包头纱：像兜帽一样裹住头发与耳朵，垂到肩上
      const m = mask((m) => {
        m.ellipse(30.5, 15, 17.5, 13.5, ON);
        m.poly(
          [
            [11, 16],
            [22, 21],
            [24, 42],
            [18, 50],
            [8, 48],
          ],
          ON,
        );
        m.ellipse(35, 28, 11.5, 16, null);
      });
      shadeMask(p, m, r, { lightX: 19, darkX: 42 });
      folds(p, m, r[0], 6);
      // 额前一排金币流苏
      for (let x = 23; x <= 45; x += 3) {
        const y = 14 + Math.round(Math.abs(x - 33) / 9);
        p.set(x, y, METAL.gold[2]);
        p.set(x, y + 1, METAL.gold[1]);
      }
      p.circle(33, 16, 1.5, METAL.gold[2]);
      p.set(33, 16, P.red[2]);
      // 面纱：一块独立于脸型的垂布——上沿平直地压在鼻梁下，两侧竖直落下（近侧收进头纱里、远侧超出下颌 2 像素），
      // 下缘垂到下巴以下、收成一道浅弧盖住颈与衣领；不勾出下颌线，读作垂下来的布，而不是口罩或彩色的皮肤。
      // 用头纱的基色平涂，从金边往下两道竖向的软褶（暗阶一列、受光一列），远侧背光；嘴的位置不点暗色。
      const top = 35;
      const hem = (x: number) => 47 + Math.round(4 * (1 - ((x - 35) / 12.5) ** 2));
      const face = mask((m) => {
        for (let x = 23; x <= 47; x++) for (let y = top; y <= hem(x); y++) m.set(x, y, ON);
      });
      // 白、奶白的纱：奶白的最亮一阶就是纯白，蒙在脸上太刺眼，改用奶白的中间色、远侧落在灰米色里；
      // 纱与皮肤的明度太接近时（相差不到 15%）整块换成布色的暗一阶（像同一块布落在下巴的阴影里），免得读成没有嘴的一张脸——
      // 不换成亮一阶：浅色的一块平涂蒙在脸上正是“口罩”的样子（翠绿纱会变成薄荷色的医用口罩）
      const pale = spec.hatColor === "white" || spec.hatColor === "cream";
      const skinBase = luma(rgba(faceRamp(spec.skin)[3]));
      const close = Math.abs(luma(rgba(r[1])) - skinBase) < skinBase * 0.15;
      const deep = CLOTH_DEEP[spec.hatColor];
      const [vDeep, vFar, vBase, vLight] = pale
        ? [CLOTH.cream[0], P.plaster[2], CLOTH.cream[1], CLOTH.cream[1]]
        : close
          ? [deep, deep, r[0], r[1]]
          : [r[0], r[0], r[1], r[2]];
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (!face.isOpaque(x, y)) continue;
          let c: string = x >= 43 ? vFar : vBase;
          if (x === 23 || x === 24) c = vLight;
          // 两道竖向软褶：从金边下一行起，暗阶一列、左边受光一列
          if (y >= top + 2 && (x === 29 || x === 39)) c = vDeep;
          if (y >= top + 2 && (x === 28 || x === 38) && !pale) c = vLight;
          if (!face.isOpaque(x, y + 1) || !face.isOpaque(x + 1, y)) c = vDeep;
          p.set(x, y, c);
        }
      }
      // 挂面纱的上缘：一道金边，金珠一亮一暗
      for (let x = 23; x <= 47; x++) p.set(x, top, METAL.gold[x % 3 === 0 ? 3 : 2]);
      p.set(35, hem(35) + 1, METAL.gold[2]);
      p.set(35, hem(35) + 2, METAL.gold[1]);
    },
    back: (p, spec) => {
      const r = veilRamp(spec);
      p.poly(
        [
          [11, 13],
          [45, 11],
          [51, 29],
          [54, 56],
          [5, 58],
          [7, 32],
        ],
        r[0],
      );
    },
  },
};

/** 头纱与面纱的布：同一块料子；白色的头纱用奶白（纯白在脸上太刺眼）。 */
function veilRamp(spec: PortraitSpec): Ramp3 {
  return spec.hatColor === "white" ? CLOTH.cream : CLOTH[spec.hatColor];
}

/**
 * 蕾丝：平涂的纱底上一张 4 像素间距的稀疏方网（网线亮一阶、网眼交点再亮一阶），边缘一圈亮一阶的蕾丝边——
 * 花样明确，不逐格交替，也不用斜向的细网（斜网在交点会凑成棋盘格）。黑纱或白纱。
 */
function lace(p: Px, m: Px, spec: PortraitSpec): void {
  const light = spec.hatColor === "white" || spec.hatColor === "cream";
  const base = light ? P.plaster[3] : P.cloth.black[0];
  const net = light ? P.plaster[2] : P.cloth.black[1];
  const knot = light ? P.white : P.cloth.black[2];
  const edge = light ? P.plaster[1] : P.cloth.black[1];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!m.isOpaque(x, y)) continue;
      const rim = !m.isOpaque(x - 1, y) || !m.isOpaque(x + 1, y) || !m.isOpaque(x, y + 1);
      const u = ((x % 4) + 4) % 4;
      const v = ((y % 4) + 4) % 4;
      let c: string = base;
      if (rim) c = edge;
      else if (u === 1 && v === 1) c = knot;
      else if (u === 1 || v === 1) c = net;
      p.set(x, y, c);
    }
  }
}

export function hatDef(kind: HatKind): HatDef | null {
  return kind === "none" ? null : HATS[kind];
}
