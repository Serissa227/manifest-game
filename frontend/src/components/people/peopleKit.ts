// 人物页与任务日志（docs/UI-CONTRACT.md I5）的纯逻辑：排序、关系图的布局、没有头像时的占位脸、任务的排序；
// 以及见闻簿（I5b）：见闻的排序、没读过的条目、人物 key → 名字与头像的索引。
import type { NewsItem, PersonCard, PersonDetail, PersonFleetView, RelationshipsView, ShipTypeView, TrackView, WorldCatalog, WorldDate } from "../../ipc/types";
import { captainPortrait } from "../start/captain";
import type { Px } from "../../art/px";

export type PersonSort = "affinity" | "name" | "recent";

/** 排序：情谊高的在前 / 按名字 / 按后端给的顺序（最近遇到的在前）。 */
export function sortPersons(list: PersonCard[], by: PersonSort): PersonCard[] {
  if (by === "recent") return list;
  const out = [...list];
  if (by === "name") out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  else out.sort((a, b) => b.affinity - a.affinity || (b.heart ?? -1) - (a.heart ?? -1) || a.name.localeCompare(b.name, "zh-CN"));
  return out;
}

/** 没有头像素材时的占位脸（程序生成的头像按 key 挑一张，不同人不同脸）。 */
export function faceOf(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

/** 一位人物的头像素材（后端给的）与缺图时的回退。 */
export function personFace(key: string, portrait: string | null | undefined): { asset: string | null | undefined; fallback: () => Px } {
  return { asset: portrait, fallback: faceOf(key) };
}

/** 关系图的布局：主角在圆心（有几位主角就在圆心附近错开），其余人物等距排在圆周上（按 key 排序，布局确定）。坐标是 0–1 的比例。 */
export function circleLayout(rel: RelationshipsView): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const heroes = rel.nodes.filter((n) => n.kind === "protagonist").map((n) => n.key);
  const others = rel.nodes
    .filter((n) => n.kind !== "protagonist")
    .map((n) => n.key)
    .sort();
  heroes.forEach((k, i) => {
    const a = (i / Math.max(1, heroes.length)) * Math.PI * 2;
    const r = heroes.length > 1 ? 0.06 : 0;
    out.set(k, { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r });
  });
  others.forEach((k, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, others.length)) * Math.PI * 2;
    out.set(k, { x: 0.5 + Math.cos(a) * 0.4, y: 0.5 + Math.sin(a) * 0.38 });
  });
  return out;
}

/** 任务日志的排序：进行中在前（有期限的按剩余天数），然后等待中、完成、失败。 */
export function sortTracks(list: TrackView[]): TrackView[] {
  const rank = { active: 0, waiting: 1, done: 2, failed: 3 } as const;
  const soonest = (t: TrackView) => Math.min(...t.objectives.filter((o) => !o.done && typeof o.days_left === "number").map((o) => o.days_left as number), Infinity);
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || soonest(a) - soonest(b) || a.name.localeCompare(b.name, "zh-CN"));
}

// ───────────────────────────── 见闻簿（I5b） ─────────────────────────────

/** 两个世界日期的先后：a 早于 b 为负。 */
export function compareDate(a: WorldDate, b: WorldDate): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** 见闻簿的顺序：事情发生的日子晚的在前；同一天的照后端给的顺序（稳定排序）。 */
export function sortNews(items: readonly NewsItem[]): NewsItem[] {
  return items
    .map((x, i) => [x, i] as const)
    .sort(([a, i], [b, j]) => compareDate(b.day, a.day) || i - j)
    .map(([x]) => x);
}

/** 没读过的条目的 id（按出现的顺序）。 */
export function unreadIds(items: readonly NewsItem[]): string[] {
  return items.filter((x) => !x.read).map((x) => x.id);
}

/** 人物 key → 名字与头像（见闻里只给 key，名字与头像从认识的人与人际里找）。 */
export type PeopleIndex = ReadonlyMap<string, { name: string; portrait: string | null }>;

/** 由认识的人、某位的详情（本人与他的人际）合成索引；先来的为准。 */
export function peopleIndex(list: readonly PersonCard[] | null | undefined, detail?: PersonDetail | null): PeopleIndex {
  const out = new Map<string, { name: string; portrait: string | null }>();
  const put = (key: string, name: string, portrait: string | null) => {
    if (!out.has(key)) out.set(key, { name, portrait });
  };
  for (const p of list ?? []) put(p.key, p.name, p.portrait);
  if (detail) {
    put(detail.key, detail.name, detail.portrait);
    for (const x of detail.ties ?? []) put(x.person, x.name, x.portrait);
  }
  return out;
}

/** 见闻的种类对应的小图标：亲眼看到是望远镜，听说是酒馆的杯子，信里写的是封蜡的文书。 */
export const NEWS_ICON = { seen: "discovery", heard: "tavern", letter: "report" } as const;

// ───────────────────────────── A9：人物的船与同窗记忆 ─────────────────────────────

/** 学院 key → 名字：同窗记忆只给学院 key，名字取开局目录里各主角、模板的学院卡（同一 key 先来的为准）。 */
export function academyNames(catalog: WorldCatalog | null | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const w of catalog?.worlds ?? []) {
    for (const s of w.scenarios) {
      for (const a of [...s.protagonists.map((p) => p.academy), ...s.templates.map((x) => x.academy)]) {
        if (a?.key && a.name && !out.has(a.key)) out.set(a.key, a.name);
      }
    }
  }
  return out;
}

/** 某位此刻停在这里的船（persons.fleets 里只有当面见到的）：船型名（不认识的 key 不显示）与艘数。 */
export function fleetShips(
  fleets: readonly PersonFleetView[] | undefined,
  person: string,
  ships: readonly ShipTypeView[] | undefined,
): { names: string[]; count: number } | null {
  const f = fleets?.find((x) => x.person === person);
  if (!f || f.ships.length === 0) return null;
  return { names: f.ships.map((k) => ships?.find((s) => s.key === k)?.name).filter((n): n is string => !!n), count: f.ships.length };
}
