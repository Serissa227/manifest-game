// 人物与肖像素材的对应（AI 生成的肖像，清单见 portraitAssets.ts，规范见 art-src/PORTRAIT_BIBLE.md）：
// 329 位——英雄 64 位（主角外貌 24 种、航海士 40 位，B 画风）与路人 265 位（写实像素绘）。
// 主角外貌、航海士、设施掌柜、海盗头目、商会会长、各国君主、各国船长、酒馆情报贩子、殖民地总管各按什么规则取哪一张。
// 规则都是确定性的：同一个输入永远得到同一张图、同一个名字。取不到图时返回 null，界面回退到程序生成的头像（portraits.ts）；
// 回退头像（fallbackSpec）与素材同性别、同文化，名字也按素材的性别起，缺图时人还是那个人。
// “预留人物”机制（清单的 PENDING_PORTRAITS：人物与 id 已定、肖像还没有画好）照常给出 id 与元数据，只是没有图（portraitSrc 为 null），
// 界面回退到程序头像；画好接入后同一个 id 自动换成图片。英雄扩充的 30 位已经接入，眼下没有预留人物。
import { publicImage } from "./imageUrl";
import type { Facility } from "../store/game";
import { isArchStyle, styleOf, type ArchStyle } from "./buildings";
import { npcNamePair, type NamePairText } from "./names";
import { FACE_SIZE, FIGURE_ART, LEGACY_PORTRAITS, PENDING_PORTRAITS, PORTRAIT_ASSETS, STORY_LIVE, STORY_PORTRAITS, type FigureArt, type LiveArt, type PortraitAsset, type PortraitEntry, type PortraitGroup, type StoryPortrait } from "./portraitAssets";
import { PORT_FACILITIES, keeperSpec, portraitSpec, wrapCaptainLook, type KeeperSexes, type NpcRole, type PortraitSpec } from "./portraits";
import { hash32 } from "./rng";

/**
 * 素材图的两种尺寸：full 为胸像（512×512；专属头像 768、寰宇配角 512），face 为 256×256 脸部特写（96 像素以下的小头像位用）。
 * 2026-11-12 第十轮 A02 起按原图重新导出；缺原图的人物（LEGACY_PORTRAITS）仍是 256 / 128。
 */
export type PortraitVariant = "full" | "face";

const BY_ID: ReadonlyMap<string, PortraitAsset> = new Map(PORTRAIT_ASSETS.map((a) => [a.id, a]));
const LEGACY: ReadonlySet<string> = new Set(LEGACY_PORTRAITS);

/** 这位人物脸部特写的边长（像素）：一般 FACE_SIZE；缺原图、保留旧图的人物是 128。 */
export function facePixels(id: string | null | undefined): number {
  return id && LEGACY.has(id) ? 128 : FACE_SIZE;
}

/**
 * 按显示边长（CSS 像素）与设备像素比挑图：小头像位（≤ faceMax）用脸部特写——只要它的像素够这个位子在这块屏上用
 * （放大不超过 1.25 倍）；不够时（缺原图的旧人物在高像素比的屏上）改用胸像，宁可构图松一点也不糊。
 */
export function portraitVariantFor(id: string | null | undefined, size: number, dpr: number, faceMax: number): PortraitVariant {
  if (size > faceMax) return "full";
  return size * Math.max(1, dpr) <= facePixels(id) * 1.25 ? "face" : "full";
}

/** 推荐角色的专属头像（外貌编号 100 以上，只给那位角色用；不在普通清单里）。 */
const STORY_BY_ID: ReadonlyMap<string, StoryPortrait> = new Map(STORY_PORTRAITS.map((p) => [p.id, p]));
const STORY_BY_LOOK: ReadonlyMap<number, StoryPortrait> = new Map(STORY_PORTRAITS.map((p) => [p.look, p]));

/** 外貌编号对应的推荐角色专属头像（普通外貌为空）。 */
export function storyPortrait(look: number | null | undefined): StoryPortrait | undefined {
  return look === null || look === undefined ? undefined : STORY_BY_LOOK.get(Math.trunc(look));
}

/** 预留、还没有图的人物（已经画好接入的以清单为准）。 */
const PENDING_BY_ID: ReadonlyMap<string, PortraitEntry> = new Map(PENDING_PORTRAITS.filter((p) => !BY_ID.has(p.id)).map((p) => [p.id, p]));

/** 按 id 取人物：有图的素材，或预留、还没有图的人物（只有元数据）；不存在的 id 为 undefined。 */
export function portraitAsset(id: string | null | undefined): PortraitEntry | undefined {
  return id ? (BY_ID.get(id) ?? PENDING_BY_ID.get(id)) : undefined;
}

/** 是不是预留、肖像还没有画好的人物。 */
export function isPendingPortrait(id: string | null | undefined): boolean {
  return !!id && PENDING_BY_ID.has(id);
}

/** 某组的全部素材（按 id 排列）。 */
export function portraitGroup(group: PortraitGroup): readonly PortraitAsset[] {
  return PORTRAIT_ASSETS.filter((a) => a.group === group);
}

/** 这位人物会动的素材（没有就是 undefined）：寰宇主角的专属头像。 */
export function liveArtOf(id: string | null | undefined): LiveArt | undefined {
  if (!id) return undefined;
  return STORY_LIVE[id];
}

/** 素材 id 是否有图（预留、还没有画好的人物没有）。 */
export function hasPortrait(id: string | null | undefined): boolean {
  return !!id && (BY_ID.has(id) || STORY_BY_ID.has(id));
}

/** 素材图的地址（public 下，以部署的挂载路径 / 开头）；没有这张图（不存在或还没有画好）时为 null。 */
export function portraitSrc(id: string | null | undefined, variant: PortraitVariant = "full"): string | null {
  const story = id ? STORY_BY_ID.get(id) : undefined;
  if (story) return publicImage(variant === "face" ? story.face : story.file);
  const a = id ? BY_ID.get(id) : undefined;
  if (!a) return null;
  return publicImage(variant === "face" ? a.face : a.file);
}

// ───────────────────────────── 人物立绘 ─────────────────────────────

/** 立绘按人物键分组（清单里已按起用年龄排好）。 */
const FIGURES_BY_KEY: ReadonlyMap<string, readonly FigureArt[]> = (() => {
  const m = new Map<string, FigureArt[]>();
  for (const f of FIGURE_ART) {
    const list = m.get(f.key) ?? [];
    list.push(f);
    m.set(f.key, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.fromAge - b.fromAge);
  return m;
})();

/**
 * 人物的立绘（透明底，从头顶到膝上；见 portraitAssets.ts 的 FigureArt）：按数据里人物的键（persons / cast 的 key，如 "mio"、"ase"）取；
 * 给了年龄时取起用年龄（fromAge）不超过它、且最接近它的那一张（比所有 fromAge 都小时取最小的那张），没给时取最早的一张。这个人没有立绘时为 undefined（界面退回胸像或不显示）。
 * 画的是少年人（画里不满 18 岁）、而这个人已经比画里大了三岁以上时也给 undefined：航海期一局要走十来年，不拿小时候的立绘顶替长大以后的人。
 */
export function figureOf(key: string | null | undefined, age?: number | null): FigureArt | undefined {
  const list = key ? FIGURES_BY_KEY.get(key) : undefined;
  if (!list || list.length === 0) return undefined;
  if (age === null || age === undefined) return list[0];
  let pick: FigureArt | undefined;
  for (const f of list) if (f.fromAge <= age) pick = f;
  const best = pick ?? list[0];
  if (best.age < 18 && age - best.age > 3) return undefined;
  return best;
}

/** 立绘的地址（public 下，带版本号）：full 为大图 768×1152，small 为 384×576；没有立绘时为 null。 */
export function figureSrc(key: string | null | undefined, age?: number | null, variant: "full" | "small" = "full"): string | null {
  const f = figureOf(key, age);
  return f ? publicImage(variant === "small" ? f.small : f.file) : null;
}

/** 这个人有没有立绘。 */
export function hasFigure(key: string | null | undefined): boolean {
  return !!key && FIGURES_BY_KEY.has(key);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// ───────────────────────────── 主角与航海士 ─────────────────────────────

/**
 * 主角外貌 → 素材 id：普通外貌 0–11、13–24 依次为 captain-00…11、captain-13…24（越界的编号与 captainSpec 一样归一：
 * 按 25 取模，空缺的 12 号归到 0 号）。24 种都是 B 画风的英雄肖像。
 */
export function captainAssetId(look: number): string {
  const n = Math.trunc(look);
  // 推荐角色的专属头像（100 以上）；没有这张图的编号照常取模
  const story = STORY_BY_LOOK.get(n);
  if (story) return story.id;
  return `captain-${pad2(wrapCaptainLook(n))}`;
}

/**
 * 航海士 → 素材 id：按 mates.toml 的 key（mate-<key>，40 位都是 B 画风的英雄肖像）。清单里有图的、或预留了还没有画的给出 id；
 * 旧后端没有 key、或数据里新加了却既没有画也没有预留的航海士时为 null。
 */
export function mateAssetId(mate: { name: string; key?: string; portrait?: string | null }): string | null {
  // 第九批：航海士也是人物（寰宇）时，后端给出人物当前年龄的头像；有这张图就用它
  if (mate.portrait && (BY_ID.has(mate.portrait) || STORY_BY_ID.has(mate.portrait))) return mate.portrait;
  if (!mate.key) return null;
  const id = `mate-${mate.key}`;
  return BY_ID.has(id) || PENDING_BY_ID.has(id) ? id : null;
}

// ───────────────────────────── 设施掌柜 ─────────────────────────────

/** 掌柜所在的地点：key、海图坐标与文化（掌柜的分配用它让相邻港口换一位）。 */
export interface KeeperPlace {
  key: string;
  x: number;
  y: number;
  region: ArchStyle;
}

/** 一格（文化 × 设施）的掌柜素材：a、b（一男一女）与 c（第三位，性别不定），按 a / b / c 排列。 */
function keeperCell(region: ArchStyle, facility: string): PortraitAsset[] {
  return (["a", "b", "c"] as const).map((v) => BY_ID.get(`keeper-${region}-${facility}-${v}`)).filter((a): a is PortraitAsset => !!a);
}

/** 分配掌柜时每个地点要避开的邻居数：离它最近的两个同文化地点。 */
export const KEEPER_NEIGHBORS = 2;

/**
 * 同文化地点里每个地点离它最近的 neighbors 个（距离相同按 key）。地点先按 key 排好（同一个 key 只取一次），
 * 所以结果与地点列表的顺序无关。返回排好的地点与每个地点的邻居下标（由近到远）。
 */
function keeperNeighbors(places: readonly KeeperPlace[], region: ArchStyle, neighbors: number): { group: KeeperPlace[]; near: number[][] } {
  const cmp = (a: KeeperPlace, b: KeeperPlace) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.x - b.x || a.y - b.y);
  const sorted = places.filter((p) => p.region === region).sort(cmp);
  const group = sorted.filter((p, i) => i === 0 || sorted[i - 1].key !== p.key);
  const d2 = (i: number, j: number) => (group[i].x - group[j].x) ** 2 + (group[i].y - group[j].y) ** 2;
  const near = group.map((_, i) =>
    group
      .map((_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => d2(i, a) - d2(i, b) || a - b)
      .slice(0, neighbors),
  );
  return { group, near };
}

/** 回溯着色的步数上限（每种文化只有十来个地点，正常几十步就够；上限只防病态数据）。 */
const COLOR_STEPS = 100_000;

/**
 * 给图着色（相邻的点不同色），按下标顺序回溯；每个点按自己的偏好顺序试颜色。找不到（或超过步数上限）时为 null。
 */
function colorGraph(adj: readonly (readonly number[])[], prefs: readonly (readonly number[])[]): number[] | null {
  const n = adj.length;
  const color = new Array<number>(n).fill(-1);
  const tried = new Array<number>(n).fill(0);
  let steps = 0;
  let i = 0;
  while (i >= 0 && i < n) {
    if (++steps > COLOR_STEPS) return null;
    let placed = false;
    while (tried[i] < prefs[i].length) {
      const c = prefs[i][tried[i]++];
      if (adj[i].every((j) => j > i || color[j] !== c)) {
        color[i] = c;
        placed = true;
        break;
      }
    }
    if (placed) i++;
    else {
      color[i] = -1;
      tried[i] = 0;
      i--;
    }
  }
  return i < 0 ? null : color;
}

/**
 * 同文化、同设施的地点在这一格的 a / b / c 三位之间的分配（地点 key → 素材 id；不看性别，三位都可选）：
 * 每个地点要与离它最近的 neighbors 个（默认两个）同文化地点不是同一位（互为“邻居”的两处都不能撞）——
 * 航行到相邻的港口，同一种设施里站的是另一个人。做法是把“邻居”连成图、用三位着色：地点按 key 依次取，
 * 每个地点按“地点-设施-素材”的哈希排好自己试三位的顺序，回溯到全部满足为止，所以三位出现得差不多一样多。
 * 两近邻图在坐标没有大片等距时总能三着色；万一着不了色（病态的等距坐标，或测试里把 neighbors 调大），退一步只保证
 * 每个地点与离它最近的那一个不同：“最近的那一个”连成的图每个连通块是一棵树加一对互为最近的地点，从那一对出发逐层
 * 给子地点取与它最近的地点不同的一位，在此之上尽量也避开其余邻居。结果只取决于地点的 key 与坐标，与列表顺序无关。
 */
export function planKeepers(places: readonly KeeperPlace[], facility: string, region: ArchStyle, neighbors = KEEPER_NEIGHBORS): Map<string, string> {
  const cell = keeperCell(region, facility);
  if (cell.length === 0) return new Map();
  const { group, near } = keeperNeighbors(places, region, neighbors);
  const n = group.length;
  // 每个地点试三位的顺序：按“地点-设施-素材”的哈希排（哈希相同按 a / b / c）
  const prefs = group.map((p) => {
    const h = cell.map((a) => hash32(`keeper-art-${p.key}-${facility}-${a.id}`));
    return cell.map((_, c) => c).sort((a, b) => h[a] - h[b] || a - b);
  });
  // “邻居”图：一方是另一方最近的 neighbors 个之一
  const adj: number[][] = group.map(() => []);
  const link = (i: number, j: number) => {
    if (!adj[i].includes(j)) adj[i].push(j);
    if (!adj[j].includes(i)) adj[j].push(i);
  };
  near.forEach((js, i) => js.forEach((j) => link(i, j)));
  let color = colorGraph(adj, prefs);
  if (!color) {
    // 退一步：每个地点只保证与离它最近的那一个不同，按“最近”关系从互为最近的一对逐层往外取
    const c = new Array<number>(n).fill(-1);
    const nearest = near.map((js) => js[0] ?? -1);
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (nearest[i] < 0 || (nearest[nearest[i]] === i && i < nearest[i])) order.push(i);
    for (let k = 0; k < order.length; k++) {
      const v = order[k];
      for (let j = 0; j < n; j++) if (nearest[j] === v && !order.includes(j)) order.push(j);
    }
    // 保险：每个地点都能从它那一块的那一对走到，漏掉的（不会发生）排在最后
    for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);
    for (const i of order) {
      const must = nearest[i] >= 0 ? c[nearest[i]] : -1;
      const avoid = new Set(adj[i].map((j) => c[j]).filter((x) => x >= 0));
      const ok = prefs[i].filter((x) => x !== must);
      c[i] = ok.find((x) => !avoid.has(x)) ?? ok[0] ?? prefs[i][0];
    }
    color = c;
  }
  return new Map(group.map((p, i) => [p.key, cell[color[i]].id] as const));
}

/** 地点列表 → 各格（设施 | 文化）的分配结果。按地点列表对象缓存（界面传入的列表随静态数据不变）。 */
const PLAN_CACHE = new WeakMap<readonly KeeperPlace[], Map<string, ReadonlyMap<string, string>>>();

/** planKeepers（默认邻居数）的缓存版。 */
function keeperPlan(places: readonly KeeperPlace[], facility: string, region: ArchStyle): ReadonlyMap<string, string> {
  let byGroup = PLAN_CACHE.get(places);
  if (!byGroup) {
    byGroup = new Map();
    PLAN_CACHE.set(places, byGroup);
  }
  const groupKey = `${facility}|${region}`;
  const hit = byGroup.get(groupKey);
  if (hit) return hit;
  const out = planKeepers(places, facility, region);
  byGroup.set(groupKey, out);
  return out;
}

/**
 * 设施掌柜 → 素材 id：每种文化的每种设施各有 a、b、c 三位，三位都可选（不再限定与原程序头像同性别，名字与性别跟随选中的一位，见 keeperCast）。
 * 给了地点列表（places，界面按静态数据的地点给出）就按 planKeepers 分配，让每个港口与离它最近的两个同文化港口不是同一位；
 * 没给（或这个地点不在列表里）就按港口 key 的哈希取。同一港口的九位掌柜来自九种设施，天然互不重复。
 */
export function keeperAssetId(locKey: string, facility: string, region: ArchStyle, places?: readonly KeeperPlace[]): string | null {
  const cell = keeperCell(region, facility);
  if (cell.length === 0) return null;
  if (cell.length === 1) return cell[0].id;
  const planned = places ? keeperPlan(places, facility, region).get(locKey) : undefined;
  return planned ?? cell[hash32(`keeper-art-${locKey}-${facility}`) % cell.length].id;
}

/** 同一港口九位掌柜的性别（按选中的素材；某种设施没有素材时不给，程序头像按种子定）。 */
export function keeperSexes(locKey: string, region: ArchStyle, places?: readonly KeeperPlace[]): KeeperSexes {
  const out: Partial<Record<Facility, boolean>> = {};
  for (const f of PORT_FACILITIES) {
    const a = portraitAsset(keeperAssetId(locKey, f, region, places));
    if (a) out[f] = assetFemale(a);
  }
  return out;
}

/**
 * 设施掌柜：选中的肖像素材，以及跟随它的回退头像参数与名字（中英成对）。
 * 先按 keeperAssetId 选肖像，再把这个港口九位掌柜的性别交给 keeperSpec：回退的程序头像按肖像的性别画（同港九位照旧不撞脸），
 * 名字仍以“港口 key-设施”为种子、按肖像的性别与港口的文化起——名字、头像、回退三者是同一个人。
 */
export function keeperCast(
  locKey: string,
  facility: Facility,
  region: ArchStyle,
  places?: readonly KeeperPlace[],
  style?: string | null,
): { asset: string | null; spec: PortraitSpec; name: string; nameEn: string } {
  const asset = keeperAssetId(locKey, facility, region, places);
  const { spec, name, nameEn } = keeperSpec(locKey, facility, region, keeperSexes(locKey, region, places), style);
  return { asset, spec, name, nameEn };
}

// ───────────────────────────── 海盗头目 ─────────────────────────────

/**
 * 海盗头目 → 素材 id：20 位头目（十男十女）里，在同性别的十位中按遭遇编号取一位
 * （性别由遭遇编号决定、约四分之一是女头目，名字随之，见 BattleDialog）。
 */
export function pirateAssetId(battle: number, female: boolean): string | null {
  const all = portraitGroup("pirate");
  const same = all.filter((a) => (a.meta.gender === "female") === female);
  const pool = same.length > 0 ? same : all;
  if (pool.length === 0) return null;
  return pool[hash32(`pirate-art-${battle}`) % pool.length].id;
}

// ───────────────────────────── 商会、君主与各国船长 ─────────────────────────────

/**
 * NPC 商会的 key，按 data/companies.toml 的顺序（后端的商会编号就是这个顺序；该文件的 key 只允许追加）。
 * 静态数据里的商会（StaticView.companies）只有编号与名字，界面按编号查这张表。
 */
export const COMPANY_KEYS: readonly string[] = ["gull", "anchor", "amberhouse", "cloudsail", "bronze", "polaris"];

/** 商会会长 → 素材 id（按商会编号）；数据里新加的商会还没有画时为 null。 */
export function companyAssetId(company: number): string | null {
  const key = COMPANY_KEYS[company];
  return key && BY_ID.has(`company-${key}`) ? `company-${key}` : null;
}

/** 势力的君主 → 素材 id（按势力 key）。 */
export function rulerAssetId(factionKey: string | undefined): string | null {
  return factionKey && BY_ID.has(`ruler-${factionKey}`) ? `ruler-${factionKey}` : null;
}

/** 某势力的船长 → 素材 id：24 位船长、每个势力四位（两男两女），按 seed（船队编号等）确定性地取一位；势力没有船长素材时为 null。 */
export function rivalAssetId(factionKey: string | undefined, seed: string | number): string | null {
  const pool = portraitGroup("rival").filter((a) => a.meta.faction === factionKey);
  if (pool.length === 0) return null;
  return pool[hash32(`rival-art-${factionKey}-${seed}`) % pool.length].id;
}

/** 商会会长的文化（素材的元数据）；没有素材时为 undefined。 */
export function companyCulture(company: number): ArchStyle | undefined {
  const c = portraitAsset(companyAssetId(company))?.meta.culture;
  return isArchStyle(c) ? c : undefined;
}

/**
 * 海图上别家商会的船队 → 船长：船队归属商会，商会会长的文化对应的势力（按势力的建筑风格）就是船队所属的势力，
 * 在该势力的四位船长里按 seed（船队）取一位；找不到对应势力时在全部船长里取。返回素材 id 与势力 key。
 */
export function fleetCaptain(
  company: number,
  factions: readonly { key: string; style?: string | null }[],
  seed: string | number,
): { asset: string | null; faction: string | undefined } {
  const culture = companyCulture(company);
  const faction = culture ? factions.find((f) => styleOf(f.key, f.style) === culture)?.key : undefined;
  const asset = rivalAssetId(faction, seed);
  if (asset) return { asset, faction };
  const all = portraitGroup("rival");
  if (all.length === 0) return { asset: null, faction };
  const pick = all[hash32(`rival-art-any-${company}-${seed}`) % all.length];
  return { asset: pick.id, faction: pick.meta.faction };
}

// ───────────────────────────── 酒馆情报贩子与殖民地总管 ─────────────────────────────

/** 酒馆情报贩子 → 素材 id：按港口的文化，a / b 按港口 key 的哈希取。 */
export function informantAssetId(region: ArchStyle, locKey: string): string | null {
  const id = `informant-${region}-${hash32(`informant-art-${locKey}`) % 2 === 0 ? "a" : "b"}`;
  return BY_ID.has(id) ? id : null;
}

/** 殖民地总管 → 素材 id：六位总管按殖民地编号轮流（编号 0 是 01 号，编号 6 又是 01 号）。 */
export function stewardAssetId(colony: number): string | null {
  const n = portraitGroup("steward").length;
  if (n === 0) return null;
  const i = ((Math.trunc(colony) % n) + n) % n;
  return `steward-${pad2(i + 1)}`;
}

// ───────────────────────────── 名字与回退头像 ─────────────────────────────

/** 素材人物的文化（七种建筑风格之一；主角的 open、elfkin 等不算）。 */
export function assetRegion(asset: PortraitEntry | undefined): ArchStyle | undefined {
  const c = asset?.meta.culture;
  return isArchStyle(c) ? c : undefined;
}

/** 素材人物是不是女性（没有素材时为 false）。 */
export function assetFemale(asset: PortraitEntry | undefined): boolean {
  return asset?.meta.gender === "female";
}

/**
 * 没有数据名字的素材人物（商会会长、君主、各国船长、情报贩子、殖民地总管）的名字：
 * 以 seed 为种子、按素材的性别与文化起一个中英成对的名字（names.ts 的名池），同一个 seed 永远同一个名字。
 */
export function castName(id: string | null, seed: string, region?: ArchStyle, style?: string | null): NamePairText {
  const a = portraitAsset(id);
  return npcNamePair(seed, assetFemale(a), region ?? assetRegion(a), style);
}

/** 素材人物的回退头像参数：与素材同性别、同文化、年龄段相近（缺图时用程序头像）。 */
export function fallbackSpec(id: string | null, seed: string, role: NpcRole, region?: ArchStyle): PortraitSpec {
  const a = portraitAsset(id);
  const age = a ? (a.meta.age < 35 ? 0 : a.meta.age < 55 ? 1 : 2) : undefined;
  return portraitSpec(seed, role, { female: assetFemale(a), region: region ?? assetRegion(a), age });
}
