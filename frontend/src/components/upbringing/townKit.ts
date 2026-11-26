// 养成主画面的“城中各处”（场景视图，UbTown.tsx）的纯逻辑：挑背景图、地点的图标与位置、点一个地点时日程草稿怎么改。
//
// 背景是这一阶段所在城市的 CG（家乡期是家乡港，学院期是学院所在的城市），按游戏日期的月份挑季节版。挑图的次序：
//   1. 画了这座城市的养成场景插画（CITY_SCENES；public/scenes/ 的 1536×672 场景画，有季节版的按当月挑，热带的按雨季 / 旱季，
//      没有这一季的版本用最早的一版——与活动小场景同一套规则，ubKit 的 seasonal）；
//   2. 这座城市的港口 CG（port_<城市>，寰宇的港口插画，只有时段与天况的版本，没有季节版）：挑白天的一版，冬天偏向雪景、别的季节偏向晴天；
//      画着雪的版本只在冬天（12–2 月）用，不是冬天而这座城只有雪景时当作没有图；
//   3. 同文化的图（CULTURE_ART：地图上的文化与学院的文化两套叫法都收；值是场景插画或港口 CG，同样按季节挑）；
//   4. 都没有：null，画面用按季节着色的渐变底（CSS 的 .ub-town-view--plain）。
// 地点按数据里的 x、y（0–100）摆在画面上；点一个地点等同于在原来的“去哪里”下拉框里选它（见 goPlace），合法性仍以后端为准。
import type { IconName } from "../../art/icons";
import { loreVariants } from "../../art/lore";
import type { ActivityView, PlaceView, UpbringingView } from "../../ipc/types";
import { SCENE_FILES } from "./sceneAssets";
import { assign, openCells, refine, seasonal, seasonOfMonth, type Cell, type Draft } from "./ubKit";

/**
 * 城市（地点 key）→ 画了这座城市的养成场景插画（sceneAssets.ts 的场景 key）。只收画面里就是这座城的图（art-src/scenes.json 的描述）；
 * 学院所在的城市用学院一带的街景或庭院，免得和家乡期同一张。没有收进来的城市先找它的港口 CG，再按文化回退。
 */
export const CITY_SCENES: Readonly<Record<string, string>> = {
  shimoda_tosa: "dock_jp", // 土佐南部的港町（四季）
  kyoto: "kemari_jp", // 京都公家的庭院（四季）
  noshima: "sea_jp", // 能岛一带的濑户内海（四季）
  yuegang: "harbor_cn", // 漳州月港（四季）
  zhangzhou_city: "market_cn", // 明朝沿海城里的街市（四季）
  seville: "harbor_eu", // 瓜达尔基维尔河上的塞维利亚港（四季）
  algiers: "harbor_algiers", // 从港里看阿尔及尔的白城（四季）
  antwerp: "bourse_antwerp", // 安特卫普交易所（四季）
  fez: "madrasa_fez", // 菲斯的卡鲁因清真寺学院（四季）
  zabid_city: "madrasa_zabid", // 扎比德的学堂院落（旱季 / 雨季）
  cairo: "azhar_cairo", // 开罗爱资哈尔的院落（只有一版）
  kilwa: "quay_kilwa", // 基尔瓦的珊瑚石城（旱季 / 雨季）
  gresik: "pesantren_giri", // 格雷西克附近的吉里经学院（旱季 / 雨季）
  cozumel: "shrine_maya", // 科苏梅尔海边的伊希切尔圣所（旱季 / 雨季）
  merida_city: "ballgame_maya", // 玛雅小城的球场（旱季 / 雨季）
  ternate_port: "korakora", // 摩鹿加的火山岛与快船（旱季 / 雨季）
};

/**
 * 文化 → 同文化的图（场景插画 key，或港口 CG 的 port_<城市>）：城市自己没有图时用。
 * 地图上的文化（cities / ports 的 culture）与学院的文化（academies 的 culture）是两套叫法，这里都收。
 */
export const CULTURE_ART: Readonly<Record<string, string>> = {
  japanese: "dock_jp",
  ming: "harbor_cn",
  chinese: "harbor_cn",
  korean: "port_busan",
  ryukyuan: "port_naha",
  malay: "port_malacca",
  southeast_asian: "port_malacca",
  indian: "port_calicut_port",
  swahili: "quay_kilwa",
  east_african: "quay_kilwa",
  desert: "souq",
  arabian: "souq",
  ottoman: "harbor_algiers",
  north_african: "harbor_algiers",
  mediterranean: "harbor_eu",
  iberian: "harbor_eu",
  italian: "harbor_eu",
  lowland: "bourse_antwerp",
  low_countries: "bourse_antwerp",
  nordic: "port_hamburg",
  northern: "port_hamburg",
  maya: "ballgame_maya",
  mesoamerican: "ballgame_maya",
  andean: "port_callao",
};

/** 挑中的背景：图片路径（相对 public/）、文件名主干与来历（城市自己的图 / 同文化的图）。 */
export interface TownArt {
  src: string;
  file: string;
  from: "city" | "culture";
}

const has = (o: Readonly<Record<string, string>>, k: string | null | undefined): k is string =>
  !!k && Object.prototype.hasOwnProperty.call(o, k);

const SCENES = new Set(SCENE_FILES);

/** 港口 CG 挑一版：白天优先（晨昏次之、夜里最后）；冬天偏向雪景、其余季节偏向晴天；不是冬天时不用雪景。没有合适的版本为 null。 */
export function portVariant(key: string, month: number): string | null {
  const winter = seasonOfMonth(month) === "winter";
  const vs = loreVariants(key).filter((v) => winter || v[2] !== "snow");
  if (vs.length === 0) return null;
  const phase = (p: string) => (p === "day" ? 3 : p === "night" ? 0 : 2);
  const sky = (s: string) => (winter ? (s === "snow" ? 2 : s === "cloudy" || s === "fog" ? 1 : 0) : s === "clear" ? 2 : s === "cloudy" ? 1 : 0);
  let best = vs[0];
  for (const v of vs) if (phase(v[1]) * 10 + sky(v[2]) > phase(best[1]) * 10 + sky(best[2])) best = v;
  return best[0];
}

/** 一个图 key（场景插画或 port_<城市>）按当月挑出的文件名主干；清单里没有、或港口 CG 这一季没有合适的版本时为 null。 */
function artFile(key: string, month: number): string | null {
  if (SCENES.has(key)) return seasonal(key, month);
  if (key.startsWith("port_")) return portVariant(key, month);
  return null;
}

/**
 * 这一阶段所在城市的背景图（按游戏日期的月份挑季节版）：城市的养成场景插画 → 城市的港口 CG → 同文化的图 → null（渐变底）。
 * cultures 按先后试（先地图上的文化，再学院的文化）。
 */
export function townArt(town: string | null | undefined, cultures: readonly (string | null | undefined)[], month: number): TownArt | null {
  const pick = (key: string, from: TownArt["from"]): TownArt | null => {
    const file = artFile(key, month);
    return file ? { src: `scenes/${file}.webp`, file, from } : null;
  };
  if (town) {
    const own = (has(CITY_SCENES, town) ? pick(CITY_SCENES[town], "city") : null) ?? pick(`port_${town}`, "city");
    if (own) return own;
  }
  for (const c of cultures) {
    if (!has(CULTURE_ART, c)) continue;
    const art = pick(CULTURE_ART[c], "culture");
    if (art) return art;
  }
  return null;
}

/** 养成视图里的城市与文化 → 背景图（旧后端没有 town 时只按文化回退）。 */
export function townArtOf(view: Pick<UpbringingView, "town" | "culture" | "today">): TownArt | null {
  return townArt(view.town?.key, [view.town?.culture, view.culture], view.today[1]);
}

// ───────────── 地点：图标与位置 ─────────────

/** 地点的种类 → 像素图标（与界面其余地方同一套 16×16 图标）。 */
export const PLACE_ICONS: Readonly<Record<string, IconName>> = {
  home: "cb_housing", // 家中：两间小屋
  dorm: "cb_housing", // 宿舍（学院里住的地方）
  classroom: "save", // 学堂：纸与羽毛笔
  library: "load", // 书房、书库：摊开的书
  market: "market", // 市集：天平
  dock: "anchor", // 码头、渡口：锚
  workshop: "build", // 作坊：锯与锤
  roof: "star", // 屋顶、月见台：看星星的地方
  shrine: "exchange", // 祭所、佛堂、礼拜处：一口铜铃（不分宗教）
  trading_house: "guild", // 商馆：商会的旗
  garden: "spring", // 庭院：花
};

/** 地点种类的图标；没登记的种类用望远镜（“去看看”）。 */
export function placeIcon(kind: string): IconName {
  return has(PLACE_ICONS, kind) ? PLACE_ICONS[kind] : "discovery";
}

/** 数据里的 0–100 坐标 → 画面上图标中心的位置（百分比）：往里收一圈，图标与地名不贴边、不出画。 */
export function spotPos(x: number, y: number): { left: number; top: number } {
  const c = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 50);
  return { left: Math.round((6 + c(x) * 0.88) * 10) / 10, top: Math.round((9 + c(y) * 0.74) * 10) / 10 };
}

/** 地名小签放在图标的哪一边。 */
export type LabelSide = "below" | "above" | "right" | "left";

/** 摆放地名时按的画面大小（px）：地图摆法里最小的一种（日程纸 520 px 宽、画面至少 240 px 高，见 upbringing.css）。画面更大时只会更松。 */
const MAP_W = 520;
const MAP_H = 240;
/** 图标的半边长、小签的高、小签与图标的间距（px，与 upbringing.css 一致）；小签最多 7.5 个字宽（12 px 字）加左右内边距。 */
const ICON_HALF = 18;
const LABEL_H = 19;
const LABEL_GAP = 3;
const labelWidth = (name: string) => Math.min([...name].length, 7.5) * 12 + 14;

type Box = readonly [x0: number, y0: number, x1: number, y1: number];
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * 每个地点的地名小签放哪一边：缺省在图标下面；下面会压到别的地点的图标或已经摆好的小签时，依次试上面、右边、左边（靠右的地点先试左边），
 * 都不行就仍放下面（图标总是盖在小签上面，见 upbringing.css，图标照样点得着）。按画面最小时的大小（MAP_W × MAP_H）算，越大越松。
 */
export function labelSides(
  places: readonly Pick<PlaceView, "key" | "name" | "x" | "y">[],
  /** 地点 → 画面上的位置（百分比）；缺省按数据的 x、y（spotPos）。行动制的城镇地图按图上量好的坐标传进来 */
  posOf: (p: Pick<PlaceView, "key" | "x" | "y">) => { left: number; top: number } = (p) => spotPos(p.x, p.y),
): Record<string, LabelSide> {
  const pts = places.map((p) => {
    const pos = posOf(p);
    return { key: p.key, w: labelWidth(p.name), cx: (pos.left / 100) * MAP_W, cy: (pos.top / 100) * MAP_H };
  });
  const icons: Box[] = pts.map((p) => [p.cx - ICON_HALF, p.cy - ICON_HALF, p.cx + ICON_HALF, p.cy + ICON_HALF]);
  const placed: Box[] = [];
  const out: Record<string, LabelSide> = {};
  pts.forEach((p, i) => {
    const box = (side: LabelSide): Box => {
      const below = p.cy + ICON_HALF + LABEL_GAP;
      const above = p.cy - ICON_HALF - LABEL_GAP;
      switch (side) {
        case "below":
          return [p.cx - p.w / 2, below, p.cx + p.w / 2, below + LABEL_H];
        case "above":
          return [p.cx - p.w / 2, above - LABEL_H, p.cx + p.w / 2, above];
        case "right":
          return [p.cx + ICON_HALF + 4, p.cy - LABEL_H / 2, p.cx + ICON_HALF + 4 + p.w, p.cy + LABEL_H / 2];
        case "left":
          return [p.cx - ICON_HALF - 4 - p.w, p.cy - LABEL_H / 2, p.cx - ICON_HALF - 4, p.cy + LABEL_H / 2];
      }
    };
    const order: LabelSide[] = p.cx > MAP_W * 0.55 ? ["below", "above", "left", "right"] : ["below", "above", "right", "left"];
    const fits = (b: Box) =>
      b[0] >= 0 && b[1] >= 0 && b[2] <= MAP_W && b[3] <= MAP_H && !icons.some((ic, j) => j !== i && hit(b, ic)) && !placed.some((q) => hit(b, q));
    const side = order.find((s) => fits(box(s))) ?? "below";
    out[p.key] = side;
    placed.push(box(side));
  });
  return out;
}

// ───────────── 点一个地点 ─────────────

/** 能“去走走”的课后活动（要补选地点的）：能排的在前；同样能排时只要地点的（不用约人）在前；其余按原来的先后。 */
export function outings(view: Pick<UpbringingView, "activities">): ActivityView[] {
  return view.activities
    .map((a, i) => ({ a, i }))
    .filter((p) => p.a.needs.includes("place"))
    .sort((p, q) => Number(q.a.enabled) - Number(p.a.enabled) || p.a.needs.length - q.a.needs.length || p.i - q.i)
    .map((p) => p.a);
}

/** 点地点时排进哪一格：选中的那一旬的课后格（选中的是学院期的课业格时，用同一旬的课后格）；没有选中时用第一个课后格。 */
export function townCell(view: Pick<UpbringingView, "stage" | "plan">, focused: Cell | undefined): Cell | undefined {
  // 按周（U05）只在本周还能排的课余 / 自由格里找；按旬照旧
  const afters = openCells(view).filter((c) => c.part === "after");
  return (focused && afters.find((c) => c.index === focused.index)) || afters[0];
}

/**
 * 点一个地点以后的日程草稿（等同于在原来的“去哪里”下拉框里选它）：
 * - 那一格排的活动本来就要选地点：补上这个地点（同伴等别的补选不动）；
 * - 否则把那一格换成第一个能排的“去走走”活动（outings），再补上地点——与点一张活动卡片再选地点一样，同伴之类的还要接着选。
 * 地点没开放、找不到这个地点、没有能排的“去走走”活动时为 null（草稿不变）。
 */
export function goPlace(view: Pick<UpbringingView, "stage" | "plan" | "activities" | "lessons" | "places">, draft: Draft, cell: Cell, place: string): Draft | null {
  if (cell.part !== "after") return null;
  const spot = view.places.find((p) => p.key === place);
  if (!spot || !spot.open) return null;
  const cur = draft.after[cell.index];
  const curAct = cur ? view.activities.find((a) => a.key === cur.activity) : undefined;
  if (cur && curAct?.needs.includes("place")) return cur.place === place ? draft : refine(draft, cell.index, { place });
  const go = outings(view).find((a) => a.enabled);
  if (!go) return null;
  return refine(assign(draft, cell, go.key), cell.index, { place });
}

/** 这个月已经排了去这个地点的旬（课后格的地点是它）：旬的名字（上旬、中旬……），按旬的先后。 */
export function chosenSlots(view: Pick<UpbringingView, "plan">, draft: Draft, place: string): string[] {
  return view.plan.slots.filter((s) => draft.after[s.index]?.place === place).map((s) => s.label);
}
