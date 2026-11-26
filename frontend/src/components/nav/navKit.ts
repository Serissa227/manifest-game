// 手动航行（FRAMEWORK §6）的纯计算：角度与 32 个罗经点、逆风禁区、应用层时钟换算成“从 6:00 起的分钟”、
// 帆的三档、键盘映射、按分钟插值的船位（预测就是结果）与经纬度文字。不碰 DOM，有单元测试。
import { tk, t } from "../../i18n";
import type { Overview, SailSetting, StaticView } from "../../ipc/types";
import type { NavPort } from "../../map/navDraw";
import { DAY_START_MINUTE, MINUTES_PER_DAY, normMinute } from "../../time/daylight";
import { wrapDx } from "../../map/wrap";

/** 罗经点的个数与每个点的角度。 */
export const POINTS = 32;
export const POINT_DEG = 360 / POINTS;

/** 角度归到 [0, 360)。 */
export function normDeg(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const r = a % 360;
  return r < 0 ? r + 360 : r + 0;
}

/** 从 from 转到 to 的最短角（顺时针为正），结果在 (−180, 180]。 */
export function angleDiff(from: number, to: number): number {
  const d = normDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** 航向最近的罗经点（0 正北，顺时针 0–31）。 */
export function pointIndex(heading: number): number {
  return Math.round(normDeg(heading) / POINT_DEG) % POINTS;
}

/** 罗经点的名字（“西北偏西”）。 */
export function compassPoint(heading: number): string {
  return tk(`nav.point.${pointIndex(heading)}`);
}

/** 航向与风来向的夹角（0–180°）：0 是迎着风开，180 是正顺风。 */
export function offWind(heading: number, windFrom: number): number {
  return Math.abs(angleDiff(windFrom, heading));
}

/** 是否在逆风禁区里（夹角小于这艘船能逆风到的最小夹角）。 */
export function inIrons(heading: number, windFrom: number, sailLimit: number): boolean {
  return sailLimit > 0 && offWind(heading, windFrom) < sailLimit;
}

/** 逆风禁区的两条边（度）：[风来向 − 夹角, 风来向 + 夹角]。 */
export function noGoZone(windFrom: number, sailLimit: number): [number, number] {
  return [normDeg(windFrom - sailLimit), normDeg(windFrom + sailLimit)];
}

/**
 * 由屏幕上的向量（dx 向东为正、dy 向南为正）得到航向（0 正北、顺时针，取整到 1°）。零向量返回 null。
 */
export function headingToward(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  return Math.round(normDeg((Math.atan2(dx, -dy) * 180) / Math.PI)) % 360;
}

/** 航向的单位向量（屏幕坐标：x 向东、y 向南）。 */
export function headingVector(heading: number): { x: number; y: number } {
  const a = (normDeg(heading) * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** 应用层的时钟（当天 0–1439 分）→ 从 6:00 起的分钟（命令与预测都用它）。 */
export function navMinute(clockMinute: number): number {
  return (normMinute(clockMinute) - DAY_START_MINUTE + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** 从 6:00 起的分钟 → 时刻文字用的当天分钟。 */
export function clockMinuteOf(navMin: number): number {
  return normMinute(navMin + DAY_START_MINUTE);
}

/** 帆的三档（由低到高）。 */
export const SAILS: readonly SailSetting[] = ["furled", "half", "full"];

/** 升一档帆（满帆不变）。 */
export function sailUp(s: SailSetting): SailSetting {
  return SAILS[Math.min(SAILS.length - 1, SAILS.indexOf(s) + 1)] ?? "half";
}

/** 降一档帆（收帆不变）。 */
export function sailDown(s: SailSetting): SailSetting {
  return SAILS[Math.max(0, SAILS.indexOf(s) - 1)] ?? "half";
}

/** 航行视图的键盘动作。 */
export type NavKey = "left" | "right" | "sailUp" | "sailDown" | "pause" | "toggleView";

/** 键 → 动作：A/D 或 ←/→ 转舵，W/S 升降帆，空格暂停，Tab 切换世界图。其余为 null。 */
export function navKeyOf(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): NavKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case "a":
    case "ArrowLeft":
      return "left";
    case "d":
    case "ArrowRight":
      return "right";
    case "w":
    case "ArrowUp":
      return "sailUp";
    case "s":
    case "ArrowDown":
      return "sailDown";
    case " ":
    case "Spacebar":
      return "pause";
    case "Tab":
      return "toggleView";
    default:
      return e.code === "Space" ? "pause" : null;
  }
}

/** 按住转舵的速度（度 / 秒）。 */
export const TURN_RATE = 60;

/** 按住 ms 毫秒转过的角度（朝 dir 方向）。 */
export function turnBy(heading: number, dir: -1 | 1, ms: number, rate = TURN_RATE): number {
  return normDeg(heading + (dir * rate * Math.max(0, ms)) / 1000);
}

/**
 * 按分钟插值船位：points 为 [x, y, 分钟]（从 6:00 起，按分钟递增）。早于第一个点取第一个点，晚于最后一个点取最后一个点；
 * 环绕地图的横向按最短的一条插值，结果横向取模。没有点时为 null。
 */
export function positionAt(points: readonly (readonly [number, number, number])[], minute: number, width: number, wrap: boolean): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const fix = (x: number) => (wrap && width > 0 ? ((x % width) + width) % width : x);
  if (minute <= points[0][2]) return { x: fix(points[0][0]), y: points[0][1] };
  if (Number.isNaN(minute)) {
    const last = points[points.length - 1];
    return { x: fix(last[0]), y: last[1] };
  }
  // 分钟点已排序；逐帧与暂停标记共用二分查找，不再每帧从日初扫描整份航迹。
  let lo = 1;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid][2] < minute) lo = mid + 1;
    else hi = mid;
  }
  if (lo < points.length) {
    const [bx, by, bm] = points[lo];
    const [ax, ay, am] = points[lo - 1];
    const t = bm === am ? 1 : (minute - am) / (bm - am);
    return { x: fix(ax + wrapDx(ax, bx, width, wrap) * t), y: ay + (by - ay) * t };
  }
  const last = points[points.length - 1];
  return { x: fix(last[0]), y: last[1] };
}

/** 度 → “38°42′”。 */
function dms(v: number): string {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.round((a - d) * 60);
  if (m === 60) {
    d += 1;
    m = 0;
  }
  return `${d}°${m < 10 ? "0" : ""}${m}′`;
}

/** 经纬度文字（“北纬 38°42′ 西经 9°08′” / “38°42′N 9°08′W”）。 */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? t("nav.latN", { v: dms(lat) }) : t("nav.latS", { v: dms(lat) });
  const ew = lon >= 0 ? t("nav.lonE", { v: dms(lon) }) : t("nav.lonW", { v: dms(lon) });
  return t("nav.latLon", { lat: ns, lon: ew });
}

/** SVG 扇形的路径（圆心 (cx, cy)、半径 r，从 a0 顺时针到 a1，角度 0 为正上方）。 */
export function sectorPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const v = headingVector(a);
    return `${(cx + v.x * r).toFixed(2)} ${(cy + v.y * r).toFixed(2)}`;
  };
  const sweep = normDeg(a1 - a0);
  const large = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
}

/** 海港往外的方向：在 radius 格之内，32 个方向各走多远还是海，取最长的（并列取更接近 prefer 的）。出港时罗经盘的初始航向。 */
export function seawardHeading(
  isSea: (x: number, y: number) => boolean,
  x: number,
  y: number,
  radius = 12,
  prefer = 0,
): number {
  let best = prefer;
  let bestLen = -1;
  for (let i = 0; i < POINTS; i++) {
    const h = i * POINT_DEG;
    const v = headingVector(h);
    let len = 0;
    for (let s = 1; s <= radius; s++) {
      if (!isSea(Math.round(x + v.x * s), Math.round(y + v.y * s))) break;
      len = s;
    }
    if (len > bestLen || (len === bestLen && Math.abs(angleDiff(prefer, h)) < Math.abs(angleDiff(prefer, best)))) {
      best = h;
      bestLen = len;
    }
  }
  return Math.round(best);
}

/** 从 (x, y) 朝 heading 走，radius 格之内连续是海的格数（第一格就是陆地时为 0）。 */
export function seaRun(isSea: (x: number, y: number) => boolean, x: number, y: number, heading: number, radius = 12): number {
  const v = headingVector(heading);
  let len = 0;
  for (let s = 1; s <= radius; s++) {
    if (!isSea(Math.round(x + v.x * s), Math.round(y + v.y * s))) break;
    len = s;
  }
  return len;
}

/** 出港默认航向离开逆风禁区时，禁区边缘再往外偏的度数。 */
export const IRONS_MARGIN = 10;
/** 默认航向前方至少这么多格是海，才算“不指向近处的陆地”。 */
export const IRONS_CLEAR_RUN = 4;

/**
 * H10hF 出港的默认航向避开逆风禁区：落在禁区里时，改到禁区两条边再往外偏 IRONS_MARGIN 度的两个方向之一——
 * 先挑前方 IRONS_CLEAR_RUN 格以内没有陆地的（run 不给时只按风），再挑离原来的默认航向近的。不在禁区里原样返回。
 */
export function avoidIrons(heading: number, windFrom: number, sailLimit: number, run?: (heading: number) => number): number {
  if (!inIrons(heading, windFrom, sailLimit)) return heading;
  const edge = Math.min(180, sailLimit + IRONS_MARGIN);
  const options = [Math.round(normDeg(windFrom - edge)) % 360, Math.round(normDeg(windFrom + edge)) % 360];
  const blocked = (h: number) => (run && run(h) < IRONS_CLEAR_RUN ? 1 : 0);
  const away = (h: number) => Math.abs(angleDiff(heading, h));
  options.sort((a, b) => blocked(a) - blocked(b) || away(a) - away(b));
  return options[0];
}

/**
 * 在港时估这支舰队的逆风禁区（度）：内核取舰队里各船的最大值，横帆 67°、纵帆 50°（`legend_ships/mechanics.rs ship_limit`）。
 * 前端不知道传说之船的特性、帆缆磨损与本领修正，按船型的帆估，没有船时按 67°。
 */
export function portSailLimit(ships: readonly { kind: number }[], types: readonly { sail: "square" | "lateen" }[] | undefined): number {
  if (ships.length === 0) return 67;
  return ships.reduce((m, s) => Math.max(m, types?.[s.kind]?.sail === "lateen" ? 50 : 67), 0);
}

/** 概览里当地天气的风（去向 0–7，0 为北、顺时针）→ 风从哪里来（度），与内核 `course.rs` 的换算一致。 */
export function windFromOctant(windDir: number): number {
  return normDeg(Math.round(windDir) * 45 + 180);
}

/** 看见过的港口与殖民点（Overview.sighted 给出时只列看见过的）。 */
export function sightedPorts(statics: StaticView, o: Overview | null): NavPort[] {
  const seen = Array.isArray(o?.sighted) ? new Set(o.sighted) : null;
  return statics.locations
    .filter((l) => (l.kind === "port" || l.kind === "site") && (seen === null || seen.has(l.id)))
    .map((l) => ({ x: l.x, y: l.y, name: l.name }));
}
