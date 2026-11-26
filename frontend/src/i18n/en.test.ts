// 英文字符串表（EXPANSION.md §12）：与中文表逐模块一一对应（键、占位符），没有漏译的中文；
// 以及按语言格式化的数字、金额、日期、季节、纪年与查表占位符。
// 以后任何一方新增的键没有在另一方补上，这里的测试就会失败（tsc 的 Translation 类型也会报错）。
import { afterEach, describe, expect, it } from "vitest";
import { COLONY_NAME_MAX, suggestName } from "../components/colony/model";
import { statics } from "../test/fixtures";
import { EN_MODULES, en } from "./en";
import {
  currency,
  dateSeasonText,
  dateText,
  dayDate,
  eraName,
  listJoin,
  lookup,
  money,
  nameOf,
  num,
  otherName,
  setWorld,
  t,
  tk,
} from "./index";
import { detectLocale, setLocale, settingsLocale, useLocale } from "./locale";
import { MODULES, zhCN } from "./zh-CN";

/** 字符串里的占位符名（`{name}`、`{name:格式}` 都取 name），排序去重。 */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}:]+)(?::[^{}]+)?\}/g)].map((m) => m[1]))].sort();
}

/** 英文表里允许出现汉字的键：语言下拉的标签两种语言都写（看不懂当前语言的人也找得到）。 */
const CJK_ALLOWED = new Set(["stLanguage"]);

describe("英文字符串表：与中文一一对应", () => {
  afterEach(() => setLocale("zh-CN"));

  it("逐模块的键集合完全相同（任何一方多出或缺少的键都列出来）", () => {
    const zhMods = MODULES as unknown as Record<string, Record<string, string>>;
    const enMods = EN_MODULES as unknown as Record<string, Record<string, string>>;
    expect(Object.keys(enMods).sort()).toEqual(Object.keys(zhMods).sort());
    const problems: string[] = [];
    for (const mod of Object.keys(zhMods)) {
      const zh = new Set(Object.keys(zhMods[mod]));
      const enKeys = new Set(Object.keys(enMods[mod] ?? {}));
      for (const k of zh) if (!enKeys.has(k)) problems.push(`英文缺少 ${mod}.${k}`);
      for (const k of enKeys) if (!zh.has(k)) problems.push(`英文多出 ${mod}.${k}`);
    }
    expect(problems).toEqual([]);
    // 合并后的整表也一致
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("每个键的占位符集合相同（格式说明可以不同，例如英文日期用 {month:@month}）", () => {
    const zh = zhCN as Record<string, string>;
    const diff: string[] = [];
    for (const k of Object.keys(zh)) {
      const a = placeholders(zh[k]).join(",");
      const b = placeholders(en[k] ?? "").join(",");
      if (a !== b) diff.push(`${k}: 中文 {${a}} / 英文 {${b}}`);
    }
    expect(diff).toEqual([]);
  });

  it("英文没有漏译：不含汉字与全角标点，也不是空串", () => {
    const bad = Object.entries(en).filter(
      ([k, v]) => !CJK_ALLOWED.has(k) && (/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(v) || v.length === 0),
    );
    expect(bad).toEqual([]);
  });

  it("英文各模块之间没有重复的键", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [mod, table] of Object.entries(EN_MODULES)) {
      for (const key of Object.keys(table)) {
        const prev = seen.get(key);
        if (prev) dup.push(`${key}（${prev} 与 ${mod}）`);
        seen.set(key, mod);
      }
    }
    expect(dup).toEqual([]);
  });

  it("掌柜问候语：英文与中文的常规句、零值说法与专门一句一一对应", () => {
    const greet = (table: Readonly<Record<string, string>>) => Object.keys(table).filter((k) => k.startsWith("portGreet.")).sort();
    expect(greet(en)).toEqual(greet(zhCN));
  });

  it("按术语表翻译的关键词（EXPANSION.md §12.2）", () => {
    setLocale("en");
    expect(tk("port.market")).toBe("Market");
    expect(tk("port.shipyard")).toBe("Shipyard");
    expect(tk("port.tavern")).toBe("Tavern");
    expect(tk("port.guild")).toBe("Guild");
    expect(tk("port.bank")).toBe("Bank");
    expect(tk("port.exchange")).toBe("Exchange");
    expect(tk("port.warehouse")).toBe("Warehouse");
    expect(tk("port.invest")).toBe("Investment");
    expect(tk("port.office")).toBe("Office");
    expect(tk("tab.mates")).toBe("Mates");
    expect(tk("tab.fleet")).toBe("Fleet");
    expect(tk("tab.caravan")).toBe("Caravan");
    expect(tk("tab.industry")).toBe("Industry");
    expect(tk("tab.futures")).toBe("Futures");
    expect(tk("loc.port")).toBe("Port");
    expect(tk("loc.city")).toBe("Inland city");
    expect(t("pnFlagship")).toBe("Flagship fleet");
    expect(t("pnStatCrew")).toBe("Crew");
    expect(t("pnStatMorale")).toBe("Morale");
    expect(tk("explore.fame")).toBe("Fame");
    expect(t("ofReputation")).toBe("Reputation");
    expect(t("ofLicense")).toBe("License");
    expect(t("pnStDaylight")).toBe("Day–night lighting");
    expect(t("mapFog")).toBe("Unexplored waters");
    for (const [k, v] of [
      ["sky.clear", "Clear"],
      ["sky.cloudy", "Cloudy"],
      ["sky.rain", "Rain"],
      ["sky.fog", "Fog"],
      ["sky.storm", "Storm"],
      ["sky.snow", "Snow"],
      ["period.dawn", "Dawn"],
      ["period.dusk", "Dusk"],
      ["period.night", "Night"],
    ] as const) {
      expect(tk(k)).toBe(v);
    }
  });
});

describe("按语言取字与格式化", () => {
  afterEach(() => {
    setLocale("zh-CN");
    setWorld(statics.world);
  });

  it("测试环境默认中文；切到英文后 t / tk 取英文，缺键回退中文，两边都没有时返回键名", () => {
    expect(useLocale.getState().locale).toBe("zh-CN");
    expect(t("topCash")).toBe("现金");
    setLocale("en");
    expect(t("topCash")).toBe("Cash");
    expect(tk("tab.port")).toBe("Port");
    expect(tk("no.such.key")).toBe("no.such.key");
    // 当前语言缺这个键时回退中文（lookup 按当前表、再按中文表）
    expect(lookup("topCash")).toBe("Cash");
    setLocale("zh-CN");
    expect(t("topCash")).toBe("现金");
  });

  it("金额：“12,345 gold”（不加复数）；后端尚未翻译货币名时英文界面也写 gold", () => {
    setWorld({ currency: "金币", era: "航海历", start_year: 1502 });
    expect(money(12345)).toBe("12,345 金币");
    setLocale("en");
    expect(money(12345)).toBe("12,345 gold");
    expect(money(1)).toBe("1 gold");
    expect(currency()).toBe("gold");
    expect(t("mtHire", { cost: num(1500) })).toBe("Hire (1,500 gold)");
    // 后端给出英文货币名时照用
    setWorld({ currency: "gold", era: "Mariner's Reckoning", start_year: 1502 });
    expect(money(7)).toBe("7 gold");
    expect(num(1234567)).toBe("1,234,567");
  });

  it("日期：“13 Mar 1502”，季节 “(Spring)”；纪年 Mariner's Reckoning", () => {
    setLocale("en");
    expect(dateText({ year: 1, month: 3, date: 13 })).toBe("13 Mar 1502");
    expect(dateText({ year: 3, month: 12, date: 30, calendar_year: 1520 })).toBe("30 Dec 1520");
    expect(dayDate(0)).toBe("1 Jan 1502");
    expect(dayDate(359)).toBe("30 Dec 1502");
    expect(dateSeasonText({ year: 1, month: 1, date: 13 }, 0)).toBe("13 Jan 1502 (Spring)");
    expect(dateSeasonText({ year: 1, month: 7, date: 2 }, 2)).toBe("2 Jul 1502 (Autumn)");
    expect(t("goalDeadline", { day: 3600 })).toBe(" (by 1 Jan 1512)");
    expect(t("itChronicleYear", { year: 4 })).toBe("1505");
    expect(eraName("航海历")).toBe("Mariner's Reckoning");
    expect(t("start.eraLine", { era: eraName("航海历"), year: 1502 })).toBe("Mariner's Reckoning 1502");
    expect(t("hudForecastDate", { month: 4, date: 2 })).toBe("2 Apr");
    // 中文不变
    setLocale("zh-CN");
    expect(dateSeasonText({ year: 1, month: 1, date: 13 }, 0)).toBe("1502年1月13日（春）");
    expect(eraName("航海历")).toBe("航海历");
  });

  it("带格式的占位符在两种语言下都工作：{x:money}、{x:date}、{x:cal}、{x:@前缀}", () => {
    const vars = { owner: "You", loc: "Villamare", colony: 3, reason: "abandoned" };
    expect(tk("log.ColonyLost", vars)).toBe("You 失去了 Villamare 的殖民地 #3（主动放弃）");
    setLocale("en");
    expect(tk("log.ColonyLost", vars)).toBe("You: lost colony #3 in Villamare (abandoned)");
    expect(t("colony.bookValue", { v: 4000 })).toBe("Book value 4,000 gold");
    expect(t("colony.founded", { day: 12, site: "Silvermist Mouth", terrain: tk("terrain.forest") })).toBe(
      "Founded 13 Jan 1502 · Silvermist Mouth · Forest",
    );
  });

  it("英文的单复数：{n:plural(day,days)}", () => {
    setLocale("en");
    expect(t("chartHudDaysValue", { n: 1 })).toBe("1 day");
    expect(t("chartHudDaysValue", { n: 0 })).toBe("0 days");
    expect(t("chartHudDaysValue", { n: 12 })).toBe("12 days");
    expect(t("start.scenarioMates", { n: 1 })).toBe("1 mate");
    expect(t("start.goalYears", { years: 10 })).toBe(" (within 10 years)");
    expect(tk("portGreet.tavern.0", { mates: 1 })).toContain("1 mate is here");
    expect(tk("portGreet.tavern.0", { mates: 3 })).toContain("3 mates are here");
    expect(t("btEncounterLine", { fleet: 0, ships: 1, guns: 4, crew: 20 })).toBe("Fleet #0 has met 1 pirate ship (4 guns, about 20 crew).");
    // 中文不受影响
    setLocale("zh-CN");
    expect(t("chartHudDaysValue", { n: 1 })).toBe("1 天");
  });

  it("列表分隔与括注按语言", () => {
    expect(listJoin(["谷物", "丝绸"])).toBe("谷物、丝绸");
    expect(t("paren", { text: "读取存档", note: 2 })).toBe("读取存档（2）");
    setLocale("en");
    expect(listJoin(["Grain", "Silk"])).toBe("Grain, Silk");
    expect(t("paren", { text: "Load Game", note: 2 })).toBe("Load Game (2)");
    expect(t("labelValue", { label: "Wind", value: "NE" })).toBe("Wind: NE");
  });

  it("专名：英文界面优先英文正名；中文界面悬停提示给英文正名", () => {
    const v = { name: "维拉马雷", name_en: "Villamare" };
    expect(nameOf(v)).toBe("维拉马雷");
    expect(otherName(v)).toBe("Villamare");
    expect(otherName({ name: "新晨港" })).toBeUndefined();
    setLocale("en");
    expect(nameOf(v)).toBe("Villamare");
    expect(nameOf({ name: "Villamare", name_en: "Villamare" })).toBe("Villamare");
    expect(otherName(v)).toBeUndefined();
    // 后端没给英文时照用 name
    expect(nameOf({ name: "新晨港" })).toBe("新晨港");
  });

  it("系统语言：zh 开头取简体中文，否则英语；设置里的语言优先", () => {
    expect(detectLocale("zh-CN")).toBe("zh-CN");
    expect(detectLocale("zh-TW")).toBe("zh-CN");
    expect(detectLocale("zh")).toBe("zh-CN");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr-FR")).toBe("en");
    expect(detectLocale("")).toBe("en");
    expect(settingsLocale("en", "zh-CN")).toBe("en");
    expect(settingsLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(settingsLocale(undefined, "en-GB")).toBe("en");
    expect(settingsLocale(undefined, "zh-HK")).toBe("zh-CN");
    expect(settingsLocale("de", "zh-CN")).toBe("zh-CN");
  });

  it("切换语言同步 <html lang>（读屏与英文排版用）", () => {
    setLocale("en");
    expect(document.documentElement.lang).toBe("en");
    setLocale("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});

// ───────────────────────────── 英文写作约定（本地化编辑的意见） ─────────────────────────────
// 这些约定对以后新增的英文同样适用：写错时下面的测试会指出具体的键。

describe("英文写作约定", () => {
  afterEach(() => setLocale("zh-CN"));

  const entries = () => Object.entries(en) as [string, string][];

  it("势力、交易所名在句子里带冠词（“the {faction}”，与后端 texts.toml 一致），不写 “a {名字}”", () => {
    // 势力名是 “Kingdom of Esperan” 这样的名称：句中写 “the {faction}”，句首写 “The {faction}”；
    // 只有标签式写法（“{site} → {faction}”）可以不带冠词
    const bare = entries().filter(([, v]) => /(?<!\b[Tt]he |→ )\{(faction|exchange)\}/.test(v)).map(([k]) => k);
    expect(bare).toEqual([]);
    // 不定冠词没法按名字选 a / an（“a Armed Merchantman”）
    const article = entries().filter(([, v]) => /\b[Aa]n? \{/.test(v)).map(([k]) => k);
    expect(article).toEqual([]);
    setLocale("en");
    const esperan = "Kingdom of Esperan";
    expect(tk("log.SiteClaimed", { faction: esperan, loc: "Silvermist Mouth" })).toBe(
      "The Kingdom of Esperan planted its flag at Silvermist Mouth; the land is now theirs",
    );
    expect(t("chartSiteClaimed", { faction: esperan })).toBe("Colony site (claimed by the Kingdom of Esperan)");
    expect(t("portSceneClaimed", { faction: esperan })).toBe("Outpost of the Kingdom of Esperan");
    expect(tk("log.Diplomacy", { a: esperan, b: "Sultanate of Qadir", status: "War" })).toBe(
      "Relations between the Kingdom of Esperan and the Sultanate of Qadir are now “War”",
    );
    expect(tk("portGreet.office.2", { faction: esperan, captain: "Captain Osva" })).toMatch(/^The Kingdom of Esperan welcomes/);
    expect(tk("log.ShipSunk", { owner: "You", fleet: 2, ship: "Armed Merchantman" })).toBe("You: fleet #2 lost a ship (Armed Merchantman)");
  });

  it("海区名：标签式写法或 “the {region}”，找不到海区时不会叠出 “somewhere in some distant sea”", () => {
    setLocale("en");
    expect(t("explore.rumorLine", { name: "Sunken Bell", region: "Morningstar Ocean" })).toBe(
      "Rumor: “Sunken Bell” · sea region: Morningstar Ocean",
    );
    expect(t("explore.rumorLine", { name: "Sunken Bell", region: t("explore.rumorFar") })).toBe(
      "Rumor: “Sunken Bell” · sea region: unknown, somewhere far off",
    );
    expect(t("pnCeRumor", { discovery: "Sunken Bell", region: "White Whale Sea" })).toBe("“Sunken Bell”, said to lie in the White Whale Sea");
  });

  it("商品名可能是复数（Pearls、Spices）：不写 “{good} is”", () => {
    const bad = entries().filter(([, v]) => /\{good\} (is|was|has)\b/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
    setLocale("en");
    expect(tk("log.Popular", { loc: "Qadira", good: "Spices" })).toBe("Qadira: Spices now in fashion");
  });

  it("计数与名词、动词的单复数一致", () => {
    setLocale("en");
    expect(t("colony.slots", { n: 1, max: 3 })).toBe("1 more colony allowed (max 3)");
    expect(t("colony.slots", { n: 2, max: 3 })).toBe("2 more colonies allowed (max 3)");
    expect(tk("start.goal.colonies", { target: 1 })).toBe("Run 1 thriving colony");
    expect(tk("start.goal.colonies", { target: 3 })).toBe("Run 3 thriving colonies");
    expect(t("explore.unknownHint", { n: 1 })).toBe("1 mystery remains on the chart, waiting to be sighted by your fleet.");
    expect(t("explore.unknownHint", { n: 4 })).toMatch(/^4 mysteries remain on the chart/);
    expect(t("colony.foundDone", { name: "Castria Haven", n: 1 })).toBe("Castria Haven is founded! 1 settler begins to work the land.");
    expect(t("colony.foundDone", { name: "Castria Haven", n: 25 })).toBe("Castria Haven is founded! 25 settlers begin to work the land.");
    expect(t("colony.workers", { need: 1, pct: 100 })).toBe("Jobs need 1 worker · staffing 100%");
    expect(t("btHelp", { range: 1 })).toContain("within 1 hex;");
  });

  it("季节不出现在句中（首字母大写的 “Spring” 只放句首）", () => {
    const mid = entries().filter(([, v]) => /[^.!?:]\s\{season\}/.test(v)).map(([k]) => k);
    expect(mid).toEqual([]);
    setLocale("en");
    expect(tk("portGreet.market.3", { captain: "Captain Osva", season: tk("season.0"), specialty: 2 })).toBe(
      "Captain Osva, good to see you again. Spring has been generous: 2 local specialties on offer.",
    );
  });

  it("等级徽章统一写作 “Lv {level}”", () => {
    const bad = entries().filter(([, v]) => /Lv(\.|\{)/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
    setLocale("en");
    expect(t("colony.buildUpgrade", { from: 1, to: 2 })).toBe("Lv 1 → Lv 2");
    expect(t("pnLevelBadge", { level: 3 })).toBe("Lv 3");
    expect(t("portMateLevel", { level: 3 })).toBe("Lv 3");
  });

  it("窗口与分节标题用 Sentence case（主菜单三项除外）", () => {
    const titles = [
      "startTitle",
      "mapTitle",
      "chartConfirmTitle",
      "pnCeTitle",
      "stAi",
      "colony.panelTitle",
      "colony.secPeople",
      "colony.secBuild",
      "colony.secTax",
      "colony.secMonth",
      "colony.secDefense",
      "colony.secCargo",
      "colony.secAbandon",
      "colony.secEffects",
      "colony.foundTitle",
      "explore.panelTitle",
      "explore.journal",
      "explore.rumors",
      "start.captainTitle",
      "shellStageChart",
      "portSceneDepart",
      "flSail",
    ];
    // 首词之后的词都小写（缩写 AI、占位符与 & 除外）
    const bad = titles.filter((k) =>
      (en[k] ?? "")
        .split(/\s+/)
        .slice(1)
        .some((w) => /^[A-Z][a-z]/.test(w)),
    );
    expect(bad).toEqual([]);
    expect(en.chartConfirmTitle).toBe(en.flSail);
    // 主菜单保留 Title Case
    expect(en.startNew).toBe("Start New Game");
    expect(en["start.menuNew"]).toBe("New Voyage");
    expect(en["start.menuLoad"]).toBe("Load Game");
  });

  it("美式拼写；航海士的职务“舰长”译作 Commander，与主角 Captain 区分", () => {
    const british = entries()
      .filter(([, v]) => /\b(grey|greyish|councillors?|counsellors?|travell?ers?|colour|harbour|defence|licence|rumour|labour)\b/i.test(v))
      .map(([k]) => k);
    expect(british).toEqual([]);
    setLocale("en");
    expect(tk("role.captain", { target: 1 })).toBe("Commander (fleet #1)");
    expect(t("pnMateCaptain", { name: "Hallvar Grafen" })).toBe("Commander Hallvar Grafen");
    expect(t("mtRoleHelp")).toMatch(/^Commander: /);
    expect(t("btFacing")).not.toMatch(/\bturn\b/i);
  });

  it("建议的殖民地名：两种语言逐项对应，不拼出 “Moonbay Bay”，也不超过殖民地名的字数上限", () => {
    const split = (s: string) => s.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    const zh = zhCN as Record<string, string>;
    for (const key of ["colony.namePrefixes", "colony.nameSuffixes"]) {
      expect(split(en[key]).length, key).toBe(split(zh[key]).length);
    }
    for (const table of [en, zh]) {
      const pre = split(table["colony.namePrefixes"]);
      const suf = split(table["colony.nameSuffixes"]);
      for (const p of pre) {
        for (const s of suf) {
          expect(p.toLowerCase().endsWith(s.toLowerCase()), `${p} + ${s}`).toBe(false);
          const name = table["colony.nameJoin"].replace("{prefix}", p).replace("{suffix}", s);
          expect([...name].length, name).toBeLessThanOrEqual(COLONY_NAME_MAX);
        }
      }
    }
    setLocale("en");
    for (let i = 0; i < 40; i++) expect(suggestName("silvermist_mouth", i)).toMatch(/^[A-Z][A-Za-z.]*( [A-Z][A-Za-z.]*)+$/);
  });
});
