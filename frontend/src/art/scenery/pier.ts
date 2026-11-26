// 码头：侧视的栈桥（桥面、桩、缆柱、缆绳）。
// 图高 PIER_H，桥面顶在第 PIER_DECK_Y 行（其上是缆柱与缆绳）；桩一直画到图底，由街景把海面、白浪叠在水线处。
// 已有画法的五种风格各有差异（mediterranean、frontier 暂借用 lowland、nordic）：东方朱漆缆柱、北地粗原木桥面与石砌桥墩、低地铸铁缆柱、沙漠浅色晒白木与砂岩缆柱、群岛竹木与渔网。
import { drawnStyle, type ArchStyle } from "../buildings";
import { P, ink } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { h2, mix, outlineInPlace } from "./util";

/** 码头图的高度。 */
export const PIER_H = 26;
/** 桥面顶边所在的行（街景可据此让人物、货箱站在桥面上）。 */
export const PIER_DECK_Y = 6;

type Ramp = readonly Rgba[];
const R = (...cs: (string | Rgba)[]): Ramp => cs.map((c) => rgba(c));

interface PierLook {
  deck: Ramp; // 由暗到亮 5 阶
  pile: Ramp; // 4 阶
  post: Ramp; // 4 阶
  cap: Ramp; // 缆柱顶 2 阶
  rope: Ramp; // 2 阶
  pileGap: number;
  postGap: number;
}

const NORDIC_LOOK: PierLook = {
  deck: R(P.wood[0], P.wood[1], P.wood[2], mix(P.wood[2], P.wood[3], 0.5), P.wood[3]),
  pile: R(P.stone[0], P.stone[1], P.stone[2], P.stone[3]),
  post: R(P.wood[0], P.wood[1], P.wood[2], P.wood[3]),
  cap: R(P.iron[1], P.iron[3]),
  rope: R(P.straw[0], P.straw[1]),
  pileGap: 24,
  postGap: 34,
};

const LOWLAND_LOOK: PierLook = {
  deck: R(P.wood[0], P.wood[1], P.wood[2], P.wood[3], P.wood[4]),
  pile: R(P.wood[0], P.wood[1], P.wood[2], P.wood[3]),
  post: R(P.iron[0], P.iron[1], P.iron[2], P.iron[3]),
  cap: R(P.gold[1], P.gold[3]),
  rope: R(P.straw[1], P.straw[3]),
  pileGap: 13,
  postGap: 28,
};

/**
 * 风格 → 码头配色。mediterranean、frontier 暂借用 lowland、nordic 的码头画法，
 * 只换几处配色以便区分：白灰缆柱配陶红柱帽、原木桥墩配木柱帽（正式画法实现后替换）。
 */
const LOOKS: Record<ArchStyle, PierLook> = {
  mediterranean: { ...LOWLAND_LOOK, post: R(P.plaster[0], P.plaster[1], P.plaster[2], P.plaster[3]), cap: R(P.brick[2], P.brick[3]) },
  nordic: NORDIC_LOOK,
  lowland: LOWLAND_LOOK,
  eastern: {
    deck: R(P.wood[0], P.wood[1], mix(P.wood[1], P.wood[2], 0.5), P.wood[2], P.wood[3]),
    pile: R(P.wood[0], P.wood[1], P.wood[2], mix(P.wood[2], P.wood[3], 0.5)),
    post: R(P.red[0], P.red[1], P.red[2], P.red[3]),
    cap: R(P.jade[1], P.jade[3]),
    rope: R(P.straw[1], P.straw[2]),
    pileGap: 14,
    postGap: 30,
  },
  desert: {
    deck: R(P.sand[0], P.sand[1], P.sand[2], P.sand[3], P.sand[4]),
    pile: R(P.wood[0], P.wood[1], mix(P.wood[2], P.sand[2], 0.5), P.sand[3]),
    post: R(P.sand[0], P.sand[1], P.sand[2], P.sand[3]),
    cap: R(P.sand[2], P.sand[4]),
    rope: R(P.teal[1], P.teal[3]),
    pileGap: 15,
    postGap: 32,
  },
  islands: {
    deck: R(P.straw[0], P.straw[1], mix(P.straw[2], P.leaf[3], 0.3), P.straw[2], P.straw[3]),
    pile: R(P.straw[0], P.straw[1], mix(P.straw[2], P.leaf[3], 0.3), P.straw[3]),
    post: R(P.straw[0], P.straw[1], mix(P.straw[2], P.leaf[3], 0.3), P.straw[3]),
    cap: R(P.straw[1], P.straw[3]),
    rope: R(P.wood[1], P.straw[2]),
    pileGap: 10,
    postGap: 26,
  },
  frontier: { ...NORDIC_LOOK, pile: R(P.wood[0], P.wood[1], P.wood[2], P.wood[3]), cap: R(P.wood[1], P.wood[3]) },
};

/** 竖直的桩：左亮右暗；stone 为真时画成石块砌的桥墩，bamboo 为真时加竹节。 */
function pile(p: Px, x: number, y0: number, wdt: number, L: PierLook, kind: "wood" | "stone" | "bamboo", seed: number): void {
  const [c0, c1, c2, c3] = L.pile;
  for (let y = y0; y < p.h; y++) {
    const wet = y >= p.h - 6;
    for (let i = 0; i < wdt; i++) {
      let c = i === 0 ? c3 : i === wdt - 1 ? c1 : c2;
      if (kind === "stone") {
        // 石块：每 4 行一层，错缝
        const row = Math.floor((y - y0) / 4);
        const joint = (y - y0) % 4 === 3 || (i + (row % 2) * 3) % 6 === 5;
        if (joint) c = c0;
        else if ((y - y0) % 4 === 0 && i < wdt - 1) c = c3;
        else c = i === wdt - 1 ? c1 : c2;
      }
      if (kind === "bamboo" && (y - y0) % 5 === 4) c = i === 0 ? c2 : c0;
      if (wet) c = mix(c, (y - (p.h - 6)) % 3 === 0 ? P.teal[0] : P.leaf[0], 0.45);
      p.put(x + i, y, c);
    }
  }
  // 水线以上的一道湿痕
  if (kind !== "stone") p.put(x + Math.floor(h2(seed, x) * wdt), p.h - 7, mix(c1, P.leaf[1], 0.5));
}

/** 缆柱：蘑菇头的短粗柱，腰上缠几圈缆绳。 */
function bollard(p: Px, x: number, L: PierLook, style: ArchStyle): void {
  const top = PIER_DECK_Y - 5;
  const [, p1, p2, p3] = L.post;
  for (let y = top + 1; y < PIER_DECK_Y; y++) {
    p.put(x, y, p3);
    p.put(x + 1, y, p2);
    p.put(x + 2, y, p2);
    p.put(x + 3, y, p1);
  }
  // 柱帽
  p.put(x - 1, top, L.cap[0]).put(x, top, L.cap[1]).put(x + 1, top, L.cap[1]).put(x + 2, top, L.cap[0]).put(x + 3, top, L.cap[0]).put(x + 4, top, L.cap[0]);
  if (style === "nordic") p.put(x + 1, top + 3, L.cap[1]).put(x + 2, top + 3, L.cap[0]).put(x, top + 3, L.cap[1]).put(x + 3, top + 3, L.cap[0]);
  else {
    // 缠绕的缆绳
    p.put(x, top + 3, L.rope[1]).put(x + 1, top + 3, L.rope[0]).put(x + 2, top + 3, L.rope[1]).put(x + 3, top + 3, L.rope[0]);
  }
}

/** 两根柱之间下垂的缆绳。 */
function sagRope(p: Px, x0: number, x1: number, y: number, sag: number, L: PierLook): void {
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / Math.max(1, x1 - x0);
    const yy = Math.round(y + sag * (1 - (2 * t - 1) * (2 * t - 1)));
    p.put(x, yy, (x & 1) === 0 ? L.rope[1] : L.rope[0]);
  }
}

/** 木码头（侧视的栈桥），宽 w。 */
export function drawPier(w: number, pierStyle: ArchStyle): Px {
  const style = drawnStyle(pierStyle);
  const L = LOOKS[pierStyle] ?? LOOKS.eastern;
  const p = new Px(Math.max(1, Math.floor(w)), PIER_H);
  const W = p.w;
  const D = PIER_DECK_Y;
  const [d0, d1, d2, d3, d4] = L.deck;
  // 桥面下的横梁（阴影里）
  for (let x = 0; x < W; x++) {
    p.put(x, D + 6, L.pile[0]);
    p.put(x, D + 7, (x >> 2) % 2 ? L.pile[1] : L.pile[0]);
  }
  // 桩
  const kind = style === "nordic" ? "stone" : style === "islands" ? "bamboo" : "wood";
  const pw = kind === "stone" ? 8 : kind === "bamboo" ? 2 : 3;
  for (let x = 3; x < W - 1; x += L.pileGap) pile(p, x, D + 6, pw, L, kind, 17);
  // 木桩之间的斜撑
  if (kind === "wood") {
    for (let x = 3; x + L.pileGap < W - 1; x += L.pileGap * 2) {
      p.line(x + pw, D + 8, x + L.pileGap - 1, D + 14, L.pile[1]);
      p.line(x + pw, D + 9, x + L.pileGap - 1, D + 15, L.pile[0]);
    }
  }
  // 桥面：顶边高光 + 正面的板头 / 原木 / 竹竿
  for (let x = 0; x < W; x++) {
    if (style === "nordic") {
      // 粗原木：上亮下暗的圆柱面，偶有树皮纹
      const bark = h2(0x91, x) < 0.12;
      p.put(x, D, d4);
      p.put(x, D + 1, d3);
      p.put(x, D + 2, bark ? d2 : d3);
      p.put(x, D + 3, d2);
      p.put(x, D + 4, bark ? d0 : d1);
      p.put(x, D + 5, d0);
      if (x % 38 === 37) for (let y = D; y <= D + 5; y++) p.put(x, y, d0);
    } else if (style === "islands") {
      // 两根横放的竹竿，竹节处一暗一亮
      const node = x % 9;
      p.put(x, D, d4);
      p.put(x, D + 1, node === 0 ? d1 : d3);
      p.put(x, D + 2, node === 0 ? d0 : d2);
      p.put(x, D + 3, (x + 4) % 9 === 0 ? d1 : d4);
      p.put(x, D + 4, (x + 4) % 9 === 0 ? d0 : d2);
      p.put(x, D + 5, d0);
    } else {
      // 木板：顶边高光，正面是一排板头
      const plank = x % 6;
      p.put(x, D, d4);
      p.put(x, D + 1, d3);
      for (let y = D + 2; y <= D + 4; y++) p.put(x, y, plank === 5 ? d1 : plank === 0 ? d3 : d2);
      p.put(x, D + 5, d0);
    }
  }
  // 竹码头：桩头与桥面相接处的绑绳
  if (kind === "bamboo") {
    for (let x = 3; x < W - 1; x += L.pileGap) {
      p.put(x - 1, D + 6, L.rope[1]).put(x + 2, D + 6, L.rope[1]).put(x, D + 6, L.rope[0]).put(x + 1, D + 6, L.rope[1]);
    }
  }
  // 缆柱 / 竹栏杆与缆绳
  const posts: number[] = [];
  for (let x = 8; x < W - 6; x += L.postGap) posts.push(x);
  if (style === "islands") {
    for (const x of posts) {
      for (let y = D - 8; y < D; y++) {
        p.put(x, y, (y - D) % 4 === 0 ? L.post[1] : L.post[3]);
        p.put(x + 1, y, (y - D) % 4 === 0 ? L.post[0] : L.post[2]);
      }
      p.put(x, D - 9, L.post[2]).put(x + 1, D - 9, L.post[1]);
    }
    for (let i = 0; i + 1 < posts.length; i++) {
      sagRope(p, posts[i] + 2, posts[i + 1] - 1, D - 7, 2, L);
      // 晾着的渔网：几道下垂的网线加竖向的结，下缘挂红白浮子
      if (i % 2 === 0) {
        const x0 = posts[i] + 2;
        const x1 = posts[i + 1] - 1;
        for (let k = 1; k <= 2; k++) {
          for (let x = x0; x <= x1; x++) {
            const t = (x - x0) / Math.max(1, x1 - x0);
            const arc = 1 - (2 * t - 1) * (2 * t - 1);
            const y = Math.round(D - 7 + k * 2 + (2 + k) * arc);
            if (y < D) p.put(x, y, L.rope[k === 2 ? 0 : 1]);
            if ((x - x0) % 3 === 0) for (let yy = Math.round(D - 7 + (k - 1) * 2 + (1 + k) * arc) + 1; yy < y && yy < D; yy++) p.put(x, yy, L.rope[0]);
          }
        }
        const fx = Math.round((x0 + x1) / 2);
        p.put(fx - 3, D - 1, P.red[2]).put(fx - 2, D - 1, P.white).put(fx + 2, D - 1, P.red[2]).put(fx + 3, D - 1, P.white);
      }
    }
  } else {
    for (let i = 0; i + 1 < posts.length; i++) sagRope(p, posts[i] + 4, posts[i + 1] - 1, D - 3, 2, L);
    for (const x of posts) bollard(p, x, L, style);
  }
  // 桥面之上的外轮廓描边；桩与桥面交接处的投影
  outlineInPlace(p, rgba(style === "nordic" ? ink.blue : ink.brown));
  for (let x = 0; x < W; x++) if (p.isOpaque(x, D + 6)) p.put(x, D + 6, mix(p.get(x, D + 6), ink.brown, 0.5));
  return p;
}
