// 主角创建的小工具：姓名清理、随机姓名与外貌、剧本信息的整理。
// 随机只影响开局界面的默认值（姓名、外貌），与游戏世界无关；取值都由“第几次随机”确定性地算出。
import { npcName, npcNameEn, npcNameParts } from "../../art/names";
import {
  CAPTAIN_LOOK_IDS,
  CAPTAIN_PORTRAITS,
  captainLookAt,
  captainLookNumber,
  captainSpec,
  drawPortrait,
  wrapCaptainLook,
} from "../../art/portraits";
import type { Px } from "../../art/px";
import { memo } from "../../art/render";
import { hash32 } from "../../art/rng";
import { shipArtKey } from "../../art/ships";
import { currentLocale } from "../../i18n/locale";
import { locById } from "../../ipc/byId";
import type { Locale, ScenarioGoalView, ScenarioView, StaticView } from "../../ipc/types";

/** 主角姓名的最大字符数（与后端 handlers::CAPTAIN_NAME_MAX 一致）。 */
export const CAPTAIN_NAME_MAX = 12;

/** 去掉控制字符与不可见的格式字符（输入时即时过滤；后端同样会拒绝它们）。 */
export function stripControls(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

/** 提交用的姓名：去掉控制字符与首尾空白，最多 12 个字符；为空表示不合法。 */
export function cleanName(s: string): string {
  return Array.from(stripControls(s).trim()).slice(0, CAPTAIN_NAME_MAX).join("");
}

/** 外貌编号归一到普通外貌（0–11、13–24）：越界取模，空缺的 12 号归到 0 号（见 art/portraits.ts 的 wrapCaptainLook）。 */
export function wrapLook(i: number): number {
  return wrapCaptainLook(i);
}

/** 外貌是第几种（1–24，界面上的“外貌 n”）。 */
export function lookNumber(look: number): number {
  return captainLookNumber(look);
}

/** 从 look 起按界面上的顺序走 delta 种（◀ ▶ 用）：11 号的下一种是 13 号，13 号的上一种是 11 号，首尾相接。 */
export function stepLook(look: number, delta: number): number {
  return captainLookAt(captainLookNumber(look) + Math.trunc(delta));
}

/** 由随机数取一种外貌（开局界面的默认外貌）：24 种机会均等。 */
export function lookFromRoll(roll: number): number {
  return captainLookAt(Math.trunc(roll) + 1);
}

/** 该外貌是否为女性（决定随机姓名用男名还是女名）。 */
export function isFemaleLook(i: number): boolean {
  return captainSpec(wrapLook(i)).female;
}

/**
 * 第 roll 次随机得到的船长姓名（与外貌的性别相符，原创姓名表见 art/names.ts），按界面语言给中文或英文。
 * 中文与原来完全相同；英文取同一个种子的拉丁字母原形，超过 12 个字符（后端的上限）时依次换用 `captain-<roll>-<k>` 的种子，
 * 直到放得下（都放不下时只用名）。随机姓名只是开局界面的默认值，玩家输入什么就用什么。
 */
export function captainName(roll: number, female: boolean, locale: Locale = currentLocale()): string {
  if (locale !== "en") return npcName(`captain-${roll}`, female);
  for (let k = 0; k < 64; k++) {
    const name = npcNameEn(k === 0 ? `captain-${roll}` : `captain-${roll}-${k}`, female);
    if (Array.from(name).length <= CAPTAIN_NAME_MAX) return name;
  }
  return cleanName(npcNameParts(`captain-${roll}`, female).en.given);
}

/** 下一次随机姓名：跳过与当前相同的结果。 */
export function rollName(roll: number, current: string, female: boolean): { roll: number; name: string } {
  let r = roll;
  for (let i = 0; i < 24; i++) {
    r += 1;
    const name = captainName(r, female);
    if (name !== current) return { roll: r, name };
  }
  return { roll: r, name: captainName(r, female) };
}

/** 随机外貌：由 roll 决定，且一定不同于当前外貌（另外 23 种都可能抽到）。 */
export function rollLook(roll: number, current: number): number {
  const step = 1 + (hash32(`captain-look-${roll}`) % (CAPTAIN_PORTRAITS - 1));
  return stepLook(current, step);
}

/** 每次打开开局界面时的初始随机数（只决定默认姓名与外貌）。 */
export function freshRoll(): number {
  return hash32(`start-${Date.now()}`) % 100_000;
}

/** 主角头像（带缓存，同一外貌总是同一张图）。 */
export function captainPortrait(look: number): Px {
  const i = wrapLook(look);
  return memo(`start-captain-${i}`, () => drawPortrait(captainSpec(i)));
}

export { CAPTAIN_LOOK_IDS, CAPTAIN_PORTRAITS };

// ───────────────────────────── 剧本信息 ─────────────────────────────

/** 是不是“推荐选择”（带主角的剧本，数据里标了 recommended）。 */
export function isRecommended(s: ScenarioView): boolean {
  return !!s.recommended && !!s.hero;
}

/** 开局界面的缺省剧本：有推荐角色时是第一位推荐角色，否则是第一个剧本。 */
export function defaultScenario(statics: StaticView | null | undefined): string {
  const list = statics?.scenarios ?? [];
  return (list.find(isRecommended) ?? list[0])?.key ?? "";
}

/** 剧本目标：即后端的 ScenarioGoalView（保留旧名供剧本卡片引用）。 */
export type ScenarioGoal = ScenarioGoalView;

/** 剧本详情：即后端的 ScenarioView（起始港、资金、船队与目标；保留旧名供测试引用）。 */
export type ScenarioInfo = ScenarioView;

/** 剧本卡片需要的整理后信息。 */
export interface ScenarioFacts {
  port?: string;
  factionKey?: string;
  /** 势力数据的建筑风格（FactionView.style）；未写为 null */
  factionStyle?: string | null;
  flag?: string;
  /** 旗舰（第一艘船），剧本小景画它 */
  ship?: { type: number; sail: "square" | "lateen"; name: string; /** 船型 key（按 key 画小景） */ key: string };
  /** 全部起始船只的船型名（多艘时卡片上逐一列出） */
  shipNames?: string[];
  cash?: number;
  crew?: number;
  mates?: number;
  goal?: ScenarioGoal;
}

export function scenarioFacts(statics: StaticView, s: ScenarioView): ScenarioFacts {
  const info = s as ScenarioInfo;
  const loc = info.start !== undefined ? locById(statics, info.start) : undefined;
  const faction = loc ? statics.factions[loc.faction] : undefined;
  const shipId = info.ships?.[0];
  const shipType = shipId !== undefined ? statics.ships[shipId] : undefined;
  return {
    port: loc?.name,
    factionKey: faction?.key,
    factionStyle: faction?.style ?? null,
    flag: faction?.color,
    ship: shipType && shipId !== undefined ? { type: shipId, sail: shipType.sail, name: shipType.name, key: shipArtKey(statics.ships, shipId) } : undefined,
    shipNames: (info.ships ?? []).map((id) => statics.ships[id]?.name).filter((n): n is string => !!n),
    cash: info.cash,
    crew: info.crew,
    mates: info.mates,
    goal: info.goal,
  };
}
