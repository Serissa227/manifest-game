// 程序生成的名字（EXPANSION.md §12.1、§12.3）：同一个种子在两种语言下对应同一个名字——
// 中文与改动前完全相同，英文是它的拉丁字母原形；掌柜、海盗头目、随机船长的名字都成对。
import { afterEach, describe, expect, it } from "vitest";
import { CAPTAIN_NAME_MAX, captainName } from "../components/start/captain";
import { keeper } from "../components/port/greeting";
import { setLocale } from "../i18n/locale";
import { FACILITIES } from "../store/game";
import { ARCH_STYLES } from "./buildings";
import { namePairTables, npcName, npcNameEn, npcNamePair, npcNameParts } from "./names";
import { keeperSpec } from "./portraits";
import { hash32 } from "./rng";

const REGIONS = [undefined, ...ARCH_STYLES] as const;

describe("名字成对：中文音译 + 英文原形", () => {
  afterEach(() => setLocale("zh-CN"));

  it("中文结果与改动前完全相同（4800 个种子 × 性别 × 文化的指纹，与只有中文时记下的一致）", () => {
    const out: string[] = [];
    for (let i = 0; i < 300; i++) {
      for (const region of REGIONS) {
        for (const female of [false, true]) out.push(npcName(`base-${i}`, female, region));
      }
    }
    expect(out.length).toBe(4800);
    expect(hash32(out.join("|"))).toBe(3318606660);
    // 几个具体的例子（改动前的输出）
    expect(out.slice(0, 16)).toEqual([
      "奥斯瓦·阿尔滕",
      "奥德莉娜·阿尔滕",
      "阿尔瓦里奥·贝尔蒙特",
      "阿玛兰塔·贝尔蒙特",
      "阿斯韦尔·伦德贝里",
      "阿斯特拉·伦德贝里",
      "巴伦德·德·哈弗",
      "安妮克·德·哈弗",
      "阿迪尔·本·阿兹拉",
      "阿米拉·本·阿兹拉",
      "阿卡诺·瓦伊卢阿",
      "阿拉尼·瓦伊卢阿",
      "王远",
      "王岚",
      "伊莱亚斯·惠勒",
      "梅茜·惠勒",
    ]);
  });

  it("同一个种子的英文是中文的原形：名对名、姓对姓，西方 “Given Surname”，东方拼音 “Surname Given”", () => {
    const p = npcNameParts("base-0", false);
    expect(p.text).toBe("奥斯瓦·阿尔滕");
    expect(p.en).toEqual({ given: "Osva", surname: "Alten", text: "Osva Alten" });
    expect(npcNamePair("base-0", true, "lowland")).toEqual({ zh: "安妮克·德·哈弗", en: "Anneke de Haaf" });
    expect(npcNamePair("base-0", false, "desert")).toEqual({ zh: "阿迪尔·本·阿兹拉", en: "Adil ben Azra" });
    expect(npcNamePair("base-0", false, "eastern")).toEqual({ zh: "王远", en: "Wang Yuan" });
    expect(npcNamePair("base-0", true, "frontier")).toEqual({ zh: "梅茜·惠勒", en: "Maisie Wheeler" });
    for (let i = 0; i < 200; i++) {
      for (const region of REGIONS) {
        for (const female of [false, true]) {
          const parts = npcNameParts(`pair-${i}`, female, region);
          expect(npcName(`pair-${i}`, female, region)).toBe(parts.text);
          expect(npcNameEn(`pair-${i}`, female, region)).toBe(parts.en.text);
          expect(parts.en.text).toBe(parts.eastern ? `${parts.en.surname} ${parts.en.given}` : `${parts.en.given} ${parts.en.surname}`);
        }
      }
    }
  });

  it("每一对都写全：英文只用拉丁字母（可带空格、连字符、撇号、句点），中文没有拉丁字母；同一名池里中文不重复", () => {
    for (const { pool, pairs } of namePairTables()) {
      expect(pairs.length).toBeGreaterThan(0);
      for (const [en, zh] of pairs) {
        expect(en, `${pool}: ${zh}`).toMatch(/^[A-Za-z][A-Za-z .'-]*[A-Za-z]$/);
        expect(zh, `${pool}: ${en}`).not.toMatch(/[A-Za-z]/);
        expect(zh.trim()).toBe(zh);
      }
      expect(new Set(pairs.map((p) => p[1])).size, pool).toBe(pairs.length);
    }
  });

  it("西方名池里英文原形也不重复（东方拼音允许同音字，如“峻 / 骏” Jun）", () => {
    for (const { pool, eastern, pairs } of namePairTables()) {
      if (eastern) continue;
      expect(new Set(pairs.map((p) => p[0])).size, pool).toBe(pairs.length);
    }
  });

  it("掌柜的名字成对，头像与性别不随语言变化", () => {
    for (const region of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        const k = keeperSpec(`port-${region}`, fac, region);
        expect(k.name).toBe(npcName(`port-${region}-${fac}`, k.spec.female, region));
        expect(k.nameEn).toBe(npcNameEn(`port-${region}-${fac}`, k.spec.female, region));
        const zh = keeper(`port-${region}`, fac, region);
        setLocale("en");
        const en = keeper(`port-${region}`, fac, region);
        setLocale("zh-CN");
        expect(en.spec).toEqual(zh.spec);
        expect(en.name).toBe(zh.name);
        expect(en.nameEn).toBe(zh.nameEn);
        // 头衔按语言
        expect(en.title).not.toBe(zh.title);
      }
    }
  });

  it("随机船长名：中文不变；英文取同一个种子的原形，放不下 12 个字符时换种子，一定放得下", () => {
    for (let roll = 0; roll < 300; roll++) {
      for (const female of [false, true]) {
        expect(captainName(roll, female, "zh-CN")).toBe(npcName(`captain-${roll}`, female));
        const en = captainName(roll, female, "en");
        expect(Array.from(en).length).toBeLessThanOrEqual(CAPTAIN_NAME_MAX);
        expect(en).toMatch(/^[A-Za-z][A-Za-z .'-]*$/);
        // 放得下时就是同一个种子的原形
        const same = npcNameEn(`captain-${roll}`, female);
        if (same.length <= CAPTAIN_NAME_MAX) expect(en).toBe(same);
      }
    }
    // 不传语言时按当前界面语言
    expect(captainName(5, false)).toBe(npcName("captain-5", false));
    setLocale("en");
    expect(captainName(5, false)).toBe(captainName(5, false, "en"));
  });
});
