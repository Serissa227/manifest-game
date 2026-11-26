// 图标的约束：严格 16×16、ICON_NAMES 全部可画、72 种商品各不相同、统一的描边风格、确定性。
import { describe, expect, it } from "vitest";
import { GOOD_ICON_KEYS, ICON_NAMES, SKY_ICON_NAMES, colonyBuildingIcon, drawGoodIcon, drawIcon, drawSkyIcon, drawWindIcon } from "./icons";
import { luma, type Px } from "./px";

/** data/goods.toml 中的全部 72 种商品（按文件顺序；第 39–71 种为航海历 1502 年追加，见 EXPANSION.md 第 6 节；末尾的古籍 books 为第六批追加，见 §11.3）。 */
const GOODS = [
  "grain", "timber", "cotton", "sugarcane", "iron_ore", "copper_ore", "wool", "cocoons", "tea", "spice",
  "fish", "salt", "fur", "grapes", "cocoa", "tobacco", "amber", "pearl", "coral", "sulfur",
  "saltpeter", "herbs", "indigo", "yarn", "cloth", "garments", "pig_iron", "ironware", "cannon", "raw_silk",
  "silk", "brocade", "sugar", "candy", "planks", "furniture", "gunpowder", "wine",
  "maize", "potato", "coffee", "vanilla", "cochineal", "dyewood", "mahogany", "flax", "hemp", "quinine",
  "gold_ore", "silver_ore", "gems", "quartz_sand", "star_crystal", "whale_oil", "kaolin", "relics", "rum", "chocolate",
  "cigars", "gold_ingot", "silver_ingot", "jewelry", "scarlet_cloth", "sailcloth", "rope", "medicine", "brass", "glass",
  "instruments", "crystal_lamp", "porcelain",
  "books",
];
/** data/colony.toml 的 14 种殖民建筑 key（按文件顺序，见 EXPANSION.md 第 4.1 节）。 */
const COLONY_BUILDINGS = [
  "farm", "plantation", "lumber", "mine", "fishery", "hunting", "distillery", "sugarmill", "storehouse", "fort", "chapel", "tavern", "dock", "housing",
];
const CATEGORIES = ["粮食", "原料", "矿产", "嗜好品", "奢侈品", "加工品", "军需"];

function same(a: Px, b: Px): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** 统一风格检查：16×16、透明底、有足够的内容、外轮廓是一圈深色描边、颜色克制。 */
function checkStyle(p: Px, label: string): void {
  expect([p.w, p.h], label).toEqual([16, 16]);
  let opaque = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = p.get(x, y);
      if (!(v & 0xff)) continue;
      opaque++;
      expect(v & 0xff, `${label} (${x},${y}) 不透明度`).toBe(0xff);
      const touchesAir = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => nx < 0 || ny < 0 || nx > 15 || ny > 15 || !p.isOpaque(nx, ny));
      // 挨着透明处（或画布边缘）的像素必须是深色描边
      if (touchesAir) expect(luma(v), `${label} (${x},${y}) 描边`).toBeLessThan(60);
    }
  }
  expect(opaque, `${label} 内容太少`).toBeGreaterThan(40);
  expect(opaque, `${label} 需要透明底`).toBeLessThan(256);
  expect(p.colorCount(), `${label} 颜色过多`).toBeLessThanOrEqual(20);
}

describe("界面图标", () => {
  it("ICON_NAMES 中的每一个都能画，严格 16×16，统一描边风格", () => {
    // 原有 47 个 + 殖民与探险 10 个 + 殖民建筑 14 个 + 行情预测 1 个
    expect(ICON_NAMES.length).toBe(74);
    expect(ICON_NAMES).toContain("forecast");
    for (const name of ICON_NAMES) checkStyle(drawIcon(name), name);
  });

  it("各图标互不相同，同名永远相同，返回的是副本", () => {
    const all = ICON_NAMES.map((n) => drawIcon(n));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(same(all[i], all[j]), `${ICON_NAMES[i]} / ${ICON_NAMES[j]}`).toBe(false);
    const a = drawIcon("coin");
    a.fill("#ff0000");
    expect(same(drawIcon("coin"), a)).toBe(false);
    expect(same(drawIcon("anchor"), drawIcon("anchor"))).toBe(true);
  });

  it("每种殖民建筑都有自己的图标（cb_ + key），未知建筑返回 null", () => {
    const names = COLONY_BUILDINGS.map((k) => colonyBuildingIcon(k));
    for (const [i, n] of names.entries()) {
      expect(n, COLONY_BUILDINGS[i]).toBe(`cb_${COLONY_BUILDINGS[i]}`);
      expect(ICON_NAMES).toContain(n);
    }
    expect(new Set(names).size).toBe(COLONY_BUILDINGS.length);
    expect(colonyBuildingIcon("no_such_building")).toBeNull();
    expect(colonyBuildingIcon("")).toBeNull();
    // 追加的殖民与探险图标都在
    for (const n of ["colony", "site", "discovery", "fame", "settler", "claim", "build", "population", "ai_event", "relic"]) expect(ICON_NAMES).toContain(n);
  });

  it("整体左上受光：左上半部平均亮度高于右下半部", () => {
    let tl = 0;
    let br = 0;
    for (const name of ICON_NAMES) {
      const p = drawIcon(name);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = p.get(x, y);
          if (!(v & 0xff) || luma(v) < 60) continue;
          if (x + y < 15) tl += luma(v);
          else if (x + y > 15) br += luma(v);
        }
      }
    }
    expect(tl).toBeGreaterThan(br);
  });
});

describe("商品图标", () => {
  it("goods.toml 的 72 种商品都有专属图标", () => {
    expect([...GOOD_ICON_KEYS].sort()).toEqual([...GOODS].sort());
    // 顺序与 goods.toml 一致
    expect([...GOOD_ICON_KEYS]).toEqual(GOODS);
  });

  it("72 种商品图标严格 16×16、风格统一、两两不同", () => {
    expect(GOODS.length).toBe(72);
    const icons = GOODS.map((k) => drawGoodIcon(k));
    icons.forEach((p, i) => checkStyle(p, GOODS[i]));
    for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) expect(same(icons[i], icons[j]), `${GOODS[i]} / ${GOODS[j]}`).toBe(false);
    // 专属图标不受 category 影响
    expect(same(drawGoodIcon("tea", "嗜好品"), drawGoodIcon("tea"))).toBe(true);
  });

  it("未知商品按类别画通用图样，类别也未知时画木箱", () => {
    const cats = CATEGORIES.map((c) => drawGoodIcon("some_new_good", c));
    cats.forEach((p, i) => checkStyle(p, CATEGORIES[i]));
    for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) expect(same(cats[i], cats[j])).toBe(false);
    const unknown = drawGoodIcon("some_new_good");
    checkStyle(unknown, "未知");
    expect(same(unknown, drawGoodIcon("another", "不存在的类别"))).toBe(true);
    // 原型链上的名字不会被当成商品
    checkStyle(drawGoodIcon("constructor"), "constructor");
    checkStyle(drawGoodIcon("toString", "constructor"), "toString");
  });
});

describe("天况与时刻图标（第四批）", () => {
  const SKIES = ["clear", "cloudy", "rain", "fog", "storm", "snow"];

  it("六种天况各有图标（sky_ + 天况），另有太阳、半日、月亮；全部严格 16×16、统一描边风格", () => {
    expect(SKY_ICON_NAMES.length).toBe(9);
    for (const s of SKIES) expect(SKY_ICON_NAMES).toContain(`sky_${s}`);
    for (const n of ["sun", "sun_half", "moon"]) expect(SKY_ICON_NAMES).toContain(n);
    for (const name of SKY_ICON_NAMES) checkStyle(drawSkyIcon(name), name);
  });

  it("天况与时刻图标两两不同，也不与任何界面图标相同；同名永远相同，返回副本", () => {
    const sky = SKY_ICON_NAMES.map((n) => drawSkyIcon(n));
    for (let i = 0; i < sky.length; i++) for (let j = i + 1; j < sky.length; j++) expect(same(sky[i], sky[j]), `${SKY_ICON_NAMES[i]} / ${SKY_ICON_NAMES[j]}`).toBe(false);
    const ui = ICON_NAMES.map((n) => drawIcon(n));
    for (const [i, p] of sky.entries()) for (const [j, q] of ui.entries()) expect(same(p, q), `${SKY_ICON_NAMES[i]} / ${ICON_NAMES[j]}`).toBe(false);
    const a = drawSkyIcon("moon");
    a.fill("#ff0000");
    expect(same(drawSkyIcon("moon"), a)).toBe(false);
    expect(same(drawSkyIcon("sky_fog"), drawSkyIcon("sky_fog"))).toBe(true);
  });

  it("整体左上受光：左上半部平均亮度高于右下半部", () => {
    let tl = 0;
    let br = 0;
    for (const name of SKY_ICON_NAMES) {
      const p = drawSkyIcon(name);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = p.get(x, y);
          if (!(v & 0xff) || luma(v) < 60) continue;
          if (x + y < 15) tl += luma(v);
          else if (x + y > 15) br += luma(v);
        }
      }
    }
    expect(tl).toBeGreaterThan(br);
  });

  it("风向小箭头：8 个方向各不相同、统一风格；方向按 8 取模，非法值按北", () => {
    const arrows = Array.from({ length: 8 }, (_, d) => drawWindIcon(d));
    arrows.forEach((p, d) => checkStyle(p, `wind-${d}`));
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(same(arrows[i], arrows[j]), `wind ${i} / ${j}`).toBe(false);
    expect(same(drawWindIcon(10), arrows[2])).toBe(true);
    expect(same(drawWindIcon(-1), arrows[7])).toBe(true);
    expect(same(drawWindIcon(Number.NaN), arrows[0])).toBe(true);
    // 箭头指向风的去向：朝东（2）的箭头右半边更重，朝北（0）的上半边更重
    const mass = (p: Px, side: "right" | "top") => {
      let a = 0;
      let b = 0;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          if (!p.isOpaque(x, y)) continue;
          const first = side === "right" ? x >= 8 : y < 8;
          if (first) a++;
          else b++;
        }
      return a - b;
    };
    expect(mass(arrows[2], "right")).toBeGreaterThan(0);
    expect(mass(arrows[6], "right")).toBeLessThan(0);
    expect(mass(arrows[0], "top")).toBeGreaterThan(0);
    expect(mass(arrows[4], "top")).toBeLessThan(0);
  });
});
