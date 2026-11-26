// 第九批开局（docs/UI-CONTRACT.md I1）的纯逻辑：世界目录的整理、主角名册的选择、按年龄挑头像、步骤与开局请求。
// 经典世界照旧走原来的向导（StartScreen + wizard.ts）；这里只管带主角名册的世界（寰宇·十六世纪……）。
import type { NewGameRequest, ProtagonistCard, ScenarioCard, WorldCard, WorldCatalog, WorldDate } from "../../ipc/types";

/** 经典世界的 key（它的开局界面不变）。 */
export const CLASSIC_WORLD = "classic";

/** 名册里"自创"那一格的 key（不会与主角的 key 冲突：主角 key 是小写字母与下划线）。 */
export const CUSTOM_HERO = "@custom";

/**
 * 新开局可选的世界：有别的世界时不再列出经典世界。
 * 只隐藏新开局的入口：经典的存档照旧能读、能续玩；只有经典一个世界（旧后端）时照旧。
 */
export function newGameWorlds<W extends { key: string }>(worlds: readonly W[]): W[] {
  const others = worlds.filter((w) => w.key !== CLASSIC_WORLD);
  return others.length > 0 ? others : [...worlds];
}

/** 开局界面要不要先选世界：可见的世界多于一个时才要。 */
export function needsWorldStep(catalog: WorldCatalog | null | undefined): boolean {
  return !!catalog && catalog.worlds.length > 1;
}

/** 这个世界的内容暂时只有中文（B11 的 languages 不含 "en"；旧后端没有这个字段时按中英都有）。 */
export function chineseOnly(languages: string[] | null | undefined): boolean {
  return !!languages && !languages.includes("en");
}

/** 这个世界的剧本里有没有主角名册（有就走新的开局流程）。 */
export function hasRoster(world: WorldCard): boolean {
  return world.scenarios.some((s) => s.protagonists.length > 0 || s.templates.length > 0);
}

/** 缺省选中的剧本：第一个有主角名册的剧本，没有时第一个剧本。 */
export function defaultScenarioOf(world: WorldCard): ScenarioCard | null {
  return world.scenarios.find((s) => s.protagonists.length > 0) ?? world.scenarios[0] ?? null;
}

/** 新流程的步骤。 */
export type WorldStep = "scenario" | "hero" | "template" | "look" | "name" | "confirm";

/**
 * 步骤：剧本（只有一个剧本时跳过）→ 主角名册（剧本没有主角也没有模板时跳过）→ 自创时：模板、外貌、姓名与生日 → 启航。
 * 没有主角名册的剧本（自由航海）在这里只有"剧本 → 启航"——主角由后端按剧本缺省给出（或以后补自创向导）。
 */
export function worldSteps(world: WorldCard, scenario: ScenarioCard | null, hero: string | null): WorldStep[] {
  const steps: WorldStep[] = [];
  if (world.scenarios.length > 1) steps.push("scenario");
  const roster = !!scenario && (scenario.protagonists.length > 0 || scenario.templates.length > 0);
  if (roster) steps.push("hero");
  if (roster && hero === CUSTOM_HERO) steps.push("template", "look", "name");
  steps.push("confirm");
  return steps;
}

/** 某个年龄应显示的头像：取 from_age 不超过 age 的最后一张；都比 age 大时取第一张；没有头像时为 null。 */
export function portraitAt(card: Pick<ProtagonistCard, "portraits">, age: number): string | null {
  const list = [...card.portraits].sort((a, b) => a.from_age - b.from_age);
  if (list.length === 0) return null;
  let pick = list[0];
  for (const p of list) if (p.from_age <= age) pick = p;
  return pick.asset;
}

/** 头像的各个年龄段（去重、按年龄排序），名册里的"童年 / 学院 / 出航"切换用。
 *  相邻两段是同一张图时只留年龄大的一段：数据里常有 `from_age = 0` 与 `from_age = 12` 指向同一张 12 岁的图，不显示"0 岁"。 */
export function portraitStages(card: Pick<ProtagonistCard, "portraits">): { from_age: number; asset: string }[] {
  const seen = new Set<number>();
  const list = [...card.portraits]
    .sort((a, b) => a.from_age - b.from_age)
    .filter((p) => (seen.has(p.from_age) ? false : (seen.add(p.from_age), true)));
  return list.filter((p, i) => list[i + 1]?.asset !== p.asset);
}

/** 某天的周岁（按世界日历的年月日比较；生日当天算满）。 */
export function ageOn(born: WorldDate, on: WorldDate): number {
  const [by, bm, bd] = born;
  const [y, m, d] = on;
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return Math.max(0, age);
}

/** 自创主角的草稿。 */
export interface CustomDraft {
  name: string;
  look: number;
  gender: "f" | "m";
  month: number;
  day: number;
}

/** 开局请求：选了主角时只带主角；自创时带模板与姓名、外貌、性别、生日。 */
export function buildRequest(args: {
  world: WorldCard;
  scenario: ScenarioCard;
  hero: string | null;
  template: string | null;
  custom: CustomDraft;
  seed: number | null;
  skipUpbringing: boolean;
  history: boolean;
  info: "live" | "carried";
}): NewGameRequest {
  const { world, scenario, hero, template, custom, seed, skipUpbringing, history, info } = args;
  const req: NewGameRequest = { world: world.key, scenario: scenario.key, seed, info };
  if (scenario.options.history_toggle) req.history = history;
  if (scenario.upbringing && scenario.options.skip_upbringing) req.skip_upbringing = skipUpbringing;
  if (hero === CUSTOM_HERO) {
    req.template = template;
    req.captain = { name: custom.name.trim(), look: custom.look, gender: custom.gender, birthday: [custom.month, custom.day] };
  } else if (hero) {
    req.protagonist = hero;
  }
  return req;
}

/** 世界日历里某月的天数（没有日历时按 30 天）。 */
export function daysInMonth(months: number[] | undefined, month: number): number {
  return months?.[month - 1] ?? 30;
}

/** 名册格子里只写名（"莉芙·德克莱尔克"→"莉芙"）；没有间隔号的名字照写。 */
export function shortName(name: string): string {
  return name.split(/[·・]/)[0] || name;
}
