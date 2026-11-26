// 建筑预览（在 frontend 下运行 npx vite-node scripts/art-preview.ts buildings）：
// - <风格>-overview：9 设施 + 6 民居 + 地标 + 全部物件（夏季白天）
// - <风格>-winter：同一套在冬季积雪下的样子
// - <风格>-night：同一套在夜晚亮灯时的样子
// - <风格>-town：远景（重复两遍检查无缝）、城墙（重复两遍）与城门
// - compare-<设施>：各风格同一设施并排；compare-all：九种设施 × 各风格的总表（每行一种设施）
// - colony-<风格>：14 种殖民建筑 × 1–3 级（每行一种建筑）；colony-<风格>-winter / -night：积雪与亮灯
// - colony-l3-all：各风格的 3 级殖民建筑（所有者风格的墙与屋顶）
// 风格包括七种经典风格与第九批的六种文化城镇风格（TOWN_STYLES）。
import { FACILITIES } from "../store/game";
import {
  COLONY_KEYS,
  TOWN_STYLES,
  type BuildingOpts,
  drawBuilding,
  drawColonyBuilding,
  drawCityWall,
  drawGate,
  drawHouse,
  drawLandmark,
  drawProp,
  drawSkyline,
  type PropKind,
  type TownStyle,
} from "./buildings";
import { P } from "./palette";
import { Px, sheet, type Preview } from "./px";

const PROPS: readonly PropKind[] = ["crates", "barrels", "cart", "lamp", "flagpole", "well", "stall", "bench", "sacks", "anchor"];

/** 纯色底板上拼图，每行底部画一条地面线，让建筑“站”在街上。 */
function board(items: readonly Px[], cols: number, bg: string, ground: string): Px {
  const s = sheet(items, { cols, gap: 6, pad: 6 });
  const out = new Px(s.w, s.h).fill(bg);
  // 每行的地面：在每个物件底边下画 2 像素的地面色
  const rows = Math.ceil(items.length / cols);
  let y = 6;
  for (let r = 0; r < rows; r++) {
    const h = Math.max(...items.slice(r * cols, r * cols + cols).map((p) => p.h));
    y += h;
    out.rect(0, y, out.w, 2, ground);
    y += 6;
  }
  return out.blit(s, 0, 0);
}

/** 横向重复两遍（检查无缝）。 */
function twice(p: Px, bg: string): Px {
  return new Px(p.w * 2, p.h).fill(bg).blit(p, 0, 0).blit(p, p.w, 0);
}

function set(style: TownStyle, o: BuildingOpts): Px[] {
  return [
    ...FACILITIES.map((f) => drawBuilding(f, style, o)),
    ...[0, 1, 2, 3, 4, 5].map((v) => drawHouse(style, v, o)),
    drawLandmark(style, o),
    drawGate(style, o),
    ...PROPS.map((k, i) => drawProp(k, style, { variant: i })),
  ];
}

export default function preview(): Preview[] {
  const out: Preview[] = [];
  for (const style of TOWN_STYLES) {
    out.push({ name: `${style}-overview`, px: board(set(style, { season: 1 }), 6, P.sky[3], P.stone[2]), scale: 2 });
    out.push({ name: `${style}-winter`, px: board(set(style, { season: 3, snow: true }), 6, P.snow[1], P.snow[2]), scale: 2 });
    out.push({ name: `${style}-night`, px: board(set(style, { season: 1, lit: true }), 6, P.night[1], P.night[2]), scale: 2 });
    const town = [
      twice(drawSkyline(style, 160, { season: 1 }), P.sky[3]),
      twice(drawSkyline(style, 160, { season: 3, snow: true, lit: true }), P.night[2]),
      twice(drawCityWall(style, 150, { season: 1 }), P.sky[3]),
      twice(drawCityWall(style, 150, { season: 3, snow: true }), P.snow[1]),
      drawGate(style, { season: 1 }),
    ];
    out.push({ name: `${style}-town`, px: sheet(town, { cols: 1, gap: 4, pad: 4, bg: P.sky[4] }), scale: 2 });
  }
  for (const fac of FACILITIES) {
    out.push({ name: `compare-${fac}`, px: board(TOWN_STYLES.map((s) => drawBuilding(fac, s, { season: 1 })), TOWN_STYLES.length, P.sky[3], P.stone[2]), scale: 3 });
  }
  const all = FACILITIES.flatMap((f) => TOWN_STYLES.map((s) => drawBuilding(f, s, { season: 1 })));
  out.push({ name: "compare-all", px: board(all, TOWN_STYLES.length, P.sky[3], P.stone[2]), scale: 1 });
  // 殖民建筑：每行一种建筑，三列是 1–3 级
  const colony = (style: TownStyle, o: BuildingOpts) => COLONY_KEYS.flatMap((k) => [1, 2, 3].map((lv) => drawColonyBuilding(k, lv, style, { ...o, flag: "#c0392b" })));
  for (const style of ["frontier", "mediterranean"] as const) {
    out.push({ name: `colony-${style}`, px: board(colony(style, { season: 1 }), 3, P.sky[3], P.leaf[1]), scale: 2 });
    out.push({ name: `colony-${style}-winter`, px: board(colony(style, { season: 3, snow: true }), 3, P.snow[1], P.snow[2]), scale: 2 });
    out.push({ name: `colony-${style}-night`, px: board(colony(style, { season: 1, lit: true }), 3, P.night[1], P.night[2]), scale: 2 });
  }
  for (const season of [0, 2]) {
    out.push({ name: `colony-frontier-${season === 0 ? "spring" : "autumn"}`, px: board(colony("frontier", { season }), 3, P.sky[3], P.leaf[1]), scale: 2 });
  }
  const l3 = COLONY_KEYS.flatMap((k) => TOWN_STYLES.map((s) => drawColonyBuilding(k, 3, s, { season: 1 })));
  out.push({ name: "colony-l3-all", px: board(l3, TOWN_STYLES.length, P.sky[3], P.leaf[1]), scale: 1 });
  return out;
}
