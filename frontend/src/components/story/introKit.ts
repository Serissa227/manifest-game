// 第十轮 U07F：养成开场的“人物介绍”（轨道键以 intro_ 开头的剧情，数据见 data/worlds/terra16/upbringing/families/mio_intro.toml）。
// 行动制的画面在时，这些剧情不走普通的剧情弹窗，改由 IntroScreen 整屏放：场景图压暗做底、立绘在一侧、名牌与正文在另一侧。
// 这里放认法、名牌的切法、幕序（后端的故事 2.0 视图不给“第几章 / 共几章”，幕序照数据抄一份，只用来画小点与预取图）、
// 立绘的取法，以及介绍自己的界面状态（回应中 / 回话 / 跳过）。
import { create } from "zustand";
import type { StoryEventView } from "../../ipc/types";
import { figureOf } from "../../art/portraitCast";
import { knownAge } from "./personAges";

/** 介绍轨道的前缀。 */
export const INTRO_PREFIX = "intro_";

/** 剧情键（"轨道:章节"）或轨道键是不是介绍。 */
export function isIntroKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith(INTRO_PREFIX);
}

/** 待回应的这一件是不是介绍（按轨道键认；旧视图没有 track 时按 key 的前半认）。 */
export function isIntroEvent(p: Pick<StoryEventView, "key" | "track"> | null | undefined): boolean {
  if (!p) return false;
  return isIntroKey(p.track ?? p.key);
}

/** 这一件所在的介绍轨道与章节键。 */
export function introParts(p: Pick<StoryEventView, "key" | "track">): { track: string; chapter: string } {
  const at = p.key.indexOf(":");
  const track = p.track ?? (at >= 0 ? p.key.slice(0, at) : p.key);
  const chapter = at >= 0 ? p.key.slice(at + 1) : "";
  return { track, chapter };
}

/** 名牌：章节标题按第一个“ · ”切开，前半是名字，后半是身份（没有中点时整句当名字）。 */
export function splitNameplate(title: string): { name: string; role: string } {
  const at = title.indexOf(" · ");
  if (at < 0) return { name: title.trim(), role: "" };
  return { name: title.slice(0, at).trim(), role: title.slice(at + 3).trim() };
}

/** 一幕：章节键、场景键、站出来的人（没有人物卡的幕为 null）。只用来画小点与预取图，显示一律以后端视图为准。 */
export interface IntroBeat {
  chapter: string;
  art: string;
  cast: string | null;
}

/** 三组介绍的幕序（照 mio_intro.toml；数据改了幕序而这里没跟上时，认不出的幕不画小点，别的照常）。 */
export const INTRO_TRACKS: Readonly<Record<string, readonly IntroBeat[]>> = {
  intro_mio_home: [
    { chapter: "estuary", art: "roof_tosa", cast: null },
    { chapter: "mio", art: "dock_jp", cast: "mio" },
    { chapter: "ase", art: "boatshed_tosa", cast: "ase" },
    { chapter: "ushio", art: "home_tosa", cast: "ushio" },
    { chapter: "mother", art: "study_tosa", cast: "mio_mother" },
    { chapter: "kanesada", art: "garden_tosa", cast: "ichijo_kanesada" },
    { chapter: "paper", art: "home_tosa", cast: null },
  ],
  intro_mio_kyoto: [
    { chapter: "yasuko", art: "tsubone_kyoto", cast: "hirohashi_yasuko" },
    { chapter: "kineda", art: "library_kyoto", cast: "sanjonishi_kineda" },
    { chapter: "tokitsugu", art: "tsuboniwa_kyoto", cast: "yamashina_tokitsugu" },
    { chapter: "yuki", art: "temple_kyoto", cast: "reizei_yuki" },
    { chapter: "kogo", art: "incense_kyoto", cast: "kogo" },
    { chapter: "kikuchiyo", art: "kemari_jp", cast: "kikuchiyo" },
    { chapter: "ayame", art: "court_jp", cast: "ayame" },
  ],
  intro_mio_noshima: [
    { chapter: "bosun", art: "shed_noshima", cast: "c8_noshima_bosun" },
    { chapter: "takamaru", art: "berth_noshima", cast: "takamaru" },
    { chapter: "omatsu", art: "netyard_noshima", cast: null },
    { chapter: "ledger", art: "tidechest_noshima", cast: null },
  ],
};

/** 第几幕、共几幕（从 0 起；认不出时为 null）。 */
export function introPosition(p: Pick<StoryEventView, "key" | "track">): { index: number; total: number } | null {
  const { track, chapter } = introParts(p);
  const beats = INTRO_TRACKS[track];
  if (!beats) return null;
  const index = beats.findIndex((b) => b.chapter === chapter);
  return index < 0 ? null : { index, total: beats.length };
}

/**
 * 和澪同龄的人（家乡与学院的同窗）：取立绘时按世界年份推年纪（1553 年 12 岁上下），以后补了别的年纪的立绘自动换。
 * 长辈眼下每人一张，不传年纪（接口给最早的一张）。
 */
const PEERS: ReadonlySet<string> = new Set(["mio", "ushio", "chidori", "takamaru", "reizei_yuki", "ayame", "kogo", "kikuchiyo"]);
const PEER_BORN = 1541;

/**
 * 站出来的人的年纪（取立绘用）。FIX5F：先看人物视图给过的年纪（personAges.ts，人人都有生年的就有）；
 * 没有时同龄人按年份推，别的人为 undefined（立绘取最早的一张）。
 */
export function introAge(person: string, year: number | undefined): number | undefined {
  const known = knownAge(person, year);
  if (known !== undefined) return known;
  if (!PEERS.has(person) || year === undefined) return undefined;
  return Math.max(0, year - PEER_BORN);
}

/** 这一幕站出来的人：先看 figure（R10-FIX8：没有人物卡的人也能站出来），没有再取 cast 第一位；且有立绘。 */
export function introFigure(p: Pick<StoryEventView, "cast" | "figure">, year: number | undefined) {
  const person = p.figure?.key ?? p.cast?.[0]?.person;
  if (!person) return undefined;
  return figureOf(person, introAge(person, year));
}

/** 回应之后接着放的回话（有真选项的那一幕才有）。 */
export interface IntroReply {
  chose: string | null;
  text: string;
}

/** 介绍自己的界面状态。 */
interface IntroUi {
  /** 回应中或回话中：停在这一幕的画面上（回应期间、以及回话显示时，后端已经没有待回应的介绍了，画面照这一幕画，不露出底下） */
  hold: { p: StoryEventView; reply: IntroReply | null } | null;
  /** 正在“跳过介绍”：只有“继续”的幕依次自动答掉，停在有真选项的那一幕 */
  skipping: boolean;
}

export const useIntroUi = create<IntroUi>(() => ({ hold: null, skipping: false }));
