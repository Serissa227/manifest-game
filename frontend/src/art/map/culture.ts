// 人文景观（EXPANSION.md §10.1、§10.4）：按地点的文化风格与周边的植被、高程，确定性地生成
//   田地——麦田条带、葡萄园与橄榄林（地中海）、梯田与稻田（东方）、带石墙的牧场（北地）、圩田与运河（低地）、
//         绿洲椰林与灌渠（沙漠）、种植园（热带）、林间开垦地（新大陆殖民地）、干燥海岸的盐田；
//   村落——离城越远越稀，屋顶与墙按文化风格；
//   建筑——首都附近的城堡、港口灯塔、瞭望塔、修道院（东方为宝塔）、山区矿场、风车（低地）、北地的木教堂、
//         沙漠的商队驿站、新大陆殖民港的木栅栏堡；
//   道路——按高程与植被的代价寻路（绕山、避开沼泽与密林），过河处画桥，不穿海。
// 田地与村落只出现在地点附近（各自的影响半径内）、且只在合适的陆地上（冰原、高山、火山地、奥术地貌、陡坡上没有）。
import { styleOf, type ArchStyle } from "../buildings";
import { P, ink } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { memo } from "../render";
import { fbmField, hash2, mix } from "./noise";
import { VEG, type Geo } from "./geo";
import { isNewWorld } from "./projection";
import { NEW_WORLD_X, type ChartInput, type ChartPlace, type ChartRiver } from "./types";

const R = (c: string): Rgba => rgba(c);

/** 田地种类（只追加）。 */
export const FIELD = {
  NONE: 0,
  /** 麦田条带（温带） */
  WHEAT: 1,
  /** 葡萄园（地中海） */
  VINE: 2,
  /** 橄榄林（地中海的坡地） */
  OLIVE: 3,
  /** 梯田（东方的坡地） */
  TERRACE: 4,
  /** 稻田（东方的平地） */
  PADDY: 5,
  /** 圩田与运河（低地） */
  POLDER: 6,
  /** 带石墙的牧场（北地、冻原边缘） */
  PASTURE: 7,
  /** 绿洲椰林与灌渠（沙漠） */
  OASIS: 8,
  /** 种植园（热带） */
  PLANTATION: 9,
  /** 林间开垦地（新大陆殖民地） */
  CLEARING: 10,
  /** 盐田（干燥的海岸） */
  SALT: 11,
  /** 菜园与芋田（群岛、热带的非殖民地）：小块的菜畦 */
  GARDEN: 12,
  /** 果园（群岛的温带岛）：成行的果树 */
  ORCHARD: 13,
} as const;

/** 去重后的地点（同样的地点只处理一次：地点数翻倍时耗时不变、结果相同）。 */
export interface UPlace {
  x: number;
  y: number;
  kind: ChartPlace["kind"];
  style: ArchStyle;
  /** 首都（势力的第一座内陆城市，没有城市时为第一座港口）：附近有城堡 */
  capital: boolean;
  /** 田地与村落的影响半径（格） */
  reach: number;
}

/**
 * 整理地点：去重、定风格、标出首都与影响半径。
 * world 决定哪些地点在“新大陆”：数字为新大陆的起始列（旧接口）；海图输入则按它的投影（有投影时按经度）或 newWorldX。
 */
export function uniquePlaces(places: readonly ChartPlace[], world: number | Pick<ChartInput, "projection" | "newWorldX"> = NEW_WORLD_X): UPlace[] {
  const inNewWorld = typeof world === "number" ? (x: number) => x >= world : (x: number) => isNewWorld(world, x);
  const seen = new Set<string>();
  const list: ChartPlace[] = [];
  for (const p of places) {
    const key = `${p.x},${p.y},${p.kind},${p.faction},${p.style ?? ""},${p.terrain ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(p);
  }
  const capitalOf = new Map<string, number>();
  list.forEach((p, i) => {
    if (!p.faction || p.kind === "site") return;
    const cur = capitalOf.get(p.faction);
    if (cur === undefined || (list[cur].kind !== "city" && p.kind === "city")) capitalOf.set(p.faction, i);
  });
  const capitals = new Set(capitalOf.values());
  return list.map((p, i) => {
    const style: ArchStyle = p.kind === "site" ? "frontier" : styleOf(p.faction || undefined, p.style);
    const colonial = p.kind === "site" || style === "frontier" || (inNewWorld(p.x) && style !== "eastern");
    const reach = p.kind === "site" ? 3.5 : colonial ? 5 : p.kind === "city" ? (capitals.has(i) ? 9 : 8) : capitals.has(i) ? 8 : 6.5;
    return { x: p.x, y: p.y, kind: p.kind, style: colonial && p.kind !== "site" && style !== "islands" && style !== "desert" ? "frontier" : style, capital: capitals.has(i), reach };
  });
}

/** 建筑种类。 */
export type StructureKind = "castle" | "lighthouse" | "watchtower" | "monastery" | "mine" | "windmill" | "church" | "pagoda" | "caravanserai" | "fort";

/** 一座建筑（x, y 为底边中点的像素坐标）。 */
export interface Structure {
  kind: StructureKind;
  x: number;
  y: number;
  style: ArchStyle;
}

/** 一间民居（x, y 为底边中点的像素坐标）。 */
export interface House {
  x: number;
  y: number;
  style: ArchStyle;
}

export interface CulturePlan {
  places: UPlace[];
  /** 每格的田地种类（FIELD） */
  field: Uint8Array;
  /** 每格的所属地点（places 的下标），没有为 −1 */
  owner: Int16Array;
  houses: House[];
  structures: Structure[];
}

/** 这种植被上能不能开垦（冰原、高山、火山地、奥术地貌不能）。 */
export function arable(veg: number): boolean {
  return veg !== VEG.ICE && veg !== VEG.ALPINE && veg !== VEG.VOLCANIC && veg !== VEG.ARCANE && veg < 200;
}

/**
 * 按文化风格、植被与高程选田地种类（d 为离地点的相对距离 0–1，h 为 [0,1) 的哈希）。
 * 种植园只属于热带的殖民地（新大陆的殖民港与殖民点）；群岛的温带岛是菜园、果园、葡萄与橄榄、坡上的芋田梯田。
 */
function fieldFor(style: ArchStyle, veg: number, relief: number, d: number, h: number): number {
  if (veg === VEG.DESERT) return d < 0.55 ? FIELD.OASIS : FIELD.NONE;
  if (veg === VEG.TUNDRA) return d < 0.6 ? FIELD.PASTURE : FIELD.NONE;
  if (style === "eastern") return relief >= 2 ? FIELD.TERRACE : FIELD.PADDY;
  if (veg === VEG.JUNGLE || veg === VEG.SAVANNA) return style === "frontier" ? (h < 0.5 ? FIELD.CLEARING : FIELD.PLANTATION) : FIELD.GARDEN;
  if (veg === VEG.WETLAND) return style === "lowland" ? FIELD.POLDER : style === "desert" ? FIELD.OASIS : FIELD.PASTURE;
  switch (style) {
    case "lowland":
      return relief <= 1 ? FIELD.POLDER : h < 0.8 ? FIELD.WHEAT : FIELD.PASTURE;
    case "nordic":
      return veg === VEG.GRASS || (veg === VEG.FOREST && h < 0.3) ? FIELD.WHEAT : FIELD.PASTURE;
    case "mediterranean":
      if (veg === VEG.MEDIT || veg === VEG.STEPPE) return relief >= 2 ? (h < 0.7 ? FIELD.OLIVE : FIELD.VINE) : h < 0.5 ? FIELD.VINE : FIELD.WHEAT;
      return h < 0.25 ? FIELD.VINE : FIELD.WHEAT;
    case "desert":
      return d < 0.5 ? FIELD.OASIS : veg === VEG.STEPPE || veg === VEG.MEDIT ? (h < 0.6 ? FIELD.OLIVE : FIELD.WHEAT) : FIELD.WHEAT;
    case "islands":
      if (veg === VEG.MEDIT || veg === VEG.STEPPE) return relief >= 2 ? (h < 0.6 ? FIELD.OLIVE : FIELD.VINE) : h < 0.5 ? FIELD.VINE : FIELD.GARDEN;
      // 坡上的芋田梯田，平地的果园与菜园
      if (relief >= 2 && h < 0.45) return FIELD.TERRACE;
      return h < 0.5 ? FIELD.ORCHARD : FIELD.GARDEN;
    case "frontier":
      return veg === VEG.GRASS || veg === VEG.STEPPE ? (h < 0.6 ? FIELD.WHEAT : FIELD.CLEARING) : FIELD.CLEARING;
    default:
      if (veg === VEG.MEDIT) return relief >= 2 ? FIELD.OLIVE : FIELD.VINE;
      if (veg === VEG.BOREAL) return FIELD.PASTURE;
      return h < 0.85 ? FIELD.WHEAT : FIELD.PASTURE;
  }
}

/** 规划人文景观（格级）：田地、村落与建筑的位置。C 为每格像素数。 */
export function planCulture(geo: Geo, places: readonly UPlace[], C: number, rivers: readonly ChartRiver[] = []): CulturePlan {
  const { W, H, terr, relief, veg, landDist } = geo;
  const N = W * H;
  const field = new Uint8Array(N);
  const owner = new Int16Array(N).fill(-1);
  const score = new Float32Array(N).fill(-1);
  const nPatch = fbmField(W, H, 3.2, 1501);
  const isLand = (i: number) => terr[i] === 2;
  // 离河 2 格以内的谷地更适合开垦：田地顺着河谷伸出去，坡地与高地少，不再是一个整圆
  const nearRiver = new Uint8Array(N);
  for (const r of rivers)
    for (const [rx, ry] of r.path)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(rx) + dx;
          const y = Math.round(ry) + dy;
          if (x >= 0 && y >= 0 && x < W && y < H) nearRiver[y * W + x] = 1;
        }
  places.forEach((p, k) => {
    const R0 = p.reach;
    const x0 = Math.max(0, Math.floor(p.x - R0));
    const x1 = Math.min(W - 1, Math.ceil(p.x + R0));
    const y0 = Math.max(0, Math.floor(p.y - R0));
    const y1 = Math.min(H - 1, Math.ceil(p.y + R0));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!isLand(i) || !arable(veg[i])) continue;
        const d = Math.hypot(x - p.x, y - p.y) / R0;
        if (d > 1) continue;
        const steep = relief[i] > (p.style === "eastern" ? 6 : 5);
        if (steep) continue;
        const s = (1 - d) * 1.1 + (nPatch(x, y) - 0.5) * 0.6 + (nearRiver[i] ? 0.28 : 0) - Math.max(0, relief[i] - 2) * 0.1 + (landDist[i] <= 2 ? 0.08 : 0);
        if (s > score[i]) {
          score[i] = s;
          owner[i] = k;
        }
      }
    }
  });
  for (let i = 0; i < N; i++) {
    const k = owner[i];
    if (k < 0 || score[i] < 0.3) continue;
    const p = places[k];
    const x = i % W;
    const y = Math.floor(i / W);
    const d = Math.hypot(x - p.x, y - p.y) / p.reach;
    field[i] = fieldFor(p.style, veg[i], relief[i], d, hash2(x, y, 1511));
  }
  // 盐田：干燥海岸的港口旁，平坦的海岸格
  places.forEach((p, k) => {
    if (p.kind !== "port") return;
    let n = 0;
    for (let dy = -4; dy <= 4 && n < 4; dy++)
      for (let dx = -4; dx <= 4 && n < 4; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!isLand(i) || landDist[i] > 1 || relief[i] > 0) continue;
        const v = veg[i];
        if (v !== VEG.MEDIT && v !== VEG.STEPPE && v !== VEG.DESERT && v !== VEG.SAVANNA) continue;
        if (Math.abs(dx) + Math.abs(dy) < 2 || hash2(x, y, 1521) > 0.55) continue;
        field[i] = FIELD.SALT;
        owner[i] = k;
        n++;
      }
  });

  // —— 村落 ——
  const houses: House[] = [];
  const houseAt = (i: number, k: number, salt: number) => {
    const x = i % W;
    const y = Math.floor(i / W);
    houses.push({ x: x * C + 1 + Math.floor(hash2(x, y, salt) * 2), y: y * C + 2 + Math.floor(hash2(x, y, salt + 1) * 2), style: places[k].style });
  };
  for (let i = 0; i < N; i++) {
    const k = owner[i];
    if (k < 0 || score[i] < 0.42 || field[i] === FIELD.SALT) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    if (veg[i] === VEG.DESERT && field[i] !== FIELD.OASIS) continue;
    const prob = 0.08 + (score[i] - 0.42) * 0.35;
    if (hash2(x, y, 1531) < prob) houseAt(i, k, 1533);
  }
  // 城郊：地点周围 2–3.5 格的一小簇民居
  places.forEach((p, k) => {
    const n = p.kind === "site" ? 2 : p.kind === "city" ? 6 : 4;
    for (let t = 0, placed = 0; t < 24 && placed < n; t++) {
      const a = hash2(k, t, 1541) * Math.PI * 2;
      const d = 2 + hash2(k, t, 1542) * 1.6;
      const x = Math.round(p.x + Math.cos(a) * d);
      const y = Math.round(p.y + Math.sin(a) * d);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (!isLand(i) || !arable(veg[i]) || relief[i] > 5) continue;
      if (veg[i] === VEG.DESERT && Math.hypot(x - p.x, y - p.y) > p.reach * 0.55) continue;
      houseAt(i, k, 1545 + t);
      placed++;
    }
  });

  // —— 建筑 ——
  // 地点标记（约 19×20 像素，画在格中心上方）及其四周不放建筑，免得被标记盖住
  const markerMask = new Uint8Array(N);
  for (const q of places)
    for (let y = q.y - 4; y <= q.y + 1; y++) for (let x = q.x - 4; x <= q.x + 4; x++) if (x >= 0 && y >= 0 && x < W && y < H) markerMask[y * W + x] = 1;
  const structures: Structure[] = [];
  // 同类建筑彼此至少隔开 5 格（相邻的几座港口不会各自带一座宝塔、风车挤成一片），不同类的至少隔开 8 像素
  const clash = (kind: StructureKind, x: number, y: number) =>
    structures.some((s) => (Math.abs(s.x - x) < 8 && Math.abs(s.y - y) < 8) || (s.kind === kind && kind !== "lighthouse" && Math.hypot(s.x - x, s.y - y) < C * 5));
  /** 在地点周围 [rMin, rMax] 格里按得分从高到低列出候选格（确定性，最多 limit 个）。 */
  const findCells = (p: UPlace, rMin: number, rMax: number, ok: (i: number, x: number, y: number) => boolean, rate: (i: number, x: number, y: number) => number, limit: number): number[] => {
    const cand: [number, number][] = [];
    const r = Math.ceil(rMax);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < rMin || d > rMax) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x;
        if (!isLand(i) || markerMask[i] || !ok(i, x, y)) continue;
        cand.push([rate(i, x, y), i]);
      }
    cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    return cand.slice(0, limit).map((c) => c[1]);
  };
  /** 得分最高的格，找不到为 −1。 */
  const findCell = (p: UPlace, rMin: number, rMax: number, ok: (i: number, x: number, y: number) => boolean, rate: (i: number, x: number, y: number) => number): number =>
    findCells(p, rMin, rMax, ok, rate, 1)[0] ?? -1;
  /** 按得分依次试候选格，直到放下为止（放不下的原因多半是挨着别的建筑）。 */
  const putFirst = (kind: StructureKind, cells: number[], style: ArchStyle, dy = 2) => {
    for (const i of cells) if (put(kind, i, style, dy)) return true;
    return false;
  };
  const put = (kind: StructureKind, i: number, style: ArchStyle, dy = 2) => {
    if (i < 0) return false;
    const x = (i % W) * C + Math.floor(C / 2);
    const y = Math.floor(i / W) * C + dy;
    if (clash(kind, x, y)) return false;
    structures.push({ kind, x, y, style });
    return true;
  };
  const seaAround = (x: number, y: number) => {
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && !isLand((y + dy) * W + x + dx)) n++;
    return n;
  };
  places.forEach((p, k) => {
    const h = (s: number) => hash2(k, s, 1551);
    const okLand = (i: number) => arable(veg[i]);
    if (p.capital) {
      putFirst(
        "castle",
        findCells(p, 3, 7, (i) => okLand(i) && relief[i] <= 6 && landDist[i] >= 1.5, (i, x, y) => relief[i] + hash2(x, y, 1561), 8),
        p.style,
      );
    }
    if (p.kind === "port" && h(1) < 0.8) {
      putFirst(
        "lighthouse",
        findCells(p, 2.6, 6, (i) => landDist[i] <= 1 && veg[i] !== VEG.ICE, (_i, x, y) => seaAround(x, y) + hash2(x, y, 1562) * 0.5, 4),
        p.style,
        3,
      );
    }
    if (p.kind !== "site" && h(2) < 0.4) {
      put(
        "watchtower",
        findCell(p, 3, 7, (i) => okLand(i) && relief[i] >= 1 && relief[i] <= 6, (i, x, y) => relief[i] * 0.6 + (landDist[i] <= 2 ? 1 : 0) + hash2(x, y, 1563)),
        p.style,
      );
    }
    if (p.kind !== "site" && h(3) < 0.5 && (p.style === "mediterranean" || p.style === "lowland" || p.style === "nordic")) {
      put(
        "monastery",
        findCell(p, p.reach * 0.6, p.reach + 6, (i) => okLand(i) && relief[i] >= 3 && relief[i] <= 6 && field[i] === FIELD.NONE, (i, x, y) => relief[i] + hash2(x, y, 1564)),
        p.style,
      );
    }
    if (p.kind !== "site" && h(4) < 0.6) {
      put(
        "mine",
        findCell(p, 3, p.reach + 10, (i) => veg[i] !== VEG.ICE && veg[i] !== VEG.ARCANE && relief[i] >= 5, (i, x, y) => relief[i] * 0.4 - Math.hypot(x - p.x, y - p.y) * 0.3 + hash2(x, y, 1565)),
        p.style,
      );
    }
    // 东方的城市与都城一定有宝塔（最近的几格放不下就挪到下一格，最远 8 格）
    if (p.style === "eastern" && (p.kind === "city" || p.capital || h(6) < 0.35)) {
      putFirst("pagoda", findCells(p, 2, 8, (i) => okLand(i) && relief[i] <= 6, (i, x, y) => relief[i] * 0.5 - Math.hypot(x - p.x, y - p.y) * 0.3 + hash2(x, y, 1566), 30), p.style);
    }
    if (p.style === "nordic" && p.kind !== "site" && h(7) < 0.6) {
      put("church", findCell(p, 2, 6, (i) => okLand(i) && relief[i] <= 4, (_i, x, y) => hash2(x, y, 1567)), p.style);
    }
    if (p.style === "desert" && p.kind !== "site" && h(8) < 0.5) {
      put("caravanserai", findCell(p, 4, 9, (i) => veg[i] === VEG.DESERT || veg[i] === VEG.STEPPE, (_i, x, y) => hash2(x, y, 1568)), p.style);
    }
    if (p.style === "frontier" && p.kind === "port") {
      put("fort", findCell(p, 2, 5, (i) => okLand(i) && relief[i] <= 4, (i, x, y) => landDist[i] + hash2(x, y, 1569)), p.style);
    }
    // 风车：低地的圩田与麦田里几座，别处的麦田偶尔一座
    const mills = p.style === "lowland" ? (h(5) < 0.5 ? 2 : 1) : p.style === "mediterranean" || p.style === "nordic" ? (h(5) < 0.3 ? 1 : 0) : 0;
    for (let t = 0, n = 0; t < 30 && n < mills; t++) {
      const i = findCell(
        p,
        1.5 + t * 0.2,
        p.reach,
        (j) => field[j] === FIELD.POLDER || field[j] === FIELD.WHEAT,
        (_j, x, y) => hash2(x, y, 1570 + t),
      );
      if (put("windmill", i, p.style)) n++;
    }
  });
  return { places: [...places], field, owner, houses, structures };
}

// ───────────────────────────── 田地的像素画法 ─────────────────────────────

/** 田地的逐像素配色（按季节预先打包）。 */
export class FieldPainter {
  private readonly wheat: Rgba[];
  private readonly hedge: Rgba;
  private readonly furrow: Rgba;
  private readonly snowField: Rgba[];
  private readonly bareHedge: Rgba;
  private readonly vineRow: Rgba;
  private readonly soil: Rgba;
  private readonly soilDark: Rgba;
  private readonly olive: Rgba;
  private readonly oliveShade: Rgba;
  private readonly paddy: Rgba[];
  private readonly dike: Rgba;
  private readonly terraceEdge: Rgba;
  private readonly terraceLip: Rgba;
  private readonly meadow: Rgba[];
  private readonly canal: Rgba;
  private readonly wall: Rgba;
  private readonly wallLite: Rgba;
  private readonly sheep: Rgba;
  private readonly palmDark: Rgba;
  private readonly palmLite: Rgba;
  private readonly oasisSoil: Rgba;
  private readonly bush: Rgba;
  private readonly bushLite: Rgba;
  private readonly track: Rgba;
  private readonly stump: Rgba;
  private readonly cleared: Rgba[];
  private readonly salt: Rgba[];
  private readonly saltRim: Rgba;
  private readonly pastureCol: Rgba[];
  private readonly pastureSnow: Rgba[];
  private readonly garden: Rgba[];
  private readonly gardenPath: Rgba;
  private readonly orchardTree: Rgba;
  private readonly orchardLite: Rgba;
  private readonly orchardGround: Rgba;

  constructor(readonly season: number) {
    const s = season;
    this.wheat = (
      s === 0
        ? [P.leaf[3], P.leaf[4], mix(P.leaf[3], P.straw[2], 0.4), P.wood[2], mix(P.leaf[4], P.straw[3], 0.3), P.leaf[3]]
        : s === 1
          ? [P.straw[2], P.straw[3], P.gold[3], P.leaf[3], mix(P.straw[3], P.leaf[4], 0.3), P.straw[3]]
          : s === 2
            ? [P.wood[2], P.straw[1], P.wood[3], P.straw[2], mix(P.wood[3], P.straw[2], 0.5), P.autumn[1]]
            : [mix(P.leaf[2], P.wood[2], 0.5), P.wood[2], mix(P.leaf[3], P.straw[1], 0.5), P.wood[3], P.leaf[2], P.straw[1]]
    ).map(R);
    this.hedge = R(s === 2 ? P.autumn[0] : P.leaf[1]);
    this.furrow = R(s === 1 ? P.straw[1] : P.wood[1]);
    this.snowField = [P.snow[2], P.snow[3], P.snow[2], P.snow[1]].map(R);
    this.bareHedge = R(P.wood[1]);
    this.vineRow = R(s === 2 ? P.autumn[1] : s === 3 ? P.wood[1] : OLIVE_DEEP);
    this.soil = R(s === 3 ? P.sand[2] : P.sand[3]);
    this.soilDark = R(P.sand[2]);
    this.olive = R(mix(P.leaf[2], P.stone[3], 0.35));
    this.oliveShade = R(mix(P.leaf[1], P.stone[1], 0.3));
    this.paddy = (
      s === 0
        ? [P.sky[3], P.teal[3], P.sky[4]]
        : s === 1
          ? [mix(P.leaf[4], P.jade[3], 0.35), P.leaf[4], mix(P.teal[2], P.leaf[3], 0.5)]
          : s === 2
            ? [P.straw[3], P.gold[3], P.straw[2]]
            : [P.straw[1], P.wood[2], P.straw[2]]
    ).map(R);
    this.dike = R(s === 3 ? P.wood[1] : P.leaf[2]);
    this.terraceEdge = R(s === 2 ? P.wood[1] : P.jade[0]);
    this.terraceLip = R(s === 3 ? P.straw[3] : s === 0 ? P.sky[4] : P.leaf[4]);
    this.meadow = (s === 2 ? [P.straw[2], mix(P.leaf[3], P.straw[2], 0.5), P.leaf[3]] : [P.leaf[3], P.leaf[4], mix(P.leaf[3], P.leaf[4], 0.5)]).map(R);
    this.canal = R(s === 3 ? P.snow[1] : P.sea[3]);
    this.wall = R(P.stone[2]);
    this.wallLite = R(P.stone[3]);
    this.sheep = R(P.white);
    this.palmDark = R(P.jade[1]);
    this.palmLite = R(P.leaf[3]);
    this.oasisSoil = R(mix(P.sand[3], P.leaf[3], 0.45));
    this.bush = R(P.jade[1]);
    this.bushLite = R(P.jade[3]);
    this.track = R(P.straw[2]);
    this.stump = R(P.wood[1]);
    this.cleared = [P.wood[3], P.straw[1], mix(P.wood[3], P.leaf[3], 0.4)].map(R);
    this.salt = [P.white, P.plaster[3], P.blossom[3]].map(R);
    this.saltRim = R(P.sand[2]);
    // 北地的牧场：偏灰的草色（不是高饱和的亮绿），冬季偏灰的米白
    this.pastureCol = (
      s === 2
        ? [mix(P.straw[2], P.stone[3], 0.35), mix(P.leaf[2], P.straw[1], 0.5), mix(P.straw[1], P.stone[2], 0.3)]
        : s === 3
          ? [mix(P.leaf[2], P.stone[2], 0.45), mix(P.leaf[1], P.stone[2], 0.4), mix(P.wood[2], P.stone[2], 0.4)]
          : [mix(P.leaf[3], P.stone[3], 0.35), mix(P.leaf[2], P.stone[2], 0.3), mix(P.leaf[3], P.straw[2], 0.3)]
    ).map(R);
    this.pastureSnow = [mix(P.snow[2], P.straw[3], 0.25), mix(P.snow[2], P.stone[3], 0.35), mix(P.snow[1], P.stone[3], 0.3)].map(R);
    this.garden = (s === 3 ? [P.wood[2], P.wood[3], P.leaf[2]] : s === 2 ? [P.straw[2], P.wood[3], P.leaf[3]] : [P.leaf[3], P.jade[2], P.leaf[4]]).map(R);
    this.gardenPath = R(P.wood[2]);
    this.orchardTree = R(s === 2 ? P.autumn[1] : s === 3 ? P.wood[1] : P.leaf[2]);
    this.orchardLite = R(s === 0 ? P.blossom[2] : s === 2 ? P.autumn[3] : P.leaf[3]);
    this.orchardGround = R(s === 3 ? mix(P.leaf[2], P.wood[2], 0.5) : mix(P.leaf[3], P.straw[2], 0.3));
  }

  /** 不规则的地块（抖动网格的 Voronoi）：返回（地块编号, 是否在地块边界上）。 */
  private plot(px: number, py: number, o: number, size: number): { id: number; edge: boolean } {
    const gx = Math.floor(px / size);
    const gy = Math.floor(py / size);
    let d1 = Infinity;
    let d2 = Infinity;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx;
        const cy = gy + dy;
        const sx = (cx + 0.15 + hash2(cx, cy, 90 + o) * 0.7) * size;
        const sy = (cy + 0.15 + hash2(cx, cy, 91 + o) * 0.7) * size;
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = (cy * 7919 + cx) | 0;
        } else if (d < d2) d2 = d;
      }
    return { id, edge: Math.sqrt(d2) - Math.sqrt(d1) < 1.1 };
  }

  /**
   * 田地像素的颜色；0 表示这个像素不画（保留地面）。owner 为所属地点（决定地块的错位），
   * hp 为像素的高程（梯田沿等高线），snowy 为该像素积雪。
   */
  color(kind: number, px: number, py: number, owner: number, hp: number, snowy: boolean): Rgba {
    const o = owner + 1;
    switch (kind) {
      case FIELD.PASTURE: {
        // 北地的牧场：不规则的地块，边界是断续的石墙；冬季是偏灰的米白，保留犁沟的影子与墙
        const { id, edge } = this.plot(px, py, o, 11);
        const k = Math.floor(hash2(id, o, 73) * 3);
        if (edge) return (px + py) % 3 === 0 ? 0 : (px + py) % 2 === 0 ? this.wall : this.wallLite;
        if (snowy || this.season === 3) {
          if (snowy) return py % 3 === 0 ? this.pastureSnow[2] : this.pastureSnow[k % 2];
        }
        if (hash2(px, py, 74) < 0.01 && this.season !== 3) return this.sheep;
        return this.pastureCol[k];
      }
      case FIELD.GARDEN: {
        // 菜园与芋田：小块的菜畦，田埂是土路
        const { id, edge } = this.plot(px, py, o, 6);
        if (edge) return this.gardenPath;
        if (snowy) return this.snowField[1];
        const k = Math.floor(hash2(id, o, 75) * 3);
        return (px + py * 2) % 3 === 0 ? this.garden[(k + 1) % 3] : this.garden[k];
      }
      case FIELD.ORCHARD: {
        // 果园：错位成行的圆形树冠
        const row = Math.floor((py + o) / 3);
        const tx = (px + (row % 2) * 2 + o) % 4;
        const ty = (py + o) % 3;
        if (snowy) return ty === 1 && tx === 1 ? this.orchardTree : this.snowField[0];
        if (ty === 1 && tx === 1) return this.orchardTree;
        if (ty === 0 && tx === 1) return this.orchardLite;
        return this.orchardGround;
      }
      case FIELD.WHEAT:
      case FIELD.VINE:
      case FIELD.OLIVE: {
        // 地块：每行错开的矩形（行高与块宽按行变化），田块小
        const fh = 5 + (o % 3);
        const row = Math.floor((py + o * 3) / fh);
        const off = Math.floor(hash2(row, o, 71) * 13);
        const fw = 6 + Math.floor(hash2(row, o, 72) * 6);
        const col = Math.floor((px + off) / fw);
        const r = (py + o * 3) - row * fh;
        const c = px + off - col * fw;
        const k = Math.floor(hash2(col, row, 73 + o) * 6);
        const edge = r === 0 || c === 0;
        if (edge) return snowy || this.season === 3 ? this.bareHedge : this.hedge;
        if (snowy) return this.snowField[k % 4];
        if (kind === FIELD.VINE) return r % 2 === 1 ? ((px + row) % 4 === 0 ? this.soilDark : this.vineRow) : this.soil;
        if (kind === FIELD.OLIVE) {
          const tx = (px + (row % 2) * 2) % 4;
          if (r % 3 === 1 && tx === 1) return this.olive;
          if (r % 3 === 2 && tx === 2) return this.oliveShade;
          return k < 3 ? this.soil : this.meadow[0];
        }
        if ((k === 1 || k === 4) && c % 2 === 0) return this.furrow;
        return this.wheat[k];
      }
      case FIELD.TERRACE: {
        // 梯田：沿等高线的一级级台阶，台坎是深色的影子、台沿一道亮线，一眼能认出来
        const t = hp * 3.4 + py * 0.06 + hash2(px >> 3, py >> 2, 75) * 0.12;
        const f = t - Math.floor(t);
        if (snowy) return f < 0.22 ? this.terraceEdge : this.snowField[0];
        if (f < 0.2) return this.terraceEdge;
        if (f < 0.34) return this.terraceLip;
        return this.paddy[Math.floor(t) % 3 === 0 ? 1 : 0];
      }
      case FIELD.PADDY: {
        // 田埂：每行的田块错开（7×5 像素），田埂是一道实线，田面三种颜色（秧苗、深绿、灌水）
        const gy = Math.floor((py + o * 2) / 5);
        const rowOff = Math.floor(hash2(gy, o, 84) * 7);
        const gx = Math.floor((px + o + rowOff) / 7);
        if ((py + o * 2) % 5 === 0) return this.dike;
        if ((px + o + rowOff) % 7 === 0) return hash2(gx, gy, 85) < 0.2 ? this.terraceLip : this.dike;
        if (snowy) return this.snowField[1];
        return this.paddy[Math.floor(hash2(gx, gy, 76) * 3)];
      }
      case FIELD.POLDER: {
        const fh = 5;
        const row = Math.floor((py + o) / fh);
        const off = Math.floor(hash2(row, o, 77) * 17);
        const fw = 14 + Math.floor(hash2(row, o, 78) * 9);
        const r = (py + o) - row * fh;
        const c = (px + off) % fw;
        if (r === 0) return row % 2 === 0 ? this.canal : this.hedge;
        if (c === 0) return this.hedge;
        if (snowy) return this.snowField[row % 4];
        return this.meadow[Math.floor(hash2(Math.floor((px + off) / fw), row, 79) * 3)];
      }
      case FIELD.OASIS: {
        // 绿洲：不规则的园地，灌渠沿一部分园地的边界走；园里是椰枣树丛与菜地
        const { id, edge } = this.plot(px, py, o + 3, 8);
        if (edge) return hash2(id, o, 86) < 0.45 ? this.canal : this.oasisSoil;
        const h = hash2(px >> 1, py >> 1, 80 + o);
        if (h < 0.5) return (px + py) % 3 === 0 ? this.palmLite : this.palmDark;
        return this.oasisSoil;
      }
      case FIELD.PLANTATION: {
        if ((py + o) % 9 === 0 || (px + o * 5) % 13 === 0) return this.track;
        if ((py + o) % 3 === 1) return px % 3 === 0 ? this.bush : px % 3 === 1 ? this.bushLite : this.cleared[1];
        return this.cleared[0];
      }
      case FIELD.CLEARING: {
        const h = hash2(px >> 2, py >> 2, 81 + o);
        if (h < 0.35) return 0;
        if (hash2(px, py, 82) < 0.05) return this.stump;
        if (snowy) return this.snowField[0];
        return h < 0.7 ? this.cleared[(px >> 2) % 2] : (py % 2 === 0 ? this.cleared[2] : this.cleared[1]);
      }
      case FIELD.SALT: {
        if (px % 4 === 0 || py % 3 === 0) return this.saltRim;
        return this.salt[Math.floor(hash2(px >> 2, Math.floor(py / 3), 83) * 3)];
      }
      default:
        return 0;
    }
  }
}

const OLIVE_DEEP = mix(P.leaf[2], P.straw[1], 0.45);

// ───────────────────────────── 民居与建筑的像素图 ─────────────────────────────

/** 民居字符图：r 屋顶亮面、R 屋顶暗面、w 墙、W 墙的阴面、d 门、t 高脚。 */
const HOUSE: Readonly<Record<ArchStyle, readonly string[]>> = {
  mediterranean: ["rrR", "wwW", "wdW"],
  lowland: [".rR", "rrR", "wwW", "wdW"],
  nordic: ["rrrR", "wwdW"],
  desert: ["rrR", "wdW"],
  islands: [".rR.", "rrRR", "wwdW", "t..t"],
  eastern: ["rrrR", ".wdW"],
  frontier: [".R.", "rrR", "wdW"],
};

function houseKey(style: ArchStyle, snowy: boolean): Record<string, string> {
  const d = ink.deep;
  let k: Record<string, string>;
  switch (style) {
    case "mediterranean":
      k = { r: P.brick[3], R: P.brick[2], w: P.plaster[3], W: P.plaster[1], d };
      break;
    case "lowland":
      k = { r: P.brick[2], R: P.brick[1], w: P.brick[4], W: P.brick[3], d };
      break;
    case "nordic":
      k = { r: P.leaf[2], R: P.leaf[1], w: P.wood[2], W: P.wood[1], d };
      break;
    case "desert":
      k = { r: P.sand[4], R: P.sand[3], w: P.sand[3], W: P.sand[2], d };
      break;
    case "islands":
      k = { r: P.straw[3], R: P.straw[2], w: P.wood[3], W: P.wood[2], d, t: P.wood[1] };
      break;
    case "eastern":
      k = { r: P.slate[2], R: P.slate[1], w: P.plaster[3], W: P.plaster[1], d };
      break;
    default:
      k = { r: P.wood[2], R: P.wood[1], w: P.wood[3], W: P.wood[2], d };
  }
  if (snowy && style !== "desert" && style !== "islands") {
    k.r = P.snow[3];
    k.R = P.snow[1];
  }
  return k;
}

/** 民居（x, y 为底边中点），右下落 1 像素的影子。 */
export function drawHouse(p: Px, x: number, y: number, style: ArchStyle, snowy: boolean): void {
  const rows = HOUSE[style];
  const w = rows[0].length;
  const x0 = x - Math.floor(w / 2);
  const y0 = y - rows.length + 1;
  p.hline(x0 + 1, x0 + w, y + 1, "#1a142344");
  p.vline(x0 + w, y0 + 1, y, "#1a142333");
  p.stamp(rows, houseKey(style, snowy), x0, y0);
}

/** 民居占的矩形（相对底边中点）：给放置时的避让用。 */
export function houseBox(style: ArchStyle): { w: number; h: number } {
  const rows = HOUSE[style];
  return { w: rows[0].length + 1, h: rows.length + 1 };
}

/** 建筑的像素图（带描边，底边中点在 (w/2, h−1)）。 */
export function structureSprite(kind: StructureKind, style: ArchStyle, season: number, snowy: boolean): Px {
  return memo(`chart-bld:${kind}:${style}:${season}:${snowy ? 1 : 0}`, () => {
    const st = P.stone;
    let p: Px;
    const roofSnow = (c: string) => (snowy ? P.snow[3] : c);
    switch (kind) {
      case "castle": {
        p = capitalSprite(style, roofSnow);
        break;
      }
      case "lighthouse": {
        p = beaconSprite(style, roofSnow);
        break;
      }
      case "watchtower": {
        p = new Px(5, 8);
        p.rect(1, 2, 3, 6, st[3]).vline(3, 2, 7, st[2]);
        p.hline(0, 4, 1, st[3]).set(0, 0, st[3]).set(2, 0, st[3]).set(4, 0, st[2]);
        p.set(2, 3, ink.deep).set(2, 6, ink.deep).set(2, 7, ink.deep);
        break;
      }
      case "monastery": {
        p = new Px(9, 8);
        const wall = style === "nordic" ? P.wood[2] : P.plaster[3];
        const shade = style === "nordic" ? P.wood[1] : P.plaster[1];
        p.rect(0, 4, 6, 4, wall).vline(5, 4, 7, shade);
        p.poly(
          [
            [-0.3, 4.2],
            [3, 2],
            [6.3, 4.2],
          ],
          roofSnow(P.brick[2]),
        );
        p.rect(6, 1, 3, 7, wall).vline(8, 1, 7, shade);
        p.poly(
          [
            [7.5, -0.5],
            [9.3, 1.2],
            [5.7, 1.2],
          ],
          roofSnow(P.brick[1]),
        );
        p.set(7, 3, P.gold[3]).set(2, 5, ink.deep).set(2, 6, ink.deep).set(7, 6, ink.deep).set(7, 7, ink.deep);
        break;
      }
      case "mine": {
        p = new Px(8, 6);
        p.poly(
          [
            [0, 6],
            [3.5, 0.5],
            [8, 6],
          ],
          st[2],
        );
        p.poly(
          [
            [0, 6],
            [3.5, 0.5],
            [3.5, 6],
          ],
          st[3],
        );
        p.rect(2, 3, 3, 3, ink.deep).hline(1, 5, 2, P.wood[2]).vline(1, 2, 5, P.wood[2]).vline(5, 2, 5, P.wood[1]);
        p.set(6, 5, P.iron[2]).set(7, 5, P.iron[1]).set(6, 4, P.wood[3]);
        break;
      }
      case "windmill": {
        p = new Px(7, 9);
        p.rect(2, 4, 3, 5, P.brick[3]).vline(4, 4, 8, P.brick[1]);
        p.hline(2, 4, 3, roofSnow(P.wood[2])).set(3, 2, roofSnow(P.wood[1]));
        p.set(3, 8, P.wood[0]);
        for (const [dx, dy] of [
          [1, -1],
          [-1, 1],
          [1, 1],
          [-1, -1],
        ]) {
          for (let k = 1; k <= 3; k++) p.set(3 + dx * k, 3 + dy * k, k === 3 ? P.plaster[2] : P.white);
        }
        p.set(3, 3, P.wood[0]);
        break;
      }
      case "church": {
        // 北地的木教堂：层层叠叠的陡峭木顶
        p = new Px(5, 9);
        p.rect(0, 6, 5, 3, P.wood[2]).vline(4, 6, 8, P.wood[1]);
        p.hline(0, 4, 5, roofSnow(P.wood[1])).hline(1, 3, 4, roofSnow(P.wood[1]));
        p.rect(1, 2, 3, 2, P.wood[2]).hline(1, 3, 1, roofSnow(P.wood[1]));
        p.vline(2, -1, 0, P.wood[1]).set(0, 5, P.wood[0]).set(4, 5, P.wood[0]);
        p.set(2, 7, ink.deep).set(2, 8, ink.deep);
        break;
      }
      case "pagoda": {
        p = new Px(7, 9);
        const tier = (y: number, w: number) => {
          p.hline(3 - w, 3 + w, y, roofSnow(P.jade[2])).set(3 - w, y - 1, roofSnow(P.jade[2])).set(3 + w, y - 1, roofSnow(P.jade[2]));
          p.rect(3 - w + 1, y + 1, 2 * w - 1, 2, P.red[2]).vline(3 + w - 1, y + 1, y + 2, P.red[1]);
        };
        tier(6, 3);
        tier(3, 2);
        tier(1, 1);
        p.set(3, 0, P.gold[3]);
        break;
      }
      case "caravanserai": {
        p = new Px(9, 6);
        p.rect(0, 1, 9, 5, P.sand[3]).rect(0, 1, 9, 1, P.sand[4]).vline(8, 1, 5, P.sand[2]);
        p.rect(2, 2, 5, 2, P.sand[2]);
        p.rect(3, 4, 2, 2, ink.deep).set(3, 3, ink.deep);
        p.set(0, 0, P.sand[4]).set(8, 0, P.sand[3]);
        p.vline(7, 0, 1, P.wood[1]).set(6, 0, P.jade[3]).set(8, 0, P.jade[2]);
        break;
      }
      default: {
        // 木栅栏堡：一圈尖木桩、墙角的木塔
        p = new Px(9, 7);
        for (let x = 0; x < 9; x++) p.vline(x, 2 + (x % 2), 6, x % 2 === 0 ? P.wood[2] : P.wood[3]).set(x, 1 + (x % 2), P.wood[1]);
        p.rect(6, 0, 3, 4, P.wood[2]).hline(6, 8, 0, roofSnow(P.wood[1])).vline(8, 1, 3, P.wood[1]);
        p.rect(3, 4, 2, 3, ink.deep);
        break;
      }
    }
    return p.outlined("#1a1423cc");
  });
}

/**
 * 首都的建筑按文化分别出图：
 * - 地中海、低地：石砌城堡（雉堞、两座塔楼、中央主楼，屋顶颜色随风格）；
 * - 北地：石基上的长屋大厅（深色木墙、陡峭的草皮顶、山墙上的兽首），旁边一座木塔；
 * - 沙漠：土坯城堡（平顶雉堞、四角塔），中央一座白圆顶，一侧细高的宣礼塔；
 * - 东方：城墙与城门楼，墙后是绿琉璃重檐的楼阁宫殿（翘角的飞檐、红柱）；
 * - 群岛：石台上的高脚议事长屋（高耸的茅草顶、交叉的山墙尖）；
 * - 殖民地：木栅栏堡。
 */
function capitalSprite(style: ArchStyle, roofSnow: (c: string) => string): Px {
  const st = P.stone;
  switch (style) {
    case "nordic": {
      const p = new Px(15, 11);
      // 石基
      p.rect(0, 9, 12, 2, st[2]).hline(0, 11, 9, st[3]);
      // 木墙：竖向的木板
      p.rect(1, 6, 10, 3, P.wood[1]);
      for (let x = 2; x <= 10; x += 2) p.vline(x, 6, 8, P.wood[2]);
      p.rect(5, 7, 2, 2, ink.deep);
      // 陡峭的草皮顶（右半边背光）
      p.poly(
        [
          [-0.4, 6.2],
          [5.5, 1.2],
          [11.6, 6.2],
        ],
        roofSnow(P.leaf[2]),
      );
      p.poly(
        [
          [5.5, 1.2],
          [11.6, 6.2],
          [5.5, 6.2],
        ],
        roofSnow(P.leaf[1]),
      );
      p.hline(0, 11, 6, P.wood[0]);
      // 山墙上的兽首
      p.set(0, 5, P.wood[2]).set(11, 5, P.wood[2]).set(5, 0, P.wood[1]).set(6, 0, P.wood[2]);
      // 旁边的木塔
      p.rect(12, 3, 3, 8, P.wood[2]).vline(14, 3, 10, P.wood[1]);
      p.poly(
        [
          [11.6, 3.2],
          [13.5, 0],
          [15.4, 3.2],
        ],
        roofSnow(P.slate[1]),
      );
      p.set(13, 5, ink.deep);
      return p;
    }
    case "desert": {
      const p = new Px(15, 14);
      // 土坯城墙与平顶雉堞
      p.rect(0, 8, 15, 6, P.sand[3]).hline(0, 14, 8, P.sand[4]);
      for (let x = 0; x < 15; x += 2) p.set(x, 7, P.sand[3]);
      // 四角的方塔
      p.rect(0, 5, 3, 9, P.sand[3]).vline(0, 5, 13, P.sand[4]).set(0, 4, P.sand[4]).set(2, 4, P.sand[3]);
      p.rect(12, 5, 3, 9, P.sand[2]).vline(14, 5, 13, P.sand[1]).set(12, 4, P.sand[3]).set(14, 4, P.sand[2]);
      // 中央的白圆顶
      const dome: [number, number][] = [
        [7, 2],
        [6, 3],
        [5, 4],
        [5, 5],
        [5, 6],
      ];
      for (const [x0, y] of dome) {
        const x1 = 14 - x0;
        p.hline(x0, x1, y, P.plaster[3]);
        p.hline(Math.max(x0, 8), x1, y, P.plaster[1]);
      }
      p.rect(5, 7, 5, 1, P.plaster[2]).set(7, 1, P.gold[3]).set(7, 0, P.gold[2]);
      // 宣礼塔：细高的塔身、阳台与尖顶
      p.vline(11, 0, 7, P.plaster[3]).vline(12, 1, 7, P.plaster[1]).hline(10, 13, 3, P.sand[2]).set(11, 0, P.gold[3]);
      // 拱门
      p.rect(6, 11, 3, 3, ink.deep).set(7, 10, ink.deep);
      p.set(3, 10, ink.deep).set(11, 10, ink.deep);
      return p;
    }
    case "eastern": {
      const p = new Px(17, 13);
      // 城墙与城门楼
      p.rect(0, 9, 17, 4, st[3]).hline(0, 16, 9, st[4]);
      for (let x = 0; x < 17; x += 2) p.set(x, 8, st[3]);
      p.rect(7, 10, 3, 3, ink.deep);
      // 宫殿：红柱、白墙
      p.rect(3, 5, 11, 3, P.red[2]);
      for (let x = 4; x <= 12; x += 2) p.vline(x, 5, 7, P.plaster[3]);
      // 下层的飞檐（绿琉璃，两端上翘）
      p.hline(1, 15, 4, roofSnow(P.jade[2])).hline(2, 14, 3, roofSnow(P.jade[3]));
      p.set(0, 3, roofSnow(P.jade[2])).set(16, 3, roofSnow(P.jade[2]));
      // 上层的重檐
      p.rect(5, 2, 7, 1, P.red[1]);
      p.hline(4, 12, 1, roofSnow(P.jade[3])).hline(5, 11, 0, roofSnow(P.jade[2]));
      p.set(3, 0, roofSnow(P.jade[2])).set(13, 0, roofSnow(P.jade[2])).set(8, 0, P.gold[3]);
      return p;
    }
    case "islands": {
      const p = new Px(15, 12);
      // 石台
      p.rect(0, 10, 15, 2, st[2]).hline(0, 14, 10, st[3]);
      // 高脚
      for (const x of [2, 5, 9, 12]) p.vline(x, 8, 9, P.wood[1]);
      // 长屋的墙
      p.rect(2, 6, 11, 2, P.wood[3]).hline(2, 12, 7, P.wood[2]).set(7, 7, ink.deep);
      // 高耸的茅草顶（右半边背光）
      p.poly(
        [
          [0.2, 6.3],
          [7.5, 0.6],
          [14.8, 6.3],
        ],
        roofSnow(P.straw[3]),
      );
      p.poly(
        [
          [7.5, 0.6],
          [14.8, 6.3],
          [7.5, 6.3],
        ],
        roofSnow(P.straw[2]),
      );
      for (let x = 2; x <= 12; x += 3) p.set(x, 5, P.straw[1]);
      // 交叉的山墙尖
      p.set(6, 0, P.wood[1]).set(8, 0, P.wood[1]).set(7, 1, P.wood[2]);
      return p;
    }
    case "frontier": {
      const p = new Px(9, 7);
      for (let x = 0; x < 9; x++) p.vline(x, 2 + (x % 2), 6, x % 2 === 0 ? P.wood[2] : P.wood[3]).set(x, 1 + (x % 2), P.wood[1]);
      p.rect(6, 0, 3, 4, P.wood[2]).hline(6, 8, 0, roofSnow(P.wood[1])).vline(8, 1, 3, P.wood[1]);
      p.rect(3, 4, 2, 3, ink.deep);
      return p;
    }
    default: {
      const p = new Px(13, 12);
      const roof = style === "lowland" ? P.slate[2] : P.red[2];
      p.rect(2, 6, 9, 6, st[3]).hline(2, 10, 6, st[4]);
      for (let x = 2; x <= 10; x += 2) p.set(x, 5, st[3]);
      p.rect(0, 4, 3, 8, st[3]).vline(0, 4, 11, st[4]);
      p.rect(10, 4, 3, 8, st[2]).vline(12, 4, 11, st[1]);
      p.poly(
        [
          [1.5, 0.5],
          [3.2, 4],
          [-0.2, 4],
        ],
        roofSnow(roof),
      );
      p.poly(
        [
          [11.5, 0.5],
          [13.2, 4],
          [9.8, 4],
        ],
        roofSnow(style === "lowland" ? P.slate[1] : P.red[1]),
      );
      p.rect(5, 2, 3, 4, st[3]).vline(7, 2, 5, st[2]).vline(6, 0, 1, P.wood[1]).set(7, 0, P.gold[3]);
      p.rect(5, 9, 3, 3, ink.deep).set(6, 8, ink.deep).set(1, 6, ink.deep).set(11, 6, ink.deep);
      return p;
    }
  }
}

/**
 * 港口的灯塔 / 烽火按文化与时代出图（不再是现代的红白条纹灯塔）：
 * - 地中海、低地：石砌的圆塔，塔顶一只火盆；
 * - 北地：木搭的烽火架；
 * - 东方：方形的石砌烽火台，台上燃火冒烟；
 * - 沙漠：细高的塔（像宣礼塔），顶上一盏灯；
 * - 群岛：礁石堆上的三脚火架；
 * - 殖民地：木塔上的一盏灯。
 */
function beaconSprite(style: ArchStyle, roofSnow: (c: string) => string): Px {
  const st = P.stone;
  const fire = (p: Px, x: number, y: number) => p.set(x, y, P.lamp[2]).set(x - 1, y + 1, P.lamp[1]).set(x + 1, y + 1, P.red[2]).set(x, y + 1, P.lamp[1]);
  switch (style) {
    case "nordic": {
      const p = new Px(5, 10);
      p.vline(0, 3, 9, P.wood[1]).vline(4, 3, 9, P.wood[1]).vline(2, 3, 9, P.wood[2]);
      for (let y = 4; y <= 9; y += 2) p.hline(0, 4, y, P.wood[2]);
      p.hline(0, 4, 2, P.wood[3]);
      fire(p, 2, 0);
      return p;
    }
    case "eastern": {
      const p = new Px(7, 9);
      p.rect(1, 4, 5, 5, st[3]).vline(5, 4, 8, st[2]).hline(0, 6, 8, st[2]).hline(0, 6, 3, st[4]);
      p.set(3, 6, ink.deep).set(3, 7, ink.deep);
      fire(p, 3, 1);
      p.set(3, 0, roofSnow(P.stone[3]));
      return p;
    }
    case "desert": {
      const p = new Px(5, 12);
      p.hline(0, 4, 11, P.sand[2]).rect(1, 4, 3, 7, P.plaster[3]).vline(3, 4, 10, P.plaster[1]);
      p.hline(0, 4, 4, P.sand[3]).rect(1, 2, 3, 2, P.lamp[1]).set(2, 2, P.lamp[2]);
      p.set(2, 1, P.plaster[2]).set(2, 0, P.gold[3]);
      return p;
    }
    case "islands": {
      const p = new Px(7, 8);
      p.hline(0, 6, 7, st[2]).hline(1, 5, 6, st[3]).set(2, 5, st[3]).set(4, 5, st[2]);
      p.set(1, 4, P.wood[1]).set(2, 3, P.wood[1]).set(5, 4, P.wood[1]).set(4, 3, P.wood[1]);
      fire(p, 3, 1);
      return p;
    }
    case "frontier": {
      const p = new Px(5, 10);
      p.vline(1, 3, 9, P.wood[2]).vline(3, 3, 9, P.wood[1]).hline(1, 3, 6, P.wood[2]);
      p.rect(0, 1, 5, 2, P.wood[2]).hline(0, 4, 0, roofSnow(P.wood[1])).set(2, 1, P.lamp[1]);
      return p;
    }
    default: {
      const p = new Px(5, 11);
      p.hline(0, 4, 10, st[2]).hline(0, 4, 9, st[3]);
      p.rect(1, 3, 3, 6, st[3]).vline(3, 3, 8, st[2]).hline(1, 3, 5, st[2]).set(2, 7, ink.deep);
      p.hline(0, 4, 2, st[4]);
      fire(p, 2, 0);
      return p;
    }
  }
}

// ───────────────────────────── 道路 ─────────────────────────────

/** 各植被的通行代价（叠加在基础代价 1 上）。 */
function vegCost(v: number): number {
  switch (v) {
    case VEG.FOREST:
    case VEG.BOREAL:
      return 0.5;
    case VEG.JUNGLE:
      return 1.2;
    case VEG.WETLAND:
      return 2;
    case VEG.ALPINE:
      return 5;
    case VEG.ICE:
      return 3;
    case VEG.VOLCANIC:
      return 2;
    case VEG.ARCANE:
      return 1;
    case VEG.DESERT:
      return 0.4;
    default:
      return 0;
  }
}

/**
 * 道路寻路（A*，8 邻接，限制在两端包围盒外扩 14 格内）：代价随高程与坡度升高，密林、沼泽与高山更贵，过河加价。
 * 只走陆格（两端的格除外——港口在海上的停泊格）。返回格下标序列；走不通时为 null。
 */
export function routeRoad(geo: Geo, riverCell: Uint8Array, a: readonly [number, number], b: readonly [number, number]): number[] | null {
  const { W, H, terr, relief, veg } = geo;
  const clampX = (v: number) => Math.max(0, Math.min(W - 1, Math.round(v)));
  const clampY = (v: number) => Math.max(0, Math.min(H - 1, Math.round(v)));
  const ax = clampX(a[0]);
  const ay = clampY(a[1]);
  const bx = clampX(b[0]);
  const by = clampY(b[1]);
  const M = 14;
  const x0 = Math.max(0, Math.min(ax, bx) - M);
  const y0 = Math.max(0, Math.min(ay, by) - M);
  const x1 = Math.min(W - 1, Math.max(ax, bx) + M);
  const y1 = Math.min(H - 1, Math.max(ay, by) + M);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const local = (x: number, y: number) => (y - y0) * bw + (x - x0);
  const start = local(ax, ay);
  const goal = local(bx, by);
  const heapF: number[] = [];
  const heapI: number[] = [];
  const less = (i: number, j: number) => heapF[i] < heapF[j] || (heapF[i] === heapF[j] && heapI[i] < heapI[j]);
  const swap = (i: number, j: number) => {
    [heapF[i], heapF[j]] = [heapF[j], heapF[i]];
    [heapI[i], heapI[j]] = [heapI[j], heapI[i]];
  };
  const push = (f: number, i: number) => {
    heapF.push(f);
    heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!less(k, p)) break;
      swap(k, p);
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0];
    const lf = heapF.pop() as number;
    const li = heapI.pop() as number;
    if (heapF.length > 0) {
      heapF[0] = lf;
      heapI[0] = li;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && less(l, m)) m = l;
        if (r < heapF.length && less(r, m)) m = r;
        if (m === k) break;
        swap(k, m);
        k = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(Math.hypot(bx - ax, by - ay), start);
  const DIRS: readonly (readonly [number, number, number])[] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (heapF.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = x0 + (cur % bw);
    const cy = y0 + Math.floor(cur / bw);
    const ci = cy * W + cx;
    for (const [dx, dy, len] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const li = local(nx, ny);
      if (closed[li]) continue;
      const gi = ny * W + nx;
      const isEnd = li === goal || li === start;
      if (terr[gi] !== 2 && !isEnd) continue;
      // 斜着走时不从两个海格之间挤过去
      if (dx !== 0 && dy !== 0 && terr[cy * W + nx] !== 2 && terr[ny * W + cx] !== 2 && !isEnd) continue;
      const land = terr[gi] === 2;
      const cost = land ? 1 + relief[gi] * 0.25 + Math.abs(relief[gi] - (terr[ci] === 2 ? relief[ci] : 0)) * 1.2 + vegCost(veg[gi]) + (riverCell[gi] ? 1.5 : 0) : 1;
      const ng = g[cur] + len * cost;
      if (ng < g[li]) {
        g[li] = ng;
        came[li] = cur;
        push(ng + Math.hypot(bx - nx, by - ny), li);
      }
    }
  }
  if (!closed[goal]) return null;
  const path: number[] = [];
  for (let k = goal; k >= 0; k = came[k]) path.push((y0 + Math.floor(k / bw)) * W + x0 + (k % bw));
  path.reverse();
  return path;
}

/** Chaikin 平滑（保留两端）。 */
export function chaikin(pts: readonly [number, number][], iterations = 2): [number, number][] {
  let cur = pts.slice();
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: [number, number][] = [cur[0]];
    for (let i = 0; i + 1 < cur.length; i++) {
      const [ax, ay] = cur[i];
      const [bx, by] = cur[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}
