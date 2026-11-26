// 人物：64×64 半身头像（航海士、设施掌柜、主角、海盗……）与街上行走的小人。
// 界面默认显示 AI 生成的时代肖像（清单 portraitAssets.ts、映射 portraitCast.ts、组件 components/portrait/）；
// 这里程序生成的头像是缺图时的回退，行人小人照旧用它。海盗的性别与名字仍由这里的参数决定（肖像取同性别的一位）；
// 掌柜反过来，先选肖像、再按肖像的性别画回退头像与起名（见 portraitCast.keeperCast）。
// 接口由界面代码依赖（函数签名保持不变）；画法在 ./people/ 下：
//   spec.ts 参数与生成规则、head.ts 头模与五官、hair.ts 发型、hats.ts 帽饰、outfit.ts 服饰、
//   compose.ts 合成、walker.ts 行人、tones.ts 用色。
// 返回的图经过 memo 缓存、被多处共享：调用方不要修改它，需要改时先 clone()。
import type { Facility } from "../store/game";
import { styleOf, type ArchStyle } from "./buildings";
import { npcNamePair } from "./names";
import { renderPortrait } from "./people/compose";
import { CAPTAIN_LOOK_IDS, CAPTAIN_LOOKS } from "./people/captains";
import { HAIR_BANGS, bangsFor, keeperFallback, keeperVariant, lookalike, makeSpec, withoutHairpin, type Age, type BangStyle, type NpcRole, type PortraitSpec } from "./people/spec";
import { idlePose, renderWalker, walkPose } from "./people/walker";
import type { Px } from "./px";
import { memo } from "./render";
import { byId } from "../ipc/byId";

export type { NpcRole, PortraitSpec } from "./people/spec";

/**
 * 由种子生成头像参数：同一个种子（与相同选项）永远得到同一张脸。
 * region 为文化风味（地中海羽饰帽与褶领、北地毛皮、低地白领与高顶帽、沙漠缠头与面纱、群岛花环、东方长袍与发冠、
 * 开拓者的软宽檐帽与皮外套），age 可强制年龄段（0 青年 1 中年 2 老年）。约 8% 的人物带精灵血统（尖耳）。
 */
export function portraitSpec(
  seed: string | number,
  role: NpcRole,
  opts: { female?: boolean; region?: ArchStyle; age?: Age; elf?: boolean } = {},
): PortraitSpec {
  return makeSpec(seed, role, opts);
}

/** 会把头发整个盖住的帽子：小传写明发色时换成不遮头发的打扮。 */
const COVERING: readonly PortraitSpec["hat"][] = ["turban", "hood", "bandana", "kerchief", "fur", "beanie", "scholar", "official", "veil", "lacecap", "mantilla"];

function showHair(s: PortraitSpec): void {
  if (COVERING.includes(s.hat)) s.hat = "headband";
  if (s.hair === "bald") s.hair = s.female ? "straight" : "crop";
}

/**
 * 小传里的外貌线索：眼镜、眼罩、发色、年纪、肤色、斗篷、伤疤、烟斗、眼睛颜色、发辫与盘发（发髻）、胡须与八字胡、头巾、鬓边的花、
 * 卷发、齐刘海与中分、鬓角花白，以及精灵血统（精灵、精裔、尖耳）。按顺序套用，后面的线索可以改写前面的结果。
 */
const BIO_HINTS: readonly (readonly [RegExp, (s: PortraitSpec) => void])[] = [
  [/眼镜/, (s) => (s.glasses = true)],
  [/(眼|目).{0,3}(蒙|罩|黑布)|独眼/, (s) => ((s.eyepatch = true), (s.glasses = false))],
  [/红发|赤发/, (s) => ((s.hairColor = "auburn"), showHair(s))],
  [/金发|金色的?头发|浅金/, (s) => ((s.hairColor = "blond"), showHair(s))],
  [/白发|银发/, (s) => ((s.hairColor = "white"), showHair(s))],
  // “老舵手、老渔夫”是老人；“老师傅、老板、老练”说的是别人或本事，不算
  [/老(?![师板家练友实道大是爷])|年迈|花白|皱纹/, (s) => ((s.age = 2), (s.hairColor = s.hairColor === "white" ? "white" : "gray"))],
  [/古铜|黝黑|晒/, (s) => (s.skin = Math.max(s.skin, 2))],
  [/深色(的)?皮肤|黑皮肤/, (s) => (s.skin = Math.max(s.skin, 3))],
  [/斗篷/, (s) => (s.hat = "hood")],
  [/灰.{0,2}斗篷/, (s) => (s.hatColor = "iron")],
  [/千金|小姐/, (s) => (s.age = 0)],
  [/伤疤|刀疤/, (s) => (s.scar = true)],
  [/烟斗/, (s) => (s.pipe = true)],
  [/精灵|精裔|尖耳|尖的耳朵/, (s) => (s.elf = true)],
  [/灰(色的?)?眼/, (s) => (s.eyeColor = 4)],
  [/碧眼|绿(色的?)?眼/, (s) => (s.eyeColor = 3)],
  [/蓝(色的?)?眼/, (s) => (s.eyeColor = 2)],
  [/辫/, (s) => (s.hair = s.female ? (s.hair === "sidebraid" || s.hair === "crownbraid" ? s.hair : "braids") : "braid")],
  // “挽成短髻”“盘成高髻”也是盘发（发髻、短髻、高髻都认）
  [/盘得|盘着|盘起|髻/, (s) => (s.hair = s.female ? (s.hair === "updo" ? "updo" : "bun") : "topknot")],
  [/胡子|胡须|络腮|短须|长须/, (s) => (s.beard = s.female ? "none" : s.beard === "none" || s.beard === "stubble" ? "full" : s.beard)],
  [/胡须修剪|修剪整齐的胡/, (s) => (s.beard = s.female ? "none" : "goatee")],
  // 只留唇上的胡子：“两撇八字胡”“唇上留一抹细须”
  [/八字胡|唇上.{0,4}须/, (s) => (s.beard = s.female ? "none" : "mustache")],
  [/头巾|缠头/, (s) => (s.hat = s.female ? "hood" : "turban")],
  [/鬓边.{0,4}花|插着一朵/, (s) => (s.hat = "flower")],
  // 发型与刘海：卷发配卷发刘海；齐刘海、中分在发型不允许时换成允许的长发
  [/卷发|卷曲的头发/, (s) => ((s.hair = s.female ? "curls" : "curly"), (s.bangs = "curly"), showHair(s))],
  [/齐刘海/, (s) => withBangs(s, "blunt")],
  [/中分(头|发|的|长发|短发)/, (s) => withBangs(s, "center")],
  [/鬓角花白|两鬓斑白|鬓发斑白/, (s) => ((s.age = s.age === 0 ? 1 : s.age), (s.grizzle = s.hairColor === "gray" || s.hairColor === "white" ? 0 : 1))],
];

/** 小传写明了刘海：发型允许就直接换，不允许就换成允许这种刘海的长发（女直发、男披肩长发）。 */
function withBangs(s: PortraitSpec, bangs: BangStyle): void {
  showHair(s);
  if (!HAIR_BANGS[s.hair].includes(bangs)) s.hair = s.female ? "straight" : HAIR_BANGS.long.includes(bangs) ? "long" : "crop";
  s.bangs = bangsFor(s.hair, bangs);
}

/**
 * 小传里的地名与文化词 → 出身文化（文化即该势力的建筑风格，与 styleOf 的势力映射一致）。
 * 旧地名、新的西幻地名（港口、城市）与国名都认得。小传里提到好几处地方时，取最先提到的一处——
 * 小传一般先交代出身（“瑶华丝商的女儿，十岁随宝船队来到梅尔蒙德”是瑶华人）。
 */
const BIO_REGIONS: readonly (readonly [RegExp, ArchStyle])[] = [
  [/赤砂|沙漠|驼|炎湾|沙门|卡迪尔|苏丹|绿洲|卡迪拉|巴布拉姆|哈拉湾|贾马尔|米兹拉|萨赫兰|努拉巴德/, "desert"],
  [/碧潮|群岛|珍珠|珊瑚|渔火|灯塔|马纳瓦|陶拉尼|阿卡科拉|莫蒂亚|阿希卡|拉玛塔|莫图侯/, "islands"],
  [/霜岭|冰泉|北望|松津|北方|雪湾|诺德海姆|北地|峡湾|伊斯布伦|法尔克维克|诺德瓦克特|斯内维克|维特海姆|富鲁堡|斯卡尔德/, "nordic"],
  [/金穗|麦浪|丰渡|鲸落|范德兰|低地|风车|赫伦丹|科伦费尔德|费尔哈文|瓦尔维克|梅尔蒙德|古尔登堡|莱克达尔|弗莱哈文|奥斯特瓦尔德/, "lowland"],
  [/翠岚|澄港|柳湾|石门|埃斯佩兰|维拉马雷|蒙特萨尔|卡斯特里昂|布鲁玛|塞雷尼萨|塔兰萨|诺瓦马尔|阿尔瓦兰/, "mediterranean"],
  [/瑶华|东方|琅京|云屿|朝岚/, "eastern"],
  [/新大陆|阿斯特里亚|殖民地|拓荒/, "frontier"],
];

// ── 英文小传（EXPANSION.md §12）：英文界面里后端给出英文小传，同样的外貌与出身线索用英文再认一遍，
//    让同一位航海士在两种语言下是同一张脸。顺序与上面的中文线索一致。
const BIO_HINTS_EN: readonly (readonly [RegExp, (s: PortraitSpec) => void])[] = [
  [/\b(glasses|spectacles)\b/i, (s) => (s.glasses = true)],
  [/\b(eye ?patch|one-eyed)\b|\bpatch over (his|her|one|the)( left| right)? eye\b/i, (s) => ((s.eyepatch = true), (s.glasses = false))],
  // “红发如火”在英文小传里常写成 hair as red as flame
  [/\b(red|auburn|flame|copper)(-red)?[- ]?(hair|haired)\b|\bhair as red as\b/i, (s) => ((s.hairColor = "auburn"), showHair(s))],
  // “浅金色的头发”：pale gold hair
  [/\bblonde?\b|\b(gold|pale gold|golden|fair)[- ]?(hair|haired)\b/i, (s) => ((s.hairColor = "blond"), showHair(s))],
  [/\b(white|silver)[- ]?(hair|haired)\b/i, (s) => ((s.hairColor = "white"), showHair(s))],
  // 与中文“老舵手、老渔夫”对应：只认“old + 人”的说法（old friend、old charts 说的不是年纪）
  [
    /\b(elderly|aged|grizzled|wrinkled|white-bearded|gr[ae]y-bearded)\b|\bold (man|woman|sailor|seaman|helmsman|hand|salt|captain|fisherman|pilot|navigator|sea ?dog|widow|veteran|shipwright|boatswain|bosun)\b/i,
    (s) => ((s.age = 2), (s.hairColor = s.hairColor === "white" ? "white" : "gray")),
  ],
  // “晒得黝黑”也写作 sun-darkened、burned dark by the sea wind
  [/\b(tanned|bronzed|sun-?bronzed|sunburnt|sunburned|weather-?beaten|sun-?browned|sun-?darkened)\b|\bburn(ed|t) dark\b/i, (s) => (s.skin = Math.max(s.skin, 2))],
  [/\bdark[- ]skinned\b|\bdark skin\b/i, (s) => (s.skin = Math.max(s.skin, 3))],
  [/\bcloak(ed|s)?\b/i, (s) => (s.hat = "hood")],
  [/\bgr[ae]y[- ]cloak/i, (s) => (s.hatColor = "iron")],
  [/\b(heiress|young lady|young mistress)\b/i, (s) => (s.age = 0)],
  [/\bscar(red|s)?\b/i, (s) => (s.scar = true)],
  [/\bpipe\b/i, (s) => (s.pipe = true)],
  [/\b(elf|elves|elven|elvish|elf-blooded|pointed ears)\b/i, (s) => (s.elf = true)],
  [/\bgr[ae]y[- ]eyed\b|\bgr[ae]y eyes\b/i, (s) => (s.eyeColor = 4)],
  [/\bgreen[- ]eyed\b|\bgreen eyes\b/i, (s) => (s.eyeColor = 3)],
  [/\bblue[- ]eyed\b|\bblue eyes\b/i, (s) => (s.eyeColor = 2)],
  [/\b(braid|braids|braided|plait|plaits|plaited)\b/i, (s) => (s.hair = s.female ? (s.hair === "sidebraid" || s.hair === "crownbraid" ? s.hair : "braids") : "braid")],
  // “头发总是盘得一丝不乱”：hair always pinned up（hair 与 pinned 之间可以隔一个词）
  [/\b(bun|topknot)\b|\bhair( \w+)? (pinned|piled|coiled) up\b/i, (s) => (s.hair = s.female ? (s.hair === "updo" ? "updo" : "bun") : "topknot")],
  [/\b(beard|bearded|whiskers)\b/i, (s) => (s.beard = s.female ? "none" : s.beard === "none" || s.beard === "stubble" ? "full" : s.beard)],
  [/\b(trimmed|neat|neatly trimmed) beard\b/i, (s) => (s.beard = s.female ? "none" : "goatee")],
  [/\b(mustaches?|moustaches?)\b/i, (s) => (s.beard = s.female ? "none" : "mustache")],
  [/\b(turban|headscarf|head ?wrap)\b/i, (s) => (s.hat = s.female ? "hood" : "turban")],
  // “鬓边插着一朵花”：flower in her hair / behind her ear / above her ear
  [/\bflower (in|behind|tucked|above|over)\b/i, (s) => (s.hat = "flower")],
  [/\b(curly|curls)\b/i, (s) => ((s.hair = s.female ? "curls" : "curly"), (s.bangs = "curly"), showHair(s))],
  [/\b(blunt|straight-cut) (bangs|fringe)\b/i, (s) => withBangs(s, "blunt")],
  [/\b(centre|center|middle)[- ]part(ed)?\b/i, (s) => withBangs(s, "center")],
  [/\bgr[ae]ying (at the )?temples\b|\bgr[ae]y(ing)? temples\b|\btemples (touched|streaked) with gr[ae]y\b/i, (s) => ((s.age = s.age === 0 ? 1 : s.age), (s.grizzle = s.hairColor === "gray" || s.hairColor === "white" ? 0 : 1))],
];

/** 英文小传里的文化词 → 出身文化（地名另由静态数据里的英文地名认出，见 mateLook）。 */
const BIO_REGIONS_EN: readonly (readonly [RegExp, ArchStyle])[] = [
  [/\b(desert|deserts|camel|camels|sultan|sultanate|oasis|dunes)\b/i, "desert"],
  [/\b(islands?|islanders?|archipelago|pearls?|coral|atolls?|lagoon)\b/i, "islands"],
  [/\b(north|northern|northlands?|fjords?|snowbound)\b/i, "nordic"],
  [/\b(lowlands?|windmills?|polders?|canals?)\b/i, "lowland"],
  [/\b(Yaohua|the East|eastern empire)\b/, "eastern"],
  [/\b(New World|Astria|colony|colonies|frontier|settlers?)\b/, "frontier"],
];

/** 在小传里找最先提到的一处，返回它的文化；没有提到时为 undefined。 */
function firstMention(bio: string, table: readonly (readonly [RegExp, ArchStyle])[]): { at: number; style: ArchStyle } | undefined {
  let best: { at: number; style: ArchStyle } | undefined;
  for (const [re, style] of table) {
    const m = re.exec(bio);
    if (m && (!best || m.index < best.at)) best = { at: m.index, style };
  }
  return best;
}

/** 小传里最先提到的出身文化；没有提到时为 undefined。places 为静态数据里的英文地名与势力名（英文小传用）。 */
function bioOrigin(bio: string, places: readonly (readonly [RegExp, ArchStyle])[] = []): ArchStyle | undefined {
  const zh = firstMention(bio, BIO_REGIONS);
  if (zh) return zh.style;
  return firstMention(bio, [...places, ...BIO_REGIONS_EN])?.style;
}

/** 小传里对航海士的称呼是女性：中文“她”，英文 she / her。 */
function femaleBio(bio: string): boolean {
  return bio.includes("她") || /\b(she|her|hers|herself)\b/i.test(bio);
}

/**
 * 航海士的头像参数：以姓名为种子；小传里用“她”（英文 she / her）称呼的航海士画成女性。
 * 小传里写到的外貌（眼镜、眼罩、红发、年老、古铜肤色、斗篷……）与出身会体现在头像上（中文与英文小传都认）。
 * region 为航海士所在港口势力的文化风格；小传里写明了出身时以小传为准（出身比所在港口更能决定打扮）。
 * 有小传的航海士是数据里写定的人物：只有小传提到精灵血统时才画尖耳，不随机。
 * 种子用英文正名（name_en，任何语言下都一样；缺失时用 name），切换语言不换脸。
 */
export function mateSpec(
  mate: { name: string; name_en?: string | null; bio?: string; key?: string },
  region?: ArchStyle,
  places: readonly (readonly [RegExp, ArchStyle])[] = [],
): PortraitSpec {
  const bio = mate.bio ?? "";
  const origin = bioOrigin(bio, places) ?? region;
  const seed = mate.name_en?.trim() || mate.name;
  const spec = portraitSpec(`mate-${seed}`, "mate", { female: femaleBio(bio), region: origin, elf: bio ? false : undefined });
  for (const [re, apply] of BIO_HINTS) if (re.test(bio)) apply(spec);
  for (const [re, apply] of BIO_HINTS_EN) if (re.test(bio)) apply(spec);
  return spec;
}

/** 能查到地点所属势力的静态数据（只用到这几个字段；势力可带 style 字段指定文化；英文正名用来认英文小传里的地名）。 */
export interface StyleSource {
  locations: readonly { id: number; faction: number; name_en?: string | null }[];
  factions: readonly { key: string; style?: string | null; name_en?: string | null }[];
}

/** 某地点所属势力的文化风格（给航海士头像用）；地点或势力未知时为 undefined。 */
export function styleAtLoc(statics: StyleSource | null | undefined, loc: number): ArchStyle | undefined {
  const faction = statics?.factions[byId(statics.locations, loc)?.faction ?? -1];
  return faction ? styleOf(faction.key, faction.style) : undefined;
}

const placeCache = new WeakMap<object, readonly (readonly [RegExp, ArchStyle])[]>();

/** 静态数据里的英文地名与势力名 → 文化（英文小传认出身用；只取拉丁字母写的名字，中文小传不受影响）。 */
export function englishPlaces(statics: StyleSource | null | undefined): readonly (readonly [RegExp, ArchStyle])[] {
  if (!statics) return [];
  const cached = placeCache.get(statics);
  if (cached) return cached;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: (readonly [RegExp, ArchStyle])[] = [];
  const add = (name: string | null | undefined, faction: { key: string; style?: string | null } | undefined) => {
    const n = name?.trim();
    if (!n || !faction || !/^[\x20-\x7e\u00c0-\u024f]+$/.test(n)) return;
    out.push([new RegExp(`\\b${esc(n)}\\b`), styleOf(faction.key, faction.style)]);
  };
  for (const l of statics.locations) add(l.name_en, statics.factions[l.faction]);
  for (const f of statics.factions) add(f.name_en, f);
  placeCache.set(statics, out);
  return out;
}

/**
 * 航海士头像：按所在港口的文化，小传写明出身时以小传为准（英文小传另按静态数据里的英文地名认出身）。
 */
export function mateLook(
  statics: (StyleSource & object) | null | undefined,
  mate: { name: string; name_en?: string | null; bio?: string; key?: string; at: number },
): PortraitSpec {
  return mateSpec(mate, styleAtLoc(statics, mate.at), englishPlaces(statics));
}

/** 主角可选的普通外貌数量：编号 0–11（第一批）与 13–24（英雄扩充），共 24 种（与后端 handlers::CAPTAIN_PORTRAITS 一致）。 */
export const CAPTAIN_PORTRAITS = 24;

/** 主角外貌编号的个数：0–24，含夹在中间、空缺的 12 号。越界的编号按它取模。 */
export const CAPTAIN_LOOK_SPAN = 25;

/** 空缺的外貌编号 12：不在普通外貌之列，归一时归到 0 号。 */
const VACANT_LOOK = 12;

/** 普通外貌的编号，按开局界面的排列顺序（第 n 种外貌是 CAPTAIN_LOOK_IDS[n - 1]）：0–11、13–24。 */
export { CAPTAIN_LOOK_IDS };

/** 是不是普通外貌的编号（0–11、13–24 的整数）。 */
export function isCaptainLook(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CAPTAIN_LOOK_SPAN && index !== VACANT_LOOK;
}

/** 外貌编号归一到普通外貌：越界按 CAPTAIN_LOOK_SPAN 取模（-1 是 24 号、25 是 0 号）；12 号不是普通外貌，归到 0 号。 */
export function wrapCaptainLook(index: number): number {
  const i = ((Math.trunc(index) % CAPTAIN_LOOK_SPAN) + CAPTAIN_LOOK_SPAN) % CAPTAIN_LOOK_SPAN;
  return i === VACANT_LOOK ? 0 : i;
}

/** 普通外貌是第几种（1–24，开局界面的“外貌 n”）：0–11 号是第 1–12 种，13–24 号正好是第 13–24 种。 */
export function captainLookNumber(index: number): number {
  return CAPTAIN_LOOK_IDS.indexOf(wrapCaptainLook(index)) + 1;
}

/** 第 n 种普通外貌（1–24，越界取模）的编号：captainLookNumber 的反函数。 */
export function captainLookAt(n: number): number {
  const k = CAPTAIN_LOOK_IDS.length;
  return CAPTAIN_LOOK_IDS[((((Math.trunc(n) - 1) % k) + k) % k)];
}

/** 编号为 index 的主角外貌（归一见 wrapCaptainLook）。编号为偶数的是男性、奇数的是女性。 */
export function captainSpec(index: number): PortraitSpec {
  const i = wrapCaptainLook(index);
  const base = portraitSpec(`captain-${i}`, "captain", { female: i % 2 === 1 });
  return { ...base, ...CAPTAIN_LOOKS[CAPTAIN_LOOK_IDS.indexOf(i)], seed: base.seed, role: "captain", female: i % 2 === 1 };
}

/** 港口的九种设施（与 store/game.ts 的 FACILITIES 顺序相同；美术模块不引入状态库）。 */
export const PORT_FACILITIES: readonly Facility[] = ["market", "shipyard", "tavern", "guild", "bank", "exchange", "warehouse", "invest", "office"];

/**
 * 同一港口九位掌柜的性别（true 为女性），按设施给出；没给的设施按种子决定（与原来一样）。
 * 界面按选中的肖像素材给出（见 portraitCast.keeperCast），名字与回退头像随之同性别。
 */
export type KeeperSexes = Readonly<Partial<Record<Facility, boolean>>>;

/**
 * 同一港口九位掌柜的头像参数（按设施顺序依次确定）：
 * 与前面任何一位在发型、发色、头饰、肤色、脸型五项里有三项以上相同（不同的不到三项）时，用掌柜专用的子序列重抽发色、脸型、发型，
 * 直到拉开为止；东方港的同款发簪只留给第一位戴它的掌柜，其余的人摘掉、别上自己的发饰。别的港口不受影响。
 * sexes 指定了性别的设施按指定的性别画（与种子本来的性别相同时参数完全不变），其余照旧。
 */
function portKeepers(locKey: string, region?: ArchStyle, sexes?: KeeperSexes): Map<Facility, PortraitSpec> {
  const mask = PORT_FACILITIES.map((f) => (sexes?.[f] === undefined ? "-" : sexes[f] ? "f" : "m")).join("");
  const key = `keepers:${locKey}:${region ?? ""}:${mask}`;
  const hit = keeperCache.get(key);
  if (hit) return hit;
  const out = new Map<Facility, PortraitSpec>();
  const done: PortraitSpec[] = [];
  let pinned = false;
  for (const f of PORT_FACILITIES) {
    const seed = `${locKey}-${f}`;
    let spec = portraitSpec(seed, f, { region, female: sexes?.[f] });
    if (spec.hat === "hairpin") {
      if (pinned) spec = withoutHairpin(spec, seed);
      pinned = true;
    }
    for (let attempt = 0; attempt < 12 && done.some((d) => lookalike(d, spec) >= 3); attempt++) spec = keeperVariant(spec, seed, attempt);
    if (done.some((d) => lookalike(d, spec) >= 3)) spec = keeperFallback(spec, done, seed);
    done.push(spec);
    out.set(f, spec);
  }
  keeperCache.set(key, out);
  return out;
}
const keeperCache = new Map<string, Map<Facility, PortraitSpec>>();

/**
 * 设施掌柜：以“港口 key-设施”为种子的头像参数与姓名（姓名性别与头像一致，名字按港口的文化起；同港的掌柜不撞脸）。
 * name 为中文音译，nameEn 为同一个名字的拉丁字母原形（EXPANSION.md §12.3，中文界面两行显示）。
 * sexes 为这个港口九位掌柜的性别（按选中的肖像素材，见 portraitCast.keeperCast）：给了就按它画、按它起名，
 * 名字仍以“港口 key-设施”为种子，所以性别没变的掌柜名字也不变；没给时性别由种子决定。
 */
export function keeperSpec(
  locKey: string,
  facility: Facility,
  region?: ArchStyle,
  sexes?: KeeperSexes,
  style?: string | null,
): { spec: PortraitSpec; name: string; nameEn: string } {
  const seed = `${locKey}-${facility}`;
  const spec = { ...(portKeepers(locKey, region, sexes).get(facility) ?? portraitSpec(seed, facility, { region, female: sexes?.[facility] })) };
  const pair = npcNamePair(seed, spec.female, region, style);
  return { spec, name: pair.zh, nameEn: pair.en };
}

function specKey(spec: PortraitSpec): string {
  return JSON.stringify(spec);
}

/** 64×64 头像（含背景）。 */
export function drawPortrait(spec: PortraitSpec): Px {
  return memo(`portrait:${specKey(spec)}`, () => renderPortrait(spec));
}

/** 主角外貌 index 的头像参数（同 captainSpec，越界按 CAPTAIN_LOOK_SPAN 取模）。 */
export function captainPortraitSpec(index: number): PortraitSpec {
  return captainSpec(index);
}

/** 主角外貌 index 的 64×64 头像。 */
export function drawCaptainPortrait(index: number): Px {
  return drawPortrait(captainPortraitSpec(index));
}

/** 行走动画的帧数。 */
export const WALK_FRAMES = 4;

/**
 * 街上行走的小人（约 10×18，画布固定 12×24，脚踩在 y=22（倒数第二行）；面朝右，需要朝左时由调用方水平翻转）。
 * frame 取模 WALK_FRAMES。
 */
export function drawWalker(spec: PortraitSpec, frame: number): Px {
  const f = ((Math.floor(frame) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
  return memo(`walker:${f}:${specKey(spec)}`, () => renderWalker(spec, walkPose(f)));
}

/** 站立的行人（与 drawWalker 同尺寸、同锚点）。 */
export function drawIdle(spec: PortraitSpec): Px {
  return memo(`walker:idle:${specKey(spec)}`, () => renderWalker(spec, idlePose()));
}
