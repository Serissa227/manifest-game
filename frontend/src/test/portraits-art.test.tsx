// AI 生成的时代肖像接入：素材清单与文件、人物到素材的映射（确定、同港掌柜不重复、相邻港口不撞人、名字与所选头像同性别）、
// 缺图回退到程序头像、新增人物位（情报贩子、君主、商会会长、殖民地总管、别家船队的船长）。
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import companiesToml from "../../../data/companies.toml?raw";
import factionsToml from "../../../data/factions.toml?raw";
import matesToml from "../../../data/mates.toml?raw";
import citiesToml from "../../../data/world/cities.toml?raw";
import overseasToml from "../../../data/world/overseas.toml?raw";
import portsToml from "../../../data/world/ports.toml?raw";
import { isArchStyle, styleOf, type ArchStyle } from "../art/buildings";
import { npcNamePair } from "../art/names";
import { lookalike } from "../art/people/spec";
import { PENDING_PORTRAITS, PORTRAIT_ASSETS } from "../art/portraitAssets";
import {
  COMPANY_KEYS,
  KEEPER_NEIGHBORS,
  captainAssetId,
  castName,
  companyAssetId,
  fleetCaptain,
  hasPortrait,
  informantAssetId,
  isPendingPortrait,
  keeperAssetId,
  keeperCast,
  type KeeperPlace,
  mateAssetId,
  pirateAssetId,
  planKeepers,
  portraitAsset,
  portraitGroup,
  portraitSrc,
  rivalAssetId,
  rulerAssetId,
  stewardAssetId,
} from "../art/portraitCast";
import { keeperSpec } from "../art/portraits";
import { Px } from "../art/px";
import { hash32 } from "../art/rng";
import FleetHoverCard from "../components/FleetHoverCard";
import ColoniesPanel from "../components/panels/ColoniesPanel";
import IntelPanel from "../components/panels/IntelPanel";
import PortPanel from "../components/panels/PortPanel";
import { keeper, keeperPlaces } from "../components/port/greeting";
import { PortraitArt } from "../components/portrait/PortraitArt";
import { useGame, type Facility } from "../store/game";
import { colonialOverview, colonialStatics, coloniesView, installIpc, port, startedGame, statics } from "./fixtures";

/** TOML 里 [[<表>]] 条目的某个字符串字段（按出现顺序）。 */
function tomlField(text: string, table: string, field: string): string[] {
  const out: string[] = [];
  for (const block of text.split(`[[${table}]]`).slice(1)) {
    const m = new RegExp(`^${field}\\s*=\\s*"([^"]+)"`, "m").exec(block);
    if (m) out.push(m[1]);
  }
  return out;
}

const FACILITIES: readonly Facility[] = ["market", "shipyard", "tavern", "guild", "bank", "exchange", "warehouse", "invest", "office"];
const REGIONS: readonly ArchStyle[] = ["mediterranean", "nordic", "lowland", "desert", "islands", "eastern", "frontier"];

// ───────────────────────────── 清单与文件 ─────────────────────────────

describe("肖像素材清单", () => {
  // 只取文件名（不加载）
  const files = new Set(Object.keys(import.meta.glob("../../public/portraits/**/*.{webp,json}")).map((k) => k.replace("../../public/", "")));

  it("329 位人物：主角 24、航海士 40、掌柜 189（七种文化 × 九种设施 × a/b/c）、海盗 20、商会 6、君主 6、各国船长 24、情报贩子 14、总管 6", () => {
    expect(PORTRAIT_ASSETS).toHaveLength(329);
    const count = (g: string) => PORTRAIT_ASSETS.filter((a) => a.group === g).length;
    expect([count("captain"), count("mate"), count("keeper"), count("pirate"), count("company"), count("ruler"), count("rival"), count("informant"), count("steward")]).toEqual([
      24, 40, 189, 20, 6, 6, 24, 14, 6,
    ]);
    expect(new Set(PORTRAIT_ASSETS.map((a) => a.id)).size).toBe(329);
    // 美少年型的成年男子：有，但不占多数；都是成年人
    const andro = PORTRAIT_ASSETS.filter((a) => a.meta.androgynous);
    expect(andro.length).toBeGreaterThanOrEqual(15);
    expect(andro.length).toBeLessThan(PORTRAIT_ASSETS.filter((a) => a.meta.gender === "male").length / 3);
    for (const a of andro) expect(a.meta.gender).toBe("male");
    for (const a of PORTRAIT_ASSETS) expect(a.meta.age).toBeGreaterThanOrEqual(20);
  });

  it("清单里的每个文件都在 public/portraits 下（胸像与脸部特写）", () => {
    const missing: string[] = [];
    for (const a of PORTRAIT_ASSETS) for (const f of [a.file, a.face]) if (!files.has(f)) missing.push(f);
    expect(missing).toEqual([]);
    expect(portraitSrc("captain-00")).toBe("/portraits/captain-00.webp");
    expect(portraitSrc("captain-00", "face")).toBe("/portraits/face/captain-00.webp");
    expect(portraitSrc("nobody")).toBeNull();
  });

});

// ───────────────────────────── 映射 ─────────────────────────────

describe("人物到素材的映射", () => {
  it("主角：外貌 0–11、13–24 依次对应 captain-00…11、captain-13…24（越界按 25 取模，偶数男、奇数女），空缺的 12 号归到 0 号", () => {
    for (const i of [...Array.from({ length: 12 }, (_, k) => k), ...Array.from({ length: 12 }, (_, k) => 13 + k)]) {
      const id = captainAssetId(i);
      expect(id).toBe(`captain-${String(i).padStart(2, "0")}`);
      expect(portraitAsset(id)?.meta.gender).toBe(i % 2 === 0 ? "male" : "female");
      expect(portraitAsset(id)?.meta.index).toBe(i);
    }
    expect(captainAssetId(-1)).toBe("captain-24");
    expect(captainAssetId(25)).toBe("captain-00");
    expect(captainAssetId(50)).toBe("captain-00");
    expect(captainAssetId(26)).toBe("captain-01");
    expect(captainAssetId(12)).toBe("captain-00");
  });

  it("航海士：mates.toml 的每位都有肖像；性别与小传的称呼一致；没有 key 的旧后端回退", () => {
    const keys = tomlField(matesToml, "mates", "key");
    expect(keys.length).toBeGreaterThanOrEqual(22);
    const bios = tomlField(matesToml, "mates", "bio");
    keys.forEach((key, i) => {
      const id = mateAssetId({ name: key, key });
      expect(id).toBe(`mate-${key}`);
      expect(portraitAsset(id)?.meta.gender).toBe(bios[i]?.includes("她") ? "female" : "male");
    });
    expect(mateAssetId({ name: "周明远" })).toBeNull();
    expect(mateAssetId({ name: "某人", key: "not_drawn_yet" })).toBeNull();
    // 寰宇的航海士也是人物：后端给出人物当前年龄的头像，有图就用它；没有这张图时照旧按 key 找
    expect(mateAssetId({ name: "汐", key: "ushio", portrait: "t16-ushio-14" })).toBe("t16-ushio-14");
    expect(mateAssetId({ name: "某人", key: "not_drawn_yet", portrait: "t16-no-such-art" })).toBeNull();
    expect(mateAssetId({ name: "某人", key: "not_drawn_yet", portrait: null })).toBeNull();
  });

  it("掌柜：每种文化的每种设施 a、b 一男一女、c 是第三位；三位都可选（不限性别），结果确定；名字与所选头像同性别", () => {
    for (const r of REGIONS) {
      for (const f of FACILITIES) {
        const pair = ["a", "b"].map((v) => portraitAsset(`keeper-${r}-${f}-${v}`));
        expect(pair.every(Boolean)).toBe(true);
        expect(new Set(pair.map((a) => a?.meta.gender))).toEqual(new Set(["male", "female"]));
        expect(portraitAsset(`keeper-${r}-${f}-c`)).toBeDefined();
        // 不给地点列表时按港口 key 的哈希在整格三位里取：港口多了三位都会轮到（男女都有）
        const picks = new Set(Array.from({ length: 40 }, (_, i) => keeperAssetId(`port-${i}`, f, r)));
        expect(picks, `${r}-${f}`).toEqual(new Set(["a", "b", "c"].map((v) => `keeper-${r}-${f}-${v}`)));
      }
    }
    const once = keeperAssetId("chenggang", "market", "mediterranean");
    expect(keeperAssetId("chenggang", "market", "mediterranean")).toBe(once);
    expect(once).toMatch(/^keeper-mediterranean-market-[abc]$/);
    // 名字、回退头像的性别跟随所选头像；名字仍以“港口 key-设施”为种子
    const who = keeperCast("chenggang", "market", "mediterranean");
    expect(who.asset).toBe(once);
    expect(who.spec.female).toBe(isFemale(once));
    expect({ zh: who.name, en: who.nameEn }).toEqual(npcNamePair("chenggang-market", isFemale(once), "mediterranean"));
  });

  it("同一港口的九位掌柜互不重复；名字、回退头像与所选头像同性别、文化一致，九位的回退头像不撞脸（全部港口、海外港口与城市，外加七种文化的虚拟港口；给不给地点列表都成立）", () => {
    const places = allKeeperPlaces();
    expect(places.length).toBeGreaterThanOrEqual(30 + REGIONS.length * 6);
    for (const list of [undefined, places]) {
      for (const p of places) {
        const who = FACILITIES.map((f) => keeperCast(p.key, f, p.region, list));
        who.forEach((w, i) => {
          const f = FACILITIES[i];
          const at = `${p.key}-${f}`;
          expect(w.asset, at).toBe(keeperAssetId(p.key, f, p.region, list));
          const a = portraitAsset(w.asset);
          expect(a?.meta.culture, at).toBe(p.region);
          expect(a?.meta.facility, at).toBe(f);
          expect(w.spec.female, at).toBe(a?.meta.gender === "female");
          expect(w.spec.region, at).toBe(p.region);
          expect({ zh: w.name, en: w.nameEn }, at).toEqual(npcNamePair(at, w.spec.female, p.region));
        });
        expect(new Set(who.map((w) => w.asset)).size, p.key).toBe(9);
        for (let i = 0; i < who.length; i++) {
          for (let j = i + 1; j < who.length; j++) expect(lookalike(who[i].spec, who[j].spec), `${p.key} ${FACILITIES[i]}/${FACILITIES[j]}`).toBeLessThan(3);
        }
        // 称呼跟随所选头像：酒馆的女掌柜是“老板娘”
        const tavern = keeper(p.key, "tavern", p.region, list);
        expect(tavern.title).toBe(isFemale(tavern.asset) ? "酒馆老板娘" : "酒馆老板");
      }
    }
  });

  it("海盗头目：同性别里按遭遇编号取，确定；男女都有", () => {
    for (let id = 0; id < 40; id++) {
      for (const female of [false, true]) {
        const a = pirateAssetId(id, female);
        expect(a).toBe(pirateAssetId(id, female));
        expect(portraitAsset(a)?.group).toBe("pirate");
        expect(portraitAsset(a)?.meta.gender).toBe(female ? "female" : "male");
      }
    }
    expect(new Set(Array.from({ length: 60 }, (_, i) => pirateAssetId(i, false))).size).toBeGreaterThanOrEqual(4);
  });

  it("商会会长按 companies.toml 的顺序；君主按势力 key；各国船长每国四位；情报贩子每种文化两位；总管按殖民地编号轮流", () => {
    expect(tomlField(companiesToml, "companies", "key")).toEqual(COMPANY_KEYS);
    COMPANY_KEYS.forEach((k, i) => expect(companyAssetId(i)).toBe(`company-${k}`));
    expect(companyAssetId(99)).toBeNull();
    for (const key of tomlField(factionsToml, "factions", "key")) {
      expect(rulerAssetId(key)).toBe(`ruler-${key}`);
      const rivals = portraitGroup("rival").filter((a) => a.meta.faction === key);
      expect(rivals).toHaveLength(4);
      const picks = new Set(Array.from({ length: 20 }, (_, i) => rivalAssetId(key, i)));
      expect(picks).toEqual(new Set(rivals.map((a) => a.id)));
    }
    expect(rulerAssetId("atlantis")).toBeNull();
    expect(rivalAssetId("atlantis", 1)).toBeNull();
    for (const r of REGIONS) {
      const picks = new Set(Array.from({ length: 30 }, (_, i) => informantAssetId(r, `port-${i}`)));
      expect(picks).toEqual(new Set([`informant-${r}-a`, `informant-${r}-b`]));
      expect(informantAssetId(r, "chenggang")).toBe(informantAssetId(r, "chenggang"));
    }
    expect([0, 1, 5, 6, 13].map(stewardAssetId)).toEqual(["steward-01", "steward-02", "steward-06", "steward-01", "steward-02"]);
  });

  it("别家船队的船长：取商会文化对应的势力的船长；名字按素材的性别与文化，确定且中英成对", () => {
    const factions = tomlField(factionsToml, "factions", "key").map((key, i) => ({ key, style: tomlField(factionsToml, "factions", "style")[i] }));
    const gull = fleetCaptain(0, factions, "fleet-3");
    expect(gull.faction).toBe("cuilan");
    expect(portraitAsset(gull.asset)?.meta.faction).toBe("cuilan");
    expect(fleetCaptain(0, factions, "fleet-3")).toEqual(gull);
    // 找不到对应势力（例如测试数据只有两个势力）时在全部船长里取
    const lone = fleetCaptain(4, [{ key: "cuilan", style: null }], 1);
    expect(portraitAsset(lone.asset)?.group).toBe("rival");
    const name = castName(gull.asset, "x", undefined);
    expect(name).toEqual(castName(gull.asset, "x", undefined));
    expect(name.zh.length).toBeGreaterThan(0);
    expect(name.en).toMatch(/^[\x20-\x7eÀ-ɏ]+$/);
    for (const a of PORTRAIT_ASSETS) if (a.meta.culture !== "open" && a.meta.culture !== "elfkin") expect(isArchStyle(a.meta.culture)).toBe(true);
  });
});

// ───────────────────────────── 头像终版：掌柜 a/b/c、海盗 20、各国船长 24、英雄素材 ─────────────────────────────

/** TOML 里 [[<表>]] 条目的 pos = [x, y]（按出现顺序）。 */
function tomlPos(text: string, table: string): [number, number][] {
  const out: [number, number][] = [];
  for (const block of text.split(`[[${table}]]`).slice(1)) {
    const m = /^pos\s*=\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/m.exec(block);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/**
 * 全部港口、海外港口与内陆城市（界面的 keeperPlaces 含港口与城市；位置取数据里的停泊格或所在陆格，文化取所属势力的建筑风格，与 keeperPlaces 同样取法），
 * 外加七种文化各六个排成一行的虚拟港口。
 */
function allKeeperPlaces(): KeeperPlace[] {
  const factionStyle = new Map<string, ArchStyle>();
  const fkeys = tomlField(factionsToml, "factions", "key");
  const fstyles = tomlField(factionsToml, "factions", "style");
  fkeys.forEach((k, i) => factionStyle.set(k, styleOf(k, fstyles[i])));
  const out: KeeperPlace[] = [];
  for (const [text, table] of [
    [portsToml, "ports"],
    [overseasToml, "ports"],
    [citiesToml, "cities"],
  ] as const) {
    const keys = tomlField(text, table, "key");
    const factions = tomlField(text, table, "faction");
    const pos = tomlPos(text, table);
    expect(pos).toHaveLength(keys.length);
    keys.forEach((k, i) => out.push({ key: k, x: pos[i][0], y: pos[i][1], region: factionStyle.get(factions[i]) ?? "mediterranean" }));
  }
  REGIONS.forEach((r, j) => {
    for (let i = 0; i < 6; i++) out.push({ key: `test-${r}-${i}`, x: 500 + i * 7 + (i % 2), y: 300 + j * 40, region: r });
  });
  return out;
}

/** 素材是不是女性。 */
const isFemale = (id: string | null | undefined) => portraitAsset(id)?.meta.gender === "female";

/** 独立算出离 p 最近的 n 个同文化地点（距离相同按 key），用来核对掌柜的分配。 */
function nearestSameCulture(places: readonly KeeperPlace[], p: KeeperPlace, n: number): KeeperPlace[] {
  const d = (q: KeeperPlace) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  return places
    .filter((q) => q.region === p.region && q.key !== p.key)
    .sort((a, b) => d(a) - d(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, n);
}

describe("头像终版：路人 265 位（掌柜 a/b/c、海盗 20、各国船长 24）与英雄 64 位", () => {
  const files = new Set(Object.keys(import.meta.glob("../../public/portraits/**/*.webp")).map((k) => k.replace("../../public/", "")));

  it("每种文化的每种设施都有第三位掌柜 c：成年、文化与设施一致、男女都有；a、b、c 三位都会被选中、用得差不多一样多，名字随所选头像的性别（不再限定与原程序头像同性别）", () => {
    const cs = portraitGroup("keeper").filter((a) => a.meta.variant === "c");
    expect(cs).toHaveLength(REGIONS.length * FACILITIES.length);
    for (const r of REGIONS) {
      for (const f of FACILITIES) {
        const c = portraitAsset(`keeper-${r}-${f}-c`);
        expect(c, `${r}-${f}`).toBeDefined();
        expect(c?.meta.culture).toBe(r);
        expect(c?.meta.facility).toBe(f);
        expect(c?.meta.variant).toBe("c");
        expect(c?.meta.age).toBeGreaterThanOrEqual(20);
      }
    }
    expect(new Set(cs.map((a) => a.meta.gender))).toEqual(new Set(["male", "female"]));
    const places = allKeeperPlaces();
    const used: Record<string, number> = { a: 0, b: 0, c: 0 };
    let total = 0;
    let regendered = 0;
    for (const p of places) {
      for (const f of FACILITIES) {
        const w = keeperCast(p.key, f, p.region, places);
        const v = portraitAsset(w.asset)?.meta.variant ?? "?";
        used[v] = (used[v] ?? 0) + 1;
        total++;
        expect(w.spec.female, `${p.key}-${f}`).toBe(isFemale(w.asset));
        if (keeperSpec(p.key, f, p.region).spec.female !== w.spec.female) regendered++;
      }
    }
    // 真实港口与虚拟港口里用到了相当一部分 c；三位各占四分之一以上
    expect(used.c).toBeGreaterThanOrEqual(20);
    expect(Object.keys(used).sort()).toEqual(["a", "b", "c"]);
    for (const v of ["a", "b", "c"]) expect(used[v] / total, v).toBeGreaterThan(0.25);
    // 性别约束确实放开了：有一部分掌柜的性别（与名字）与原程序头像不同，也有一部分相同
    expect(regendered).toBeGreaterThan(0);
    expect(regendered).toBeLessThan(total);
  });

  it("给了地点列表时：同港九位不重复；每个港口与离它最近的两个同文化地点在同一设施上都不是同一位；结果确定、与列表顺序无关", () => {
    const places = allKeeperPlaces();
    for (const p of places) {
      const ids = FACILITIES.map((f) => keeperAssetId(p.key, f, p.region, places));
      expect(new Set(ids).size, p.key).toBe(9);
    }
    expect(KEEPER_NEIGHBORS).toBe(2);
    let checked = 0;
    for (const p of places) {
      const near = nearestSameCulture(places, p, 2);
      expect(near, p.key).toHaveLength(2);
      for (const q of near) {
        for (const f of FACILITIES) {
          expect(keeperAssetId(p.key, f, p.region, places), `${p.key} ↔ ${q.key}（${f}）`).not.toBe(keeperAssetId(q.key, f, q.region, places));
          checked++;
        }
      }
    }
    expect(checked).toBe(places.length * FACILITIES.length * 2);
    // 确定、与顺序无关：内容相同的另一份列表、倒序、按哈希打乱，结果都一样
    const copy = places.map((p) => ({ ...p }));
    const reversed = [...copy].reverse();
    const shuffled = [...copy].sort((a, b) => hash32(`shuffle-${a.key}`) - hash32(`shuffle-${b.key}`));
    for (const list of [copy, reversed, shuffled]) {
      for (const p of places) for (const f of FACILITIES) expect(keeperAssetId(p.key, f, p.region, list), `${p.key}-${f}`).toBe(keeperAssetId(p.key, f, p.region, places));
    }
    // 不在列表里的地点按港口 key 的哈希取（与不给列表时相同）
    for (const f of FACILITIES) expect(keeperAssetId("nowhere", f, "nordic", places)).toBe(keeperAssetId("nowhere", f, "nordic"));
  });

  it("邻居图着不了三色时（测试里把邻居数调到 3，四个地点挤在一起两两互为邻居）：退一步仍保证每个地点与离它最近的那一个不是同一位", () => {
    const places: KeeperPlace[] = [
      { key: "k-0", x: 0, y: 0, region: "lowland" },
      { key: "k-1", x: 3, y: 0, region: "lowland" },
      { key: "k-2", x: 0, y: 4, region: "lowland" },
      { key: "k-3", x: 3, y: 5, region: "lowland" },
      { key: "k-4", x: 40, y: 0, region: "lowland" },
      { key: "k-5", x: 44, y: 0, region: "lowland" },
      { key: "k-6", x: 40, y: 3, region: "lowland" },
      { key: "far", x: 0, y: 0, region: "nordic" },
    ];
    const lowland = places.filter((p) => p.region === "lowland");
    for (const f of FACILITIES) {
      const plan = planKeepers(places, f, "lowland", 3);
      expect([...plan.keys()].sort()).toEqual(lowland.map((p) => p.key));
      for (const p of lowland) {
        expect(portraitAsset(plan.get(p.key))?.meta.facility).toBe(f);
        const [q] = nearestSameCulture(places, p, 1);
        expect(plan.get(p.key), `${p.key} ↔ ${q.key}（${f}）`).not.toBe(plan.get(q.key));
      }
      expect(planKeepers([...places].reverse(), f, "lowland", 3)).toEqual(plan);
      // 默认邻居数下与 keeperAssetId 的结果一致
      const def = planKeepers(places, f, "lowland");
      for (const p of lowland) expect(keeperAssetId(p.key, f, "lowland", places)).toBe(def.get(p.key));
    }
  });

  it("界面的地点列表 keeperPlaces：港口与城市（不含殖民点），坐标取停泊格，文化按所属势力的建筑风格", () => {
    const list = keeperPlaces(colonialStatics.locations, colonialStatics.factions);
    expect(list.map((p) => p.key)).toEqual(colonialStatics.locations.filter((l) => l.kind !== "site").map((l) => l.key));
    const cheng = list.find((p) => p.key === "chenggang");
    expect(cheng).toEqual({ key: "chenggang", x: 1, y: 1, region: styleOf(colonialStatics.factions[0].key, colonialStatics.factions[0].style) });
  });

  it("海盗头目 20 位（十男十女）：按遭遇编号在同性别的十位里取，遭遇多了会轮到每一位", () => {
    const pirates = portraitGroup("pirate");
    expect(pirates).toHaveLength(20);
    for (let i = 13; i <= 20; i++) expect(pirates.map((a) => a.id)).toContain(`pirate-${i}`);
    for (const female of [false, true]) {
      const same = pirates.filter((a) => (a.meta.gender === "female") === female).map((a) => a.id);
      expect(same).toHaveLength(10);
      expect(new Set(Array.from({ length: 400 }, (_, id) => pirateAssetId(id, female)))).toEqual(new Set(same));
    }
    expect(new Set(pirates.map((a) => a.meta.culture)).size).toBe(7);
  });

  it("各国船长 24 位：每个势力四位（两男两女、文化随势力），按势力取，船队多了会轮到每一位", () => {
    const rivals = portraitGroup("rival");
    expect(rivals).toHaveLength(24);
    const fkeys = tomlField(factionsToml, "factions", "key");
    const fstyles = tomlField(factionsToml, "factions", "style");
    fkeys.forEach((key, i) => {
      const mine = rivals.filter((a) => a.meta.faction === key);
      expect(mine, key).toHaveLength(4);
      expect(mine.filter((a) => a.meta.gender === "female")).toHaveLength(2);
      for (const a of mine) expect(a.meta.culture).toBe(styleOf(key, fstyles[i]));
      expect(new Set(Array.from({ length: 60 }, (_, s) => rivalAssetId(key, `fleet-${s}`)))).toEqual(new Set(mine.map((a) => a.id)));
    });
  });

  it("英雄 64 位（主角外貌 24 种、航海士 40 位）都有图、不再预留，胸像与脸部特写都在", () => {
    expect(PENDING_PORTRAITS).toHaveLength(0);
    const looks = [...Array.from({ length: 12 }, (_, k) => k), ...Array.from({ length: 12 }, (_, k) => 13 + k)];
    const mateKeys = tomlField(matesToml, "mates", "key");
    expect(mateKeys).toHaveLength(40);
    const ids = [...looks.map((i) => captainAssetId(i)), ...mateKeys.map((key) => mateAssetId({ name: key, key }))];
    expect(ids).toHaveLength(64);
    for (const id of ids) {
      expect(hasPortrait(id), String(id)).toBe(true);
      expect(isPendingPortrait(id)).toBe(false);
      const a = PORTRAIT_ASSETS.find((x) => x.id === id);
      expect(a, String(id)).toBeDefined();
      for (const f of [a?.file, a?.face]) expect(files.has(String(f)), String(f)).toBe(true);
      expect(portraitSrc(id)).toBe(`/${a?.file}`);
      expect(portraitSrc(id, "face")).toBe(`/${a?.face}`);
    }
    expect(PORTRAIT_ASSETS.filter((a) => a.group === "captain" || a.group === "mate")).toHaveLength(64);
  });
});

// ───────────────────────────── 英雄扩充：预留的肖像 id ─────────────────────────────

/** 英雄扩充（2026-09-27）的 18 位新航海士。 */
const HERO_MATES = [
  "shen_zhiwei",
  "luo_changfeng",
  "xie_qingyan",
  "qin_hongying",
  "diego_solano",
  "ines_pardo",
  "einar_lund",
  "liesbeth_devries",
  "thijs_vanoosten",
  "zahra_alsabbagh",
  "manu_ravaka",
  "griet_vanbeek",
  "maarten_vanderwal",
  "shadia_albahri",
  "leonor_castellar",
  "eivind_solberg",
  "mahina_tauvela",
  "yusuf_albunni",
] as const;
const HERO_CAPTAINS = Array.from({ length: 12 }, (_, k) => 13 + k);

describe("英雄扩充：主角外貌 13–24 与新航海士的肖像 id（画好之前预留，缺图回退程序头像）", () => {
  it("每位要么在清单里有图、要么已预留，不会两处都有；预留的只有主角外貌 13–24 与 mates.toml 里的航海士", () => {
    const drawn = new Set(PORTRAIT_ASSETS.map((a) => a.id));
    const pending = PENDING_PORTRAITS.map((p) => p.id);
    expect(new Set(pending).size).toBe(pending.length);
    for (const id of pending) expect(drawn.has(id), id).toBe(false);
    const keys = tomlField(matesToml, "mates", "key");
    for (const key of HERO_MATES) expect(keys).toContain(key);
    const ids = [...HERO_CAPTAINS.map((i) => `captain-${i}`), ...HERO_MATES.map((k) => `mate-${k}`)];
    for (const id of ids) expect(drawn.has(id) || pending.includes(id), id).toBe(true);
    // mates.toml 里的每一位都有图或已预留
    for (const key of keys) expect(drawn.has(`mate-${key}`) || pending.includes(`mate-${key}`), key).toBe(true);
    for (const p of PENDING_PORTRAITS) {
      if (p.group === "captain") expect(HERO_CAPTAINS).toContain(p.meta.index);
      else {
        expect(p.group).toBe("mate");
        expect(keys).toContain(p.meta.key);
      }
    }
  });

  it("英雄扩充的 30 位：男女各半、全部成年；约两成男子是清秀中性的美少年型；文化各有，瑶华人自然出现", () => {
    const hero = [...HERO_CAPTAINS.map((i) => captainAssetId(i)), ...HERO_MATES.map((key) => mateAssetId({ name: key, key }))].map((id) => portraitAsset(id));
    expect(hero.every(Boolean)).toBe(true);
    const metas = hero.map((a) => a?.meta);
    const male = metas.filter((m) => m?.gender === "male");
    expect(male).toHaveLength(15);
    for (const m of metas) expect(m?.age).toBeGreaterThanOrEqual(20);
    const andro = male.filter((m) => m?.androgynous).length;
    expect(andro / male.length).toBeGreaterThanOrEqual(0.15);
    expect(andro / male.length).toBeLessThanOrEqual(0.25);
    for (const m of metas) if (m?.androgynous) expect(m.gender).toBe("male");
    expect(new Set(metas.map((m) => m?.culture)).size).toBe(7);
    expect(metas.filter((m) => m?.culture === "eastern").length).toBeGreaterThanOrEqual(3);
  });

  it("预留的人物只有元数据、没有图：portraitSrc 为 null，头像组件回退到程序头像；航海士按 key 给出预留 id", () => {
    for (const p of PENDING_PORTRAITS) {
      expect(portraitAsset(p.id)?.meta).toEqual(p.meta);
      expect(isPendingPortrait(p.id)).toBe(true);
      expect(hasPortrait(p.id)).toBe(false);
      expect(portraitSrc(p.id)).toBeNull();
      expect(portraitSrc(p.id, "face")).toBeNull();
    }
    for (const a of PORTRAIT_ASSETS.slice(0, 3)) expect(isPendingPortrait(a.id)).toBe(false);
    for (const key of HERO_MATES) expect(mateAssetId({ name: key, key })).toBe(`mate-${key}`);
    const fallback = vi.fn(() => new Px(64, 64));
    for (const p of PENDING_PORTRAITS.slice(0, 3)) {
      const { unmount } = render(<PortraitArt asset={p.id} fallback={fallback} size={128} label={p.id} />);
      expect(screen.getByRole("img", { name: p.id }).tagName).toBe("CANVAS");
      unmount();
    }
    expect(fallback).toHaveBeenCalledTimes(Math.min(3, PENDING_PORTRAITS.length));
  });
});

// ───────────────────────────── 组件 ─────────────────────────────

describe("头像组件：图片优先，缺图回退程序头像", () => {
  const fallback = vi.fn(() => new Px(64, 64));
  beforeEach(() => fallback.mockClear());

  it("有素材时是平滑缩放的 <img>（小尺寸用脸部特写），给 label 时作为图片暴露给辅助技术", () => {
    render(<PortraitArt asset="captain-04" fallback={fallback} size={192} label="船长 甲 的头像" />);
    const img = screen.getByRole("img", { name: "船长 甲 的头像" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/portraits/captain-04.webp");
    expect(img).toHaveAttribute("aria-label", "船长 甲 的头像");
    expect(fallback).not.toHaveBeenCalled();
    render(<PortraitArt asset="captain-04" fallback={fallback} size={64} />);
    expect(document.querySelector('img[src="/portraits/face/captain-04.webp"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("没有这张图或图片加载失败时换成程序头像（同一个可访问名称）", () => {
    const { unmount } = render(<PortraitArt asset="nobody-here" fallback={fallback} size={128} label="甲" />);
    expect(screen.getByRole("img", { name: "甲" }).tagName).toBe("CANVAS");
    expect(fallback).toHaveBeenCalled();
    unmount();
    render(<PortraitArt asset="mate-lin_haiyan" fallback={fallback} size={128} label="乙" />);
    const img = screen.getByRole("img", { name: "乙" });
    expect(img.tagName).toBe("IMG");
    fireEvent.error(img);
    expect(screen.getByRole("img", { name: "乙" }).tagName).toBe("CANVAS");
    expect(screen.queryByRole("img", { name: "乙" })?.getAttribute("aria-label")).toBe("乙");
  });
});

// ───────────────────────────── 界面上的新人物位 ─────────────────────────────

describe("界面上的肖像与新增人物位", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("港口：掌柜是 128 像素的肖像；酒馆的传闻旁有情报贩子，势力办事处有君主与对方君主的小头像", async () => {
    installIpc({ port: () => ({ ...port, office: { ...port.office, relations: [{ other: 1, status: "peace", value: 20 }] } }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    const keeperCard = await screen.findByTestId("keeper");
    const face = keeperCard.querySelector("img.portrait-art") as HTMLImageElement;
    // 澄港市场的掌柜是 a / b / c 中的一位，按界面的地点列表分配：与同文化的兰城（最近的同文化地点）不是同一位，名字与头像同性别
    const places = keeperPlaces(statics.locations, statics.factions);
    const region = styleOf("cuilan", null);
    const who = keeperCast("chenggang", "market", region, places);
    expect(face.getAttribute("src")).toMatch(/^\/portraits\/keeper-mediterranean-market-[abc]\.webp$/);
    expect(face.getAttribute("src")).toBe(`/portraits/${who.asset}.webp`);
    expect(who.asset).not.toBe(keeperAssetId("lancheng", "market", region, places));
    expect(within(keeperCard).getByTestId("keeper-name").querySelector(".bi-name-main")).toHaveTextContent(npcNamePair("chenggang-market", isFemale(who.asset), region).zh);
    expect(face).toHaveAttribute("width", "128");

    await user.click(screen.getByRole("tab", { name: "酒馆" }));
    const inf = await screen.findByTestId("tavern-informant");
    expect(inf.dataset.portraitId).toMatch(/^informant-mediterranean-[ab]$/);
    expect(within(inf).getByText("情报贩子")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "势力办事处" }));
    const ruler = await screen.findByTestId("office-ruler");
    expect(ruler.dataset.portraitId).toBe("ruler-cuilan");
    expect(within(ruler).getByText("翠岚 · 国王")).toBeInTheDocument();
    // 外交关系里对方（金穗）君主的小头像；列表文字不变
    const rel = document.querySelector(".of-relation") as HTMLElement;
    expect(rel.querySelector('img[src="/portraits/face/ruler-jinsui.webp"]')).not.toBeNull();
    expect(rel).toHaveTextContent("金穗：和平（20）");
  });

  it("情报窗口的人物志列出各国君主与商会会长（头像是装饰，不增加具名图片）", async () => {
    render(<IntelPanel />);
    const roster = await screen.findByTestId("intel-roster");
    expect(within(roster).getByTestId("roster-ruler-cuilan").dataset.portraitId).toBe("ruler-cuilan");
    expect(within(roster).getByTestId("roster-ruler-jinsui").dataset.portraitId).toBe("ruler-jinsui");
    expect(within(roster).getByTestId("roster-company-0").dataset.portraitId).toBe("company-gull");
    expect(within(roster).getByText("海燕商会 · 会长")).toBeInTheDocument();
    expect(within(roster).queryAllByRole("img")).toHaveLength(0);
  });

  it("殖民地详情的标题旁是殖民地总管", async () => {
    installIpc();
    useGame.setState({ statics: colonialStatics, overview: colonialOverview });
    render(<ColoniesPanel />);
    const steward = await screen.findByTestId("colony-steward");
    expect(steward.dataset.portraitId).toBe(stewardAssetId(coloniesView.colonies[0].id));
    expect(within(steward).getByText("殖民地总管")).toBeInTheDocument();
  });

  it("海图上悬停别家船队：信息卡写明是哪家商会的船队，船长有肖像与名字", () => {
    render(<FleetHoverCard statics={statics} hover={{ index: 0, owner: "海燕商会", x: 100, y: 80 }} />);
    const card = screen.getByTestId("fleet-hover-card");
    expect(card).toHaveTextContent("海燕商会的船队");
    const badge = card.querySelector(".cast-row") as HTMLElement;
    expect(portraitAsset(badge.dataset.portraitId)?.group).toBe("rival");
    expect(card.style.left).toBe("114px");
  });
});
