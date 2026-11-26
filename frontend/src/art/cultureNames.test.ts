// 寰宇的名字文化（cultureNames.ts）：按势力的细风格给港口人物起十六世纪当地的名字，不混入原创的西洋外来者名；
// 经典世界（势力不带细风格）的名字与原来逐个相同。
import { describe, expect, it } from "vitest";
import { CULTURE_STYLES, TOWN_ALIASES } from "./buildings";
import { CULTURE_NAMES, NAME_CULTURE_OF } from "./cultureNames";
import { nameCulture, npcNamePair, npcNameParts } from "./names";
import { keeperCast } from "./portraitCast";

describe("名字文化", () => {
  it("寰宇用到的每种细风格都有名字文化，每种名字文化都有名池（中国用东方名池）", () => {
    const fine = [...CULTURE_STYLES, ...Object.keys(TOWN_ALIASES)];
    const missing = fine.filter((s) => !Object.prototype.hasOwnProperty.call(NAME_CULTURE_OF, s));
    expect(missing).toEqual([]);
    const cultures = new Set(Object.values(NAME_CULTURE_OF));
    const noPool = [...cultures].filter((c) => c !== "chinese" && !Object.prototype.hasOwnProperty.call(CULTURE_NAMES, c));
    expect(noPool).toEqual([]);
    for (const c of cultures) expect(nameCulture(Object.keys(NAME_CULTURE_OF).find((s) => NAME_CULTURE_OF[s] === c))).not.toBeNull();
  });

  it("日本港口的人一律出日本名：屋号在前、名在后，不带间隔点；两百个种子里没有一个西洋外来者", () => {
    const yago = new Set(CULTURE_NAMES.japanese.surnames.map((s) => s[1]));
    for (let i = 0; i < 200; i++) {
      for (const female of [false, true]) {
        const p = npcNameParts(`port-${i}`, female, "eastern", "japanese");
        expect(p.eastern).toBe(true);
        expect(yago.has(p.surname)).toBe(true);
        expect(p.text).not.toContain("·");
      }
    }
  });

  it("中国港口用东方名池、也不混入外来者", () => {
    for (let i = 0; i < 100; i++) expect(npcNamePair(`ming-${i}`, false, "eastern", "ming").zh).not.toContain("·");
  });

  it("经典世界（不带细风格、或细风格没有名字文化）的名字与原来逐个相同", () => {
    for (let i = 0; i < 100; i++) {
      for (const region of ["mediterranean", "eastern", "frontier"] as const) {
        const before = npcNamePair(`classic-${i}`, i % 2 === 0, region);
        expect(npcNamePair(`classic-${i}`, i % 2 === 0, region, null)).toEqual(before);
        expect(npcNamePair(`classic-${i}`, i % 2 === 0, region, "no_such_style")).toEqual(before);
      }
    }
  });

  it("掌柜按港口势力的细风格起名：下田（土佐一条氏，japanese）的交易所掌柜是日本名", () => {
    const who = keeperCast("shimoda_tosa", "market", "eastern", undefined, "japanese");
    expect(who.name).not.toContain("·");
    expect(CULTURE_NAMES.japanese.surnames.some(([, zh]) => who.name.startsWith(zh))).toBe(true);
  });
});
