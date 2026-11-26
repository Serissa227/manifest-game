// H03 看得见的海（航行视图）：天气团与别的船的画法。纯绘制与纯计算，不持有游戏状态。
//
// - 天气团：按“每格 8 块”的粗像素画成一张小图（与缩放无关，缓存），按整数块放大贴到海面上——边缘按块的散列参差，
//   风暴团是一块压暗的蓝灰、外圈淡一级，里面逐帧落短雨线；雾团是一片白，外圈更淡；飑是浅灰、雨线稀。
//   团只画在海面上、盖在瓦片之上、航迹与船之下，标记很淡，不遮海面。
// - 别的船：远于视野 2/3 的是“帆影”（一角淡色的帆，看不出是谁）；近了画小小的俯视船身 + 帆 + 旗（商船米白帆、
//   海盗黑帆红旗、自己的别的船队浅蓝旗），船身长短按几艘船。正在追你的海盗另画一条淡红的虚线（当天会走到哪）。
// - 船位：按分钟追击的海盗用后端给的当天航迹（每 15 分钟一点）插值；走航线的船在日初与预计日末两点之间按分钟插值。
import { P } from "../art/palette";
import type { NavCell, NavShip } from "../ipc/types";
import { nearestCopy } from "./wrap";

/** 天气团小图的分辨率：每格几块——与细海图的美术像素一致（每格 24 个，缺省档一块 2 个屏幕像素）。 */
export const CELL_BLOCKS = 24;

/** 0–1 的确定性散列（同一组整数总得同一个值）。 */
export function hash01(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 天气团的配色：从外到内三级 [r, g, b, a]（a 为 0–255）。 */
export function cellColors(kind: NavCell["kind"]): [number, number, number, number][] {
  if (kind === "storm") return [[30, 36, 60, 56], [24, 28, 50, 96], [18, 22, 42, 124]];
  if (kind === "fog") return [[228, 234, 240, 44], [232, 238, 242, 86], [240, 244, 246, 124]];
  // 飑：偏冷的石板灰，比风暴淡、比雾暗，看得出又不压海面
  return [[64, 78, 104, 48], [56, 70, 98, 80], [50, 64, 92, 104]];
}

/**
 * 天气团的块图：边长 2r 格 × CELL_BLOCKS 块，每块 0（空）/ 1（外圈）/ 2（中圈）/ 3（内圈）。
 * 边缘按 JAG × JAG 块的粗格散列参差；雾另按更大的粗格加减一级（一缕缕的浓淡）。纯函数，测试用；画法见 cellCanvas。
 */
export function cellMask(r: number, id: string, kind: NavCell["kind"] = "storm", blocks = CELL_BLOCKS): { n: number; data: Uint8Array } {
  const n = Math.max(2, Math.ceil(2 * r * blocks));
  const data = new Uint8Array(n * n);
  const seed = seedOf(id);
  const half = n / 2;
  const rb = r * blocks;
  // 参差的台阶按每格的块数换算（航行视图每格 24 块时 6 块一级）
  const JAG = Math.max(1, Math.round((blocks * 6) / CELL_BLOCKS));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / rb;
      const jag = (hash01(Math.floor(x / JAG), Math.floor(y / JAG), seed) - 0.5) * 0.22;
      let v = d < 0.5 + jag ? 3 : d < 0.78 + jag ? 2 : d < 1 + jag * 0.5 ? 1 : 0;
      if (v > 0 && kind === "fog") {
        // 雾的浓淡：顺着横向斜飘的几缕（两道正弦叠起来，按台阶取样，边缘仍是一级一级的），浓处加一级、薄处减一级
        const gx = Math.floor(x / JAG) * JAG;
        const gy = Math.floor(y / JAG) * JAG;
        const ph = (seed % 628) / 100;
        const wisp = Math.sin((gx * 2.2 + gy * 6.4) / rb + ph) + 0.6 * Math.sin((gx * 7.1 - gy * 1.8) / rb + ph * 2);
        if (wisp < -0.7) v = Math.max(1, v - 1);
        else if (wisp > 0.9) v = Math.min(3, v + 1);
      }
      data[y * n + x] = v;
    }
  }
  return { n, data };
}

const cellArt = new Map<string, HTMLCanvasElement | null>();

/** 天气团的小图（画布，按 id、种类、半径缓存；没有 2D 画布时为 null）。 */
function cellCanvas(c: NavCell): HTMLCanvasElement | null {
  const key = `${c.id}:${c.kind}:${c.r.toFixed(2)}`;
  if (cellArt.has(key)) return cellArt.get(key) ?? null;
  if (cellArt.size > 64) cellArt.clear();
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined" && typeof ImageData !== "undefined") {
    const { n, data } = cellMask(c.r, c.id, c.kind);
    canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const colors = cellColors(c.kind);
      const img = new ImageData(n, n);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!v) continue;
        const [r, g, b, a] = colors[v - 1];
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
    } else canvas = null;
  }
  cellArt.set(key, canvas);
  return canvas;
}

export interface SeaCamera {
  cx: number;
  cy: number;
  cellPx: number;
  viewW: number;
  viewH: number;
  width: number;
  wrap: boolean;
}

/** 天气团：小图 + 风暴与飑里的雨线（time 毫秒）。smooth 为真时小图平滑放大（H10c：底下是平滑的高清海图，硬边的方块显得突兀）。 */
export function drawCells(ctx: CanvasRenderingContext2D, cam: SeaCamera, cells: readonly NavCell[], time: number, windDir: number | null, smooth = false): void {
  if (cells.length === 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = "high";
  const block = cam.cellPx / CELL_BLOCKS;
  for (const c of cells) {
    const ux = nearestCopy(c.x, cam.cx, cam.width, cam.wrap);
    const sx = cam.viewW / 2 + (ux - cam.cx) * cam.cellPx;
    const sy = cam.viewH / 2 + (c.y - cam.cy) * cam.cellPx;
    const R = c.r * cam.cellPx;
    if (sx + R < 0 || sy + R < 0 || sx - R > cam.viewW || sy - R > cam.viewH) continue;
    const art = cellCanvas(c);
    if (art) {
      const x0 = Math.round(sx - (art.width * block) / 2);
      const y0 = Math.round(sy - (art.height * block) / 2);
      ctx.drawImage(art, x0, y0, Math.round(art.width * block), Math.round(art.height * block));
    }
    if (c.kind === "fog") continue;
    // 雨线：团内散列的位置，顺着风斜落；风暴密、飑次之；数量随面积、有上限
    const slant = windDir === null ? 0.25 : Math.sin(((windDir + 180) * Math.PI) / 180) * 0.45;
    const storm = c.kind === "storm";
    const count = Math.min(storm ? 160 : 90, Math.round(c.r * c.r * (storm ? 2.4 : 1.8)));
    const seed = seedOf(c.id);
    const fall = cam.cellPx * 1.6;
    const len = Math.max(4, Math.round(cam.cellPx * 0.3));
    ctx.strokeStyle = storm ? "rgba(196, 210, 236, 0.55)" : "rgba(214, 226, 242, 0.5)";
    ctx.lineWidth = Math.max(1, Math.round(block));
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const a = hash01(i, 1, seed) * Math.PI * 2;
      const rr = Math.sqrt(hash01(i, 2, seed)) * 0.85;
      const phase = (time / (storm ? 700 : 520) + hash01(i, 3, seed)) % 1;
      const px = Math.round(sx + Math.cos(a) * rr * R + slant * phase * fall);
      const py = Math.round(sy + Math.sin(a) * rr * R + (phase - 0.5) * fall);
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.round(slant * len), py + len);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 某分钟的船位：追击航迹按 15 分钟一点插值；走航线的在日初与日末之间插值；都没有时用后端给的点。 */
export function shipAt(s: NavShip, minute: number | null): { x: number; y: number } {
  if (minute === null) return { x: s.x, y: s.y };
  if (s.track.length > 1) {
    const f = Math.max(0, minute) / 15;
    const i = Math.min(s.track.length - 1, Math.floor(f));
    const j = Math.min(s.track.length - 1, i + 1);
    const t = Math.min(1, f - i);
    return { x: s.track[i][0] + (s.track[j][0] - s.track[i][0]) * t, y: s.track[i][1] + (s.track[j][1] - s.track[i][1]) * t };
  }
  if (s.from && s.to) {
    const t = Math.max(0, Math.min(1, minute / 1440));
    return { x: s.from[0] + (s.to[0] - s.from[0]) * t, y: s.from[1] + (s.to[1] - s.from[1]) * t };
  }
  return { x: s.x, y: s.y };
}

/** 船的配色：[帆, 旗]。 */
export function shipColors(kind: NavShip["kind"]): [string, string] {
  if (kind === "pirate") return ["#2b2530", P.red[2]];
  if (kind === "own") return [P.white, P.teal[3]];
  if (kind === "merchant") return [P.paper, P.gold[3]];
  return ["#f6efe0", "rgba(0,0,0,0)"];
}

/**
 * 别的船的小图（像素，船头朝上；画布 13 × 19）：帆影只有一面淡色的三角帆；近处的船有船身（长 9 / 11 / 13 像素，按 1 / 2 / 3+ 艘）、
 * 两道横帆与桅顶的旗。整个形状外面描一圈深色的边，小也看得清。返回像素列表 [x, y, 颜色]（相对中心），测试与画法共用。
 */
export function shipPixels(kind: NavShip["kind"], size: number): [number, number, string][] {
  const body = new Map<string, string>();
  const put = (x: number, y: number, c: string) => body.set(`${x},${y}`, c);
  const [sail, flag] = shipColors(kind);
  if (kind === "sail") {
    // 帆影：一面鼓起的三角帆（9 像素高、5 宽）、一根桅与一线白浪；外面描半透明的深边，雨线多的海面上也看得见
    for (let y = 0; y < 9; y++) for (let x = 0; x <= Math.min(4, Math.floor((y + 1) / 2)); x++) put(x, y - 6, sail);
    put(0, 3, "#b8955f");
    for (let x = -2; x <= 3; x++) put(x, 4, "rgba(232, 246, 250, 0.85)");
  } else {
    const len = size >= 3 ? 13 : size === 2 ? 11 : 9;
    const top = -Math.floor(len / 2);
    for (let y = 0; y < len; y++) {
      // 船头、船尾收窄
      const w = y === 0 ? 1 : y === 1 || y === len - 1 ? 2 : 3;
      for (let x = -1; x < w - 1; x++) put(x + (w === 1 ? 1 : 0), top + y, y < 2 ? P.wood[3] : P.wood[2]);
    }
    // 两道横帆（比船身宽）
    for (const row of [top + 3, top + Math.floor(len / 2) + 1]) for (let x = -3; x <= 3; x++) put(x, row, sail);
    // 桅顶的旗（两格）
    put(0, top - 1, flag);
    put(1, top - 1, flag);
    put(1, top - 2, flag);
  }
  const out: [number, number, string][] = [];
  const ink = kind === "sail" ? "rgba(26, 20, 35, 0.6)" : "#1a1423";
  if (ink) {
    for (const key of [...body.keys()]) {
      const [x, y] = key.split(",").map(Number);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${x + dx},${y + dy}`;
        if (!body.has(k)) {
          body.set(k, "");
          out.push([x + dx, y + dy, ink]);
        }
      }
    }
  }
  for (const [key, c] of body) {
    if (!c) continue;
    const [x, y] = key.split(",").map(Number);
    out.push([x, y, c]);
  }
  return out;
}

const shipArt = new Map<string, HTMLCanvasElement | null>();
const shipArtBig = new Map<string, HTMLCanvasElement | null>();
const SHIP_ART_W = 13;
const SHIP_ART_H = 19;
/** 平滑缩放时先按最近邻放大这么多倍再缩到屏上（像素边缘不糊成一团）。 */
const SHIP_ART_UP = 4;
/** 最长的船身（像素，3 艘以上）。 */
const SHIP_HULL_MAX = 13;

/** 放大过的小图（平滑缩放用）。 */
function shipCanvasBig(kind: NavShip["kind"], size: number): HTMLCanvasElement | null {
  const key = `${kind}:${Math.min(3, size)}`;
  if (shipArtBig.has(key)) return shipArtBig.get(key) ?? null;
  const src = shipCanvas(kind, size);
  let big: HTMLCanvasElement | null = null;
  if (src) {
    big = document.createElement("canvas");
    big.width = SHIP_ART_W * SHIP_ART_UP;
    big.height = SHIP_ART_H * SHIP_ART_UP;
    const ctx = big.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, big.width, big.height);
    } else big = null;
  }
  shipArtBig.set(key, big);
  return big;
}

function shipCanvas(kind: NavShip["kind"], size: number): HTMLCanvasElement | null {
  const key = `${kind}:${Math.min(3, size)}`;
  if (shipArt.has(key)) return shipArt.get(key) ?? null;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = SHIP_ART_W;
    canvas.height = SHIP_ART_H;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      for (const [x, y, c] of shipPixels(kind, size)) {
        ctx.fillStyle = c;
        ctx.fillRect(x + Math.floor(SHIP_ART_W / 2), y + Math.floor(SHIP_ART_H / 2), 1, 1);
      }
    } else canvas = null;
  }
  shipArt.set(key, canvas);
  return canvas;
}

export interface PlacedShip {
  ship: NavShip;
  x: number;
  y: number;
}

/** 按分钟摆好船位；追击的海盗的航向取航迹上前后两点（停着时沿用后端给的）。 */
export function placeShips(ships: readonly NavShip[], minute: number | null): PlacedShip[] {
  return ships.map((ship) => {
    const p = shipAt(ship, minute);
    if (ship.track.length > 1 && minute !== null) {
      const q = shipAt(ship, minute + 15);
      if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-3) {
        const heading = ((Math.atan2(q.x - p.x, -(q.y - p.y)) * 180) / Math.PI + 360) % 360;
        return { ship: { ...ship, heading }, x: p.x, y: p.y };
      }
    }
    return { ship, x: p.x, y: p.y };
  });
}

/**
 * 别的船。追你的海盗另画当天剩下的航迹（淡红虚线）。
 * smooth 为假时 scale 是像素倍率（与自己的船一致，原来的画法）；为真时 scale 是屏上的船长（像素，H10a），平滑缩放与旋转。
 */
export function drawShips(ctx: CanvasRenderingContext2D, cam: SeaCamera, ships: readonly PlacedShip[], scale: number, minute: number | null, unit: number, smooth = false): void {
  if (ships.length === 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = "high";
  const at = (x: number, y: number) => {
    const ux = nearestCopy(x, cam.cx, cam.width, cam.wrap);
    return { sx: cam.viewW / 2 + (ux - cam.cx) * cam.cellPx, sy: cam.viewH / 2 + (y - cam.cy) * cam.cellPx };
  };
  for (const { ship, x, y } of ships) {
    if (ship.chasing && ship.track.length > 1 && minute !== null) {
      ctx.setLineDash([unit * 0.3, unit * 0.4]);
      ctx.strokeStyle = "rgba(236, 106, 92, 0.55)";
      ctx.lineWidth = Math.max(1, unit / 8);
      ctx.beginPath();
      const p0 = at(x, y);
      ctx.moveTo(p0.sx, p0.sy);
      for (let i = Math.ceil(minute / 15); i < ship.track.length; i++) {
        const p = at(ship.track[i][0], ship.track[i][1]);
        ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const p = at(x, y);
    if (p.sx < -40 || p.sy < -40 || p.sx > cam.viewW + 40 || p.sy > cam.viewH + 40) continue;
    const art = smooth ? shipCanvasBig(ship.kind, ship.size) : shipCanvas(ship.kind, ship.size);
    if (!art) continue;
    ctx.save();
    if (smooth) {
      // scale 是最长的船身（13 像素，3 艘以上）在屏上的长度；画布比船身长一截（帆与留白）
      const k = scale / SHIP_HULL_MAX;
      const w = SHIP_ART_W * k;
      const h = SHIP_ART_H * k;
      ctx.translate(p.sx, p.sy);
      if (ship.kind !== "sail") ctx.rotate((ship.heading * Math.PI) / 180);
      ctx.drawImage(art, -w / 2, -h / 2, w, h);
    } else {
      ctx.translate(Math.round(p.sx), Math.round(p.sy));
      if (ship.kind !== "sail") ctx.rotate((ship.heading * Math.PI) / 180);
      ctx.drawImage(art, Math.round((-art.width * scale) / 2), Math.round((-art.height * scale) / 2), art.width * scale, art.height * scale);
    }
    ctx.restore();
  }
  ctx.restore();
}
