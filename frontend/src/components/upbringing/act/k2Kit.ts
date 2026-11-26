// U06F3：行动制内核二（K2）的纯逻辑——开档缺什么、主命目标、身份名、结业清单每行的来历。只从视图里的数推，不另算规则。
// 字在 i18n/zhOnly.ts（键名照 docs/tasks/R10-U06K2.md“文案”一节），用 tz() 取。
import { tz, ZH_ONLY, type ZhOnlyKey } from "../../../i18n/zhOnly";
import type { ActView, Band, CapitalRowView, LineTierView, LineView, MissionView, MomentPick } from "../../../ipc/actTypes";
import { hundredths, PENDING, type ActNames } from "./actKit";

export const BANDS: Band[] = ["ding", "bing", "yi", "jia", "te"];
export const bandName = (b: Band | string): string => (BANDS.includes(b as Band) ? tz(`ub.act.band.${b}` as ZhOnlyKey) : b);
export const pickName = (p: MomentPick): string => tz(`ub.act.moment.${p}` as ZhOnlyKey);

const present = (s: string | null | undefined): s is string => typeof s === "string" && s.length > 0;

/** 这一档还缺的条件，每条一句（“航海还差 14”“阿濑的好感 8/15”）。 */
export function tierNeeds(line: LineView, t: LineTierView, names: ActNames, act: Pick<ActView, "week">): string[] {
  const attr = line.attr ? names.attr(line.attr) : "";
  const root = line.root ? names.attr(line.root) : attr;
  return (t.missing ?? []).map((m) => {
    switch (m) {
      case "gain":
        return tz("ub.act.tier.need.gain", { attr, n: Math.max(0, (t.gain_need ?? 0) - (t.gain_have ?? 0)) });
      case "root":
        return tz("ub.act.tier.need.root", { attr: root, need: t.root_need ?? "?", have: t.root_have ?? "?" });
      case "bond":
        return tz("ub.act.tier.need.bond", { who: line.mentor ? names.person(line.mentor) : "", have: t.bond_have ?? 0, need: t.bond_need ?? "?" });
      case "rank":
        return act.week.stage === "academy"
          ? tz("ub.act.tier.need.rankExam", { need: t.rank_need ?? "?" })
          : tz("ub.act.tier.need.rank", { need: t.rank_need ?? "?", have: t.rank_have ?? "?" });
      case "requires": {
        const r = (t.requires ?? []).find((x) => !x.ok);
        return r ? tz("ub.act.tier.need.requires", { line: names.line(r.line), t: r.tier + 1 }) : tz("ub.act.tier.need.requires", { line: "?", t: "?" });
      }
      case "master":
        return tz("ub.act.tier.need.master");
      default:
        return tz("ub.act.tier.need.structural");
    }
  });
}

/** 这一档开着（已付或条件都满足）。后端的 open 已经是这个意思；missing 只用来写原因。 */
export const tierOpen = (t: LineTierView): boolean => t.open || t.paid === true;

/** 能当场拜师：这一档要师事、还没过、除了师事别的都满足。 */
export function canMaster(t: LineTierView): boolean {
  return t.gate === "master_test" && t.master === false && (t.missing ?? []).every((m) => m === "master");
}

/** 一档的一句对照（悬停提示与各档对照表共用）：“每格 航海 +1.54 · 学费 1/格 · 器具 30（一次）”。 */
export function tierFacts(line: LineView, t: LineTierView, names: ActNames): string[] {
  const out: string[] = [];
  if (t.yield_x100 !== undefined) out.push(tz("ub.act.tier.yield", { attr: line.attr ? names.attr(line.attr) : "", n: hundredths(t.yield_x100) }));
  // U06K2c：每档的成功与出彩（不带同行者）
  if (t.success_pct !== undefined) out.push(tz("ub.act.tier.success", { n: t.success_pct }));
  if (t.great_pct !== undefined) out.push(tz("ub.act.tier.great", { n: t.great_pct }));
  if (t.fee !== null) out.push(t.fee > 0 ? tz("ub.act.tier.fee", { n: t.fee }) : tz("ub.act.tier.free"));
  if (!t.paid && (t.tool ?? 0) > 0) out.push(tz("ub.act.tier.tool", { n: t.tool ?? 0 }));
  return out;
}

/** 身份名：静态文字表 act:rank:<家庭>:<home|academy>:<级>；没有时写“n 级”。“（待写）”原样显示。 */
export function rankName(texts: Readonly<Record<string, string>> | undefined, kind: "home" | "academy", level: number): string {
  const suffix = `:${kind}:${level}`;
  const key = Object.keys(texts ?? {}).find((k) => k.startsWith("act:rank:") && k.endsWith(suffix));
  const name = key ? texts?.[key] : undefined;
  const lv = tz("ub.act.rank.level", { n: level });
  if (!present(name)) return lv;
  return name === PENDING ? `${lv}${name}` : name;
}

/** 主命的一句话（数据 missions[].text）。 */
export function missionText(texts: Readonly<Record<string, string>> | undefined, key: string): string {
  const s = texts?.[`act:mission:${key}:text`];
  return present(s) ? s : PENDING;
}

/** 主命目标的一行。 */
export function goalText(g: MissionView["goals"][number], names: ActNames, contestName: (k: string) => string): string {
  const target = g.target ?? "";
  // U06K2c：数据给了这条目标的一句话就用它，后面带上进度
  if (present(g.label) && g.label !== PENDING) return g.kind === "flag" ? g.label : tz("ub.act.mission.goal.label", { text: g.label, have: g.have, need: g.need });
  switch (g.kind) {
    case "deed": {
      const k = `ub.act.deed.${target}`;
      const what = k in ZH_ONLY ? tz(k as ZhOnlyKey) : tz("ub.act.deed.any");
      return tz("ub.act.mission.goal.deed", { what, have: g.have, need: g.need });
    }
    case "tier":
      // 第三趟：后端数的是“付过的最高档 + 1”——第 1 档要真排上课（开课时）才算付过，与各档对照里的“已开”是一回事，
      // “可排”还不算。所以写“开到第 N 档”并说明“排上课才算”，现况写“已开到第 n 档 / 还没开”
      return g.have > 0
        ? tz("ub.act.mission.goal.tier", { line: names.line(target), have: g.have, need: g.need })
        : tz("ub.act.mission.goal.tierNone", { line: names.line(target), need: g.need });
    case "gain":
      return tz("ub.act.mission.goal.gain", { attr: names.attr(target), have: g.have, need: g.need });
    case "skill":
      return tz("ub.act.mission.goal.skill", { skill: names.skill(target), have: g.have, need: g.need });
    case "affinity":
      return tz("ub.act.mission.goal.affinity", { who: names.person(target), have: g.have, need: g.need });
    case "duty":
      return tz("ub.act.mission.goal.duty", { duty: names.duty(target), have: g.have, need: g.need });
    case "contest":
      return tz("ub.act.mission.goal.contest", { contest: contestName(target), need: g.need });
    default:
      return tz("ub.act.mission.goal.flag");
  }
}

/** 主命做到哪儿：已成的目标数 / 目标数。 */
export const missionProgress = (m: MissionView): { done: number; total: number } => ({ done: m.goals.filter((g) => g.done).length, total: m.goals.length });

/** 奖励写成一行。 */
export function rewardText(m: MissionView, names: ActNames): string {
  return m.reward
    .map((r) => {
      if (r.kind === "cash") return tz("ub.act.mission.rewardCash", { n: r.qty });
      if (r.kind === "affinity") return tz("ub.act.mission.rewardAffinity", { who: names.person(r.key ?? ""), n: r.qty });
      return `${names.item(r.key ?? "")}${r.qty > 1 ? ` ×${r.qty}` : ""}`;
    })
    .join("、");
}

/** 结业清单每行的名字（船、物品等按键取名；钱、粮、水、水手只写数）。 */
export function capitalRowName(
  r: CapitalRowView,
  names: ActNames,
  shipName: (k: string) => string,
  k3?: { rumorKey(key: string): string; good(key: string): string },
): string {
  const kind = tz(`ub.act.capital.${r.kind}` as ZhOnlyKey);
  // U06F4（K3a）：见闻卡与认熟的货（不进资本，只是清单上多一行）
  if (r.kind === "rumor") return `${kind}·${k3 ? k3.rumorKey(r.key) : tz("ub.act.rumor.title")}`;
  if (r.kind === "known_good") return `${kind}·${k3 ? k3.good(r.key) : tz("ub.act.name.good")}`;
  // 第三趟：后端给了这一行的显示名（可选）就用它
  const own = present(r.name) && r.name !== PENDING ? r.name : null;
  if (own && r.kind !== "cash" && r.kind !== "crew" && r.kind !== "food" && r.kind !== "water")
    return `${kind}·${own}${r.kind === "ship" && r.condition !== null ? `（${tz("ub.act.capital.condition", { n: r.condition })}）` : ""}${r.qty > 1 && r.kind !== "ship" ? ` ×${r.qty}` : ""}`;
  switch (r.kind) {
    case "cash":
      return `${kind} ${r.qty} 文`;
    case "crew":
      return `${kind} ${r.qty} 人`;
    case "food":
    case "water":
      return `${kind} ${r.qty}`;
    case "ship":
      return `${kind}·${shipName(r.key)}${r.condition !== null ? `（${tz("ub.act.capital.condition", { n: r.condition })}）` : ""}`;
    case "mate":
    case "ally":
      return `${kind}·${names.person(r.key)}`;
    default:
      return `${kind}·${names.item(r.key)}${r.qty > 1 ? ` ×${r.qty}` : ""}`;
  }
}

/** 这一行是哪件事换来的。 */
export function capitalSource(src: string, names: ActNames): string {
  const [head, rest = ""] = src.split(/:(.*)/s, 2) as [string, string?];
  switch (head) {
    case "grade":
      return tz("ub.act.source.grade", { band: bandName(rest) });
    case "mate":
      return tz("ub.act.source.mate", { who: names.person(rest) });
    case "ally":
      return tz("ub.act.source.ally", { who: names.person(rest) });
    case "family_duty":
      return tz("ub.act.source.family_duty", { duty: names.duty(rest) });
    case "rumor":
    case "known_good":
      return tz(`ub.act.source.${head}` as ZhOnlyKey);
    case "common":
    case "aspiration":
    case "slot_cash":
    case "rank":
    case "ending":
    case "savings":
      return tz(`ub.act.source.${head}` as ZhOnlyKey);
    default:
      // 不认识的来历（后端新加的）：不露键
      return tz("ub.act.source.other");
  }
}

/** 课格结果里关键时刻那一段（“险·成了”）。 */
export function momentResult(s: { moment?: MomentPick | null; moment_ok?: boolean | null }): string | null {
  if (!s.moment) return null;
  if (s.moment_ok === true) return tz("ub.act.moment.result.win", { pick: pickName(s.moment) });
  if (s.moment_ok === false) return tz("ub.act.moment.result.lose", { pick: pickName(s.moment) });
  return tz("ub.act.moment.result.plain", { pick: pickName(s.moment) });
}
