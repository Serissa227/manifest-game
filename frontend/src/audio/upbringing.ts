// 养成篇的配乐（FRAMEWORK §7.9、§7.14，TERRA16 §17，UI-CONTRACT I5、I6）：主角在养成中（Overview.mode === "upbringing"）时放哪首曲子（纯函数）。
//
// 优先级从高到低（前面的一条成立就不看后面的）：
//   1. 有待回应的事件（Overview.story.pending）时按事件换曲：
//      种类 contest（比赛）→《擂台上的旗》；情绪 sad →《落雨的庭院》、tense →《暗涌》、mystic →《子夜的征兆》；
//      种类 letter（远方来信）→《远方的来信》、omen（秘术的征兆）→《子夜的征兆》；情绪 tender →《指尖的余温》；
//      情绪 cheerful：节日里放节日的曲子，平时不换；其余（世界新闻、请托……）不换，照下面的规矩放。
//   2. 结业（phase 为 graduation / done）放《各自的帆》；
//   3. 今天有比赛或正开着比赛的小游戏放《擂台上的旗》；
//   4. 今天是节日放节日的曲子：按文化区（养成视图的 culture），日本放《夏祭的囃子》、明放《上元灯市》，别的（或认不出）放《节日的街》；
//   5. 平时：在“平时的曲目池”里轮换（第九批 2026-11-02 起，原来一直放这个阶段的那一首）。曲目池按顺序是——
//      a. 这个阶段的曲子：家乡期《晨光里的家》；学院期放这所学院的短主题（十所学院各一段，按学院的 key 认，认不出时按主角认，
//         自创主角的学院放《学院的回廊》；养成视图里没有学院时放《课业与钟声》）；
//      b. 主角家乡的曲子（hometownTrack）：九位主角按主角的 key 认各自的“家乡的日常”（伊比利亚、低地、马格里布、海湾、
//         斯瓦希里、玛雅、明、日本、摩鹿加），自创主角按 culture 认；还没有家乡曲的文化先借同一文化的港口曲；认不出时没有这一首；
//      c. 通用的平时曲：《灯下的功课》《傍晚回家的路》《海边的风》；
//      d. 出海以后会听到的曲子：这一阶段所在城市的港口曲、
//         它外面那片海的航海曲，再加一首远洋的《晨星洋》（voyageTracksOf；养成视图给了所在城市、认得出时才有）；
//      e. 主页面的曲子：《船货清单》。
//      轮换的规矩（状态与随机源在配乐导演 director.ts 里，这里只给纯函数，随机源由调用方注入、测试里固定种子）：
//      - 刚进养成（或换了阶段）先放这个阶段的曲子，其余的洗成一副牌依次放；一副放完再洗一副，新的一副第一张不会是刚放完的那首，
//        所以同一首不会连着放两遍；
//      - 一首放完一遍、进了留白（ROTATE_REST_S 秒）才换下一首；放得不满 ROTATE_MIN_S 秒（学院的短主题）时再奏一遍；
//      - 事件、比赛、节日、结业的曲子照旧优先：它们放的时候轮换停着不走，回到平时接着放轮到的那一首。
//      - 曲目池变了（认出了家乡、养成视图暂时收回……）时，正在轮到的那一首还在池里就接着放，否则从池的第一首重新开始；
//        阶段变了（家乡期 → 学院期）一律从新阶段的曲子重新开始。
// 事件的曲子与比赛的小游戏立即切换（对话框一弹出就换），回到平时的曲子照防频繁切换的规矩；轮换换下一首时不等（一首刚放完，正是换的时候）。
//
// 养成视图（UpbringingView）不在全局状态里，由养成主画面每次取到时发布一份摘要（publishUpbringing）；还没有摘要时接着放轮换轮到的那一首，
// 还没有轮换时按家乡期。养成视图的 culture：学院期是学院的文化区，家乡期是家乡所在地点的文化（粗分的风格名，如 mediterranean、desert）。
// 故事 2.0 的事件字段（mood、新的 kind）类型里是字符串（数据给的），这里只认得五种情绪，认不出就当没有。
import { create } from "zustand";
import type { Overview, StaticView, UpbringingView } from "../ipc/types";
import type { ScenePool } from "./pools";
import type { TrackId } from "./tracks";
import { portPoolIn, portTrackIn, seaPoolOf, seaTrackOf } from "./zones";

/** 养成主画面给配乐的摘要。 */
export interface UbMusicDigest {
  stage: "home" | "academy";
  phase: UpbringingView["phase"];
  /** 今天是节日（日历上今天有 festival） */
  festival: boolean;
  /** 今天有比赛（日历上今天有 contest，或比赛表里今天开赛、还没比完的） */
  contestDay: boolean;
  /** 比赛的小游戏正开着 */
  contestOpen: boolean;
  /** 学院的 key（UpbringingView.academy.key；家乡期或没有学院时为 null） */
  academy?: string | null;
  /** 主角的 key（UpbringingView.protagonist.key） */
  protagonist?: string | null;
  /**
   * 文化区（第二阶段·东亚宫廷）：节日的曲子按它选（festivalTrack）。养成视图给了 culture 字段才有；
   * 没有或认不出时节日照旧放《节日的街》——现在的后端还不给这个字段，行为与原来一样。
   */
  culture?: string | null;
  /**
   * 出海以后在这一带会听到的曲子（voyageTracksOf：所在城市的港口曲、外面那片海的航海曲、远洋的一首），平时的轮换里也放。
   * 养成视图没给所在城市、或静态数据里认不出它时没有这一项——曲目池与原来一样。
   */
  voyage?: readonly TrackId[];
  /**
   * 季节（第九批 A01，2026-11-11）：按养成视图的当天（today 的月份）算，平时的轮换里放这个季节的那一首（seasonTrack）。
   * 直接手写的摘要（旧的调用、测试）没有这一项，曲目池与原来一样。
   */
  season?: UbSeason;
  /**
   * 出海以后在这一带还会轮到的曲子（voyageMoreOf：所在城市的港口曲、外面那片海的航海曲各自的曲目池里别的几首），平时的轮换里也放。
   * 没有时不写进摘要。
   */
  voyageMore?: readonly TrackId[];
}

/** 季节：春（三到五月）、夏（六到八月）、秋（九到十一月）、冬（十二月到二月）。 */
export type UbSeason = "spring" | "summer" | "autumn" | "winter";

/** 月份（1–12）→ 季节；不是 1–12 的整数时为 null。 */
export function seasonOfMonth(month: unknown): UbSeason | null {
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** 四季的平时曲：《新叶》《长昼》《晒场上的风》《长夜的灯》。 */
export const UB_SEASON_TRACKS: Readonly<Record<UbSeason, TrackId>> = {
  spring: "ub_spring",
  summer: "ub_summer",
  autumn: "ub_autumn",
  winter: "ub_winter",
};

export const useUbMusic = create<{ digest: UbMusicDigest | null }>(() => ({ digest: null }));

/** 世界日历的同一天。 */
function sameDay(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** 养成视图里配乐要看的部分。 */
export type UbMusicSource = Pick<UpbringingView, "stage" | "phase" | "calendar" | "today"> &
  Partial<Pick<UpbringingView, "contests">> & {
    academy?: { key: string } | null;
    protagonist?: { key: string } | null;
    culture?: string | null;
    town?: { key: string } | null;
  };

/** 远洋的航海曲《晨星洋》：养成平时的轮换里也放一放（远处的海）。 */
export const UB_OCEAN_TRACK: TrackId = "ocean";

/**
 * 出海以后在这一带会听到的曲子（纯函数）：这一阶段所在城市（养成视图的 town：家乡期是家乡港，学院期是学院所在的城市）的港口曲、
 * 它外面那片海的航海曲（内陆城市没有海区，不算），再加远洋的《晨星洋》。选曲与出海以后完全同一套规矩（zones.ts）：
 * 港口曲按所属势力的风格与停泊处海区的 music，航海曲按海区的 music。静态数据里认不出这个地点时为空。
 */
export function voyageTracksOf(statics: StaticView | null | undefined, townKey: string | null | undefined): TrackId[] {
  if (!statics || !townKey) return [];
  const loc = statics.locations.find((l) => l.key === townKey);
  if (!loc || loc.kind === "site") return [];
  const out: TrackId[] = [];
  const faction = statics.factions[loc.faction];
  const region = typeof loc.region === "number" ? loc.region : null;
  const sea = region !== null ? statics.regions.find((r) => r.id === region) : undefined;
  out.push(portTrackIn(faction?.key, faction?.style, sea?.music));
  if (region !== null) {
    const track = seaTrackOf(region, { x: loc.x, y: loc.y }, statics);
    if (!out.includes(track)) out.push(track);
  }
  if (!out.includes(UB_OCEAN_TRACK)) out.push(UB_OCEAN_TRACK);
  return out;
}

/**
 * 这一带的曲目池里别的几首（纯函数，第九批 A01）：所在城市的港口曲的曲目池里最多再取一首，外面那片海的航海曲的曲目池里最多再取两首
 * （与出海以后同一套池，见 zones.ts），已经在 voyageTracksOf 里的不重复。认不出地点时为空。
 * 港口的池按白天的顺序取（不看时刻）：养成的平时不分早晚。
 */
export function voyageMoreOf(statics: StaticView | null | undefined, townKey: string | null | undefined): TrackId[] {
  const base = voyageTracksOf(statics, townKey);
  if (!statics || base.length === 0) return [];
  const loc = statics.locations.find((l) => l.key === townKey);
  if (!loc) return [];
  const faction = statics.factions[loc.faction];
  const region = typeof loc.region === "number" ? loc.region : null;
  const sea = region !== null ? statics.regions.find((r) => r.id === region) : undefined;
  const out: TrackId[] = [];
  const take = (tracks: readonly TrackId[], most: number) => {
    let n = 0;
    for (const id of tracks) {
      if (n >= most) break;
      if (base.includes(id) || out.includes(id)) continue;
      out.push(id);
      n++;
    }
  };
  take(portPoolIn(faction?.key, faction?.style, sea?.music).tracks, 1);
  if (region !== null) take(seaPoolOf(region, { x: loc.x, y: loc.y }, statics).tracks, 2);
  return out;
}

/**
 * 由养成视图得出摘要。contestOpen：比赛的小游戏正开着；voyage：出海以后会听到的曲子（voyageTracksOf，没有时不写进摘要）；
 * voyageMore：这一带的曲目池里别的几首（voyageMoreOf，没有时不写进摘要）。季节按 today 的月份算（认不出时不写）。
 */
export function digestOf(view: UbMusicSource, contestOpen = false, voyage: readonly TrackId[] = [], voyageMore: readonly TrackId[] = []): UbMusicDigest {
  const today = view.calendar.filter((m) => m.days_left === 0);
  // 文化区只在养成视图给了（非空的字符串）时才写进摘要：没给时摘要与原来一模一样
  const culture = typeof view.culture === "string" && view.culture.trim() ? view.culture.trim() : null;
  const season = seasonOfMonth(Array.isArray(view.today) ? view.today[1] : null);
  return {
    stage: view.stage,
    phase: view.phase,
    festival: today.some((m) => m.kind === "festival"),
    contestDay: today.some((m) => m.kind === "contest") || (view.contests ?? []).some((c) => c.status !== "done" && sameDay(c.date, view.today)),
    contestOpen,
    academy: view.academy?.key ?? null,
    protagonist: view.protagonist?.key ?? null,
    ...(culture ? { culture } : {}),
    ...(voyage.length > 0 ? { voyage: [...voyage] } : {}),
    ...(season ? { season } : {}),
    ...(voyageMore.length > 0 ? { voyageMore: [...voyageMore] } : {}),
  };
}

function sameDigest(a: UbMusicDigest | null, b: UbMusicDigest | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.stage === b.stage &&
    a.phase === b.phase &&
    a.festival === b.festival &&
    a.contestDay === b.contestDay &&
    a.contestOpen === b.contestOpen &&
    (a.academy ?? null) === (b.academy ?? null) &&
    (a.protagonist ?? null) === (b.protagonist ?? null) &&
    (a.culture ?? null) === (b.culture ?? null) &&
    (a.voyage ?? []).join(",") === (b.voyage ?? []).join(",") &&
    (a.season ?? null) === (b.season ?? null) &&
    (a.voyageMore ?? []).join(",") === (b.voyageMore ?? []).join(",")
  );
}

/**
 * 养成主画面每次取到养成视图时调用（离开养成主画面时传 null）。摘要没变时不通知。
 * statics：静态数据（给了才认得出所在城市出海以后的曲子，见 voyageTracksOf）。
 */
export function publishUpbringing(view: UbMusicSource | null, contestOpen = false, statics: StaticView | null = null): void {
  const next = view ? digestOf(view, contestOpen, voyageTracksOf(statics, view.town?.key), voyageMoreOf(statics, view.town?.key)) : null;
  if (!sameDigest(useUbMusic.getState().digest, next)) useUbMusic.setState({ digest: next });
}

/** 事件的情绪（UI-CONTRACT I5）。 */
export type StoryMood = "cheerful" | "tender" | "tense" | "sad" | "mystic";

const MOODS: readonly string[] = ["cheerful", "tender", "tense", "sad", "mystic"];

/** 待回应事件的种类与情绪（认不出的情绪为 null）。 */
function pendingOf(overview: Overview): { kind: string | null; mood: StoryMood | null } | null {
  const ev = overview.story?.pending;
  if (!ev) return null;
  return {
    kind: typeof ev.kind === "string" ? ev.kind : null,
    mood: typeof ev.mood === "string" && MOODS.includes(ev.mood) ? (ev.mood as StoryMood) : null,
  };
}

/**
 * 十所学院的短主题：学院的 key 里认得出的词（学院的数据还在写，key 没定，先收常见的写法）与对应的主角 key（TERRA16 §17.2）。
 * 学院的 key 认不出时按主角认（九位主角各有固定的学院）；都认不出（自创主角的学院）时放《学院的回廊》。
 */
export const ACADEMY_THEMES: readonly { track: TrackId; words: readonly string[]; protagonist: string }[] = [
  { track: "ac_kyoto", words: ["kyoto", "dairi", "kinri", "ichijo", "hokyo"], protagonist: "mio" },
  { track: "ac_antwerp", words: ["antwerp", "laurel", "lauwer", "heyns"], protagonist: "lieve" },
  { track: "ac_ship", words: ["shipboard", "ship_school", "pilot_school", "zabid", "muallim"], protagonist: "najma" },
  { track: "ac_zhangzhou", words: ["zhangzhou", "longxi", "shexue"], protagonist: "lin_wandeng" },
  { track: "ac_merida", words: ["merida", "franciscan"], protagonist: "ix_nikte" },
  { track: "ac_seville", words: ["tarifa", "marques", "marquis"], protagonist: "noel" },
  { track: "ac_fez", words: ["fez", "fes_", "qarawiyyin", "qarawiyin", "karaouine"], protagonist: "tariq" },
  { track: "ac_giri", words: ["giri", "gresik"], protagonist: "kaicili" },
  { track: "ac_azhar", words: ["azhar", "cairo", "jabarti"], protagonist: "baraka" },
];

/** 学院期的曲子：这所学院的短主题；摘要里没有学院时为《课业与钟声》。 */
export function academyTheme(digest: Pick<UbMusicDigest, "academy" | "protagonist">): TrackId {
  const key = (digest.academy ?? "").toLowerCase();
  if (!key) return "ub_academy";
  const byKey = ACADEMY_THEMES.find((t) => t.words.some((w) => key.includes(w)));
  if (byKey) return byKey.track;
  const who = digest.protagonist ?? "";
  return ACADEMY_THEMES.find((t) => t.protagonist === who)?.track ?? "ac_generic";
}

/**
 * 各文化区的节日曲（第二阶段·东亚宫廷）：文化区名（几种常见的写法，不区分大小写）→ 曲目。
 * 日本的祭放《夏祭的囃子》，明（中国）的元宵灯市放《上元灯市》；表里没有的文化区照旧放《节日的街》。
 */
export const FESTIVAL_CULTURE_TRACK: Readonly<Record<string, TrackId>> = {
  japan: "ub_matsuri",
  japanese: "ub_matsuri",
  ming: "ub_lantern",
  china: "ub_lantern",
  chinese: "ub_lantern",
};

/** 节日的曲子：摘要里有认得的文化区时放这个文化区的节日曲，没有（或认不出）时放《节日的街》（原来的行为）。 */
export function festivalTrack(culture: string | null | undefined): TrackId {
  if (typeof culture !== "string") return "ub_festival";
  const key = culture.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.prototype.hasOwnProperty.call(FESTIVAL_CULTURE_TRACK, key) ? FESTIVAL_CULTURE_TRACK[key] : "ub_festival";
}

/** 文化区名的写法统一：小写，空格与连字符换成下划线。 */
function cultureKey(culture: string | null | undefined): string {
  return typeof culture === "string" ? culture.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

/**
 * 九位主角家乡的曲子（“家乡的日常”）：主角的 key（TERRA16 §17.2 的九位主角）与文化区名（自创主角按养成视图的 culture 认，几种常见的写法）。
 * 粗分的风格名 mediterranean（塞维利亚、里斯本，也有威尼斯）、desert（尤尔法，也有非斯）、ottoman（阿尔及尔，也有伊斯坦布尔）
 * 一个名字盖着好几种文化，不收；九位主角按 key 认，不受影响。
 */
export const HOMETOWNS: readonly { track: TrackId; protagonist: string; cultures: readonly string[] }[] = [
  { track: "ub_home_iberia", protagonist: "noel", cultures: ["iberian", "iberia", "spanish", "portuguese", "castilian", "andalusian", "basque"] },
  { track: "ub_home_lowlands", protagonist: "lieve", cultures: ["lowland", "lowlands", "low_countries", "flemish", "dutch", "netherlandish"] },
  { track: "ub_home_maghreb", protagonist: "tariq", cultures: ["maghreb", "maghrebi", "north_african", "moroccan", "andalusi", "ottoman_maghreb"] },
  { track: "ub_home_gulf", protagonist: "najma", cultures: ["arabian", "arab", "arabia", "arabic", "gulf", "omani", "yemeni"] },
  { track: "ub_home_swahili", protagonist: "baraka", cultures: ["swahili", "east_african"] },
  { track: "ub_home_maya", protagonist: "ix_nikte", cultures: ["maya", "mayan", "yucatec", "mesoamerican"] },
  { track: "ub_home_ming", protagonist: "lin_wandeng", cultures: ["ming", "china", "chinese", "minnan", "hokkien"] },
  { track: "ub_home_japan", protagonist: "mio", cultures: ["japan", "japanese"] },
  { track: "ub_home_moluccas", protagonist: "kaicili", cultures: ["malay", "moluccan", "southeast_asian", "nusantara", "javanese"] },
];

/**
 * 还没有自己的家乡曲的文化区（自创主角的家乡：釜山、那霸、坎贝、钦查、伊斯坦布尔、吕贝克、威尼斯……）：先借同一文化的港口曲当家乡曲。
 * 以后写了这些文化的家乡曲，在 HOMETOWNS 里加一行、从这里拿掉即可。
 */
export const HOMETOWN_PORT_FALLBACK: Readonly<Record<string, TrackId>> = {
  korean: "port_korea",
  ryukyuan: "port_ryukyu",
  ryukyu: "port_ryukyu",
  indian: "port_india",
  andean: "port_andes",
  italian: "port_italy",
  venetian: "port_italy",
  northern: "port_hansa",
  nordic: "port_hansa",
  hanseatic: "port_hansa",
  // 奥斯曼：自创主角里只有伊斯坦布尔的造船世家写它（塔里克的阿尔及尔也写 ottoman，但他按主角的 key 先认成马格里布）
  ottoman: "port_ottoman",
  turkish: "port_ottoman",
};

/** 主角家乡的曲子：先按主角的 key（九位主角），再按文化区；都认不出时为 null（曲目池里就没有家乡曲）。 */
export function hometownTrack(digest: Pick<UbMusicDigest, "protagonist" | "culture">): TrackId | null {
  const who = digest.protagonist ?? "";
  const byWho = HOMETOWNS.find((h) => h.protagonist === who);
  if (byWho) return byWho.track;
  const key = cultureKey(digest.culture);
  if (!key) return null;
  const byCulture = HOMETOWNS.find((h) => h.cultures.includes(key));
  if (byCulture) return byCulture.track;
  return Object.prototype.hasOwnProperty.call(HOMETOWN_PORT_FALLBACK, key) ? HOMETOWN_PORT_FALLBACK[key] : null;
}

/** 通用的平时曲（不分文化）：《灯下的功课》《傍晚回家的路》《海边的风》。 */
export const UB_EVERYDAY: readonly TrackId[] = ["ub_study", "ub_dusk", "ub_breeze"];

/** 主页面（开局画面）的曲子《船货清单》：养成的平时也轮到它。 */
export const UB_TITLE_TRACK: TrackId = "title";

/** 这个阶段的曲子：家乡期《晨光里的家》，学院期这所学院的短主题。 */
export function stageTrack(digest: UbMusicDigest | null): TrackId {
  return digest?.stage === "academy" ? academyTheme(digest) : "ub_home";
}

/**
 * 平时的曲目池（纯函数）：这个阶段的曲子打头，然后是家乡曲（认得出时）、通用的平时曲、出海以后会听到的曲子（摘要里有时）、
 * 主页面的曲子，不重复。
 */
export function everydayPool(digest: UbMusicDigest | null): TrackId[] {
  const home = digest ? hometownTrack(digest) : null;
  const season = digest?.season ? UB_SEASON_TRACKS[digest.season] : null;
  const out: TrackId[] = [];
  const all = [stageTrack(digest), ...(home ? [home] : []), ...UB_EVERYDAY, ...(season ? [season] : []), ...(digest?.voyage ?? []), ...(digest?.voyageMore ?? []), UB_TITLE_TRACK];
  for (const id of all) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * 养成的事件、比赛的曲目池（第九批 A01；轮换的规矩见 pools.ts：一件事从头到尾同一首，下一件同样情绪的事换另一首）：
 * 心动《指尖的余温》《并肩的归途》、悲伤《落雨的庭院》《熄灯以后》、紧张《暗涌》《巷子里的脚步》、比赛《擂台上的旗》《决胜局》。
 */
export const UB_EVENT_POOLS: Readonly<Partial<Record<TrackId, readonly TrackId[]>>> = {
  ub_heart: ["ub_heart", "ub_heart_walk"],
  ub_sad: ["ub_sad", "ub_lamp_out"],
  ub_tense: ["ub_tense", "ub_footsteps"],
  ub_contest: ["ub_contest", "ub_final"],
};

/** 养成中这首曲子（upbringingScene 的结果）的曲目池；不在 UB_EVENT_POOLS 里的（平时的轮换、节日、结业……）为 null。 */
export function ubPoolOf(track: TrackId): ScenePool | null {
  const tracks = UB_EVENT_POOLS[track];
  return tracks ? { primary: track, tracks, kind: "event" } : null;
}

/** 平时的轮换（状态在配乐导演里，这里只有纯函数）。 */
export interface UbRotation {
  /** 曲目池（第一首是这个阶段的曲子） */
  pool: readonly TrackId[];
  /** 正在轮到的这一首 */
  current: TrackId;
  /** 接下来的顺序（洗好的一副牌，不含 current）；池里不止一首时总不为空 */
  queue: readonly TrackId[];
}

/** 洗牌（Fisher–Yates）：rand 返回 [0, 1)。 */
function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 开始一轮：先放 first（缺省是池的第一首，这个阶段的曲子），其余洗成一副牌。 */
export function startRotation(pool: readonly TrackId[], rand: () => number, first: TrackId = pool[0]): UbRotation {
  return { pool: [...pool], current: first, queue: shuffled(pool.filter((id) => id !== first), rand) };
}

/** 轮到下一首：从牌里取第一张；牌用完了就把除了这一首以外的再洗一副（所以不会连着放同一首）。池里只有一首时不动。 */
export function nextRotation(rot: UbRotation, rand: () => number): UbRotation {
  const others = rot.pool.filter((id) => id !== rot.current);
  if (others.length === 0) return rot;
  const queue = rot.queue.filter((id) => id !== rot.current && rot.pool.includes(id));
  const deck = queue.length > 0 ? queue : shuffled(others, rand);
  const current = deck[0];
  const rest = deck.slice(1);
  return { pool: rot.pool, current, queue: rest.length > 0 ? rest : shuffled(rot.pool.filter((id) => id !== current), rand) };
}

/**
 * 按最新的曲目池更新轮换（纯函数）：还没有轮换时开始一轮；池没变时照旧；池的第一首（这个阶段的曲子）变了时从它重新开始；
 * 只是多了、少了几首时，正在轮到的这一首还在池里就接着放（其余重新洗牌），否则从池的第一首重新开始。
 */
export function syncRotation(rot: UbRotation | null, pool: readonly TrackId[], rand: () => number): UbRotation {
  if (!rot || pool.length === 0) return startRotation(pool, rand);
  if (rot.pool.length === pool.length && rot.pool.every((id, i) => id === pool[i])) return rot;
  if (rot.pool[0] !== pool[0] || !pool.includes(rot.current)) return startRotation(pool, rand);
  return startRotation(pool, rand, rot.current);
}

/** 接下来轮到的那一首（后台先取它的采样）；池里只有一首时为 null。 */
export function peekRotation(rot: UbRotation | null): TrackId | null {
  return rot?.queue[0] ?? null;
}

/** 一首放完一遍、进了留白这么久（秒）才换下一首：让最后一个音的余音散掉。 */
export const ROTATE_REST_S = 3;
/** 轮到的这一首至少放这么久（秒，从它开始放算）才换：学院的短主题（二三十秒）会再奏一遍。 */
export const ROTATE_MIN_S = 60;

/**
 * 轮换该不该换下一首（纯函数，测试检查）：正在放的就是轮到的这一首，它这一遍奏完、在留白里停了 ROTATE_REST_S 秒，
 * 并且从 since（开始放它的时刻，音频时间）起已经放了 ROTATE_MIN_S 秒。
 */
export function rotationDue(playing: { track: string | null; rested: number }, current: TrackId, since: number, now: number): boolean {
  return playing.track === current && playing.rested >= ROTATE_REST_S && now - since >= ROTATE_MIN_S;
}

/**
 * 平时（没有事件）的曲子。rot：配乐导演里的轮换（没给时放这个阶段的曲子，与轮换之前一样）。
 * 结业、比赛、节日优先于轮换；还没有摘要时接着放轮换轮到的那一首，还没有轮换时按家乡期。
 */
export function upbringingBase(digest: UbMusicDigest | null, rot: UbRotation | null = null): TrackId {
  if (!digest) return rot?.current ?? "ub_home";
  if (digest.phase === "graduation" || digest.phase === "done") return "ub_graduation";
  if (digest.contestOpen || digest.contestDay) return "ub_contest";
  if (digest.festival) return festivalTrack(digest.culture);
  const pool = everydayPool(digest);
  return rot && pool.includes(rot.current) ? rot.current : pool[0];
}

/** 事件换到的曲子；这个事件不换曲时为 null。 */
export function eventTrack(overview: Overview, digest: UbMusicDigest | null): TrackId | null {
  const ev = pendingOf(overview);
  if (!ev) return null;
  if (ev.kind === "contest") return "ub_contest";
  if (ev.mood === "sad") return "ub_sad";
  if (ev.mood === "tense") return "ub_tense";
  if (ev.mood === "mystic") return "ub_mystic";
  if (ev.kind === "letter") return "ub_letter";
  if (ev.kind === "omen") return "ub_mystic";
  if (ev.mood === "tender") return "ub_heart";
  if (ev.mood === "cheerful" && digest?.festival) return festivalTrack(digest.culture);
  return null;
}

/** 养成中的曲子；urgent 为真时立即切换（事件、比赛的小游戏）。rot：平时的轮换（见 upbringingBase）。 */
export function upbringingScene(overview: Overview, digest: UbMusicDigest | null, rot: UbRotation | null = null): { track: TrackId; urgent: boolean } {
  const base = upbringingBase(digest, rot);
  const ev = eventTrack(overview, digest);
  if (ev) return { track: ev, urgent: ev !== base };
  return { track: base, urgent: !!digest?.contestOpen && base === "ub_contest" };
}

/** 事件可能换到的曲子：养成中先在后台加载它们的采样，事件弹出时不用等。 */
export const UB_EVENT_TRACKS: readonly TrackId[] = ["ub_heart", "ub_tense", "ub_sad", "ub_mystic", "ub_letter", "ub_contest"];
