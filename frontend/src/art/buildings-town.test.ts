// 第九批的六种文化城镇风格（TownStyle：日本、明、奥斯曼、斯瓦希里、马来、玛雅）：画法、尺寸约定、确定性，
// townStyleOf 的回退表，以及经典的 styleOf 结果不变。
import { describe, expect, it } from "vitest";
import { FACILITIES } from "../store/game";
import {
  ARCH_STYLES,
  baseStyle,
  type BuildingOpts,
  COLONY_KEYS,
  CULTURE_BASE,
  CULTURE_STYLES,
  drawBuilding,
  drawCityWall,
  drawColonyBuilding,
  drawGate,
  drawHouse,
  drawLandmark,
  drawProp,
  drawSkyline,
  FACTION_STYLE,
  isCultureStyle,
  isTownStyle,
  KITS,
  type PropKind,
  STYLE_ALIASES,
  styleOf,
  TOWN_ALIASES,
  TOWN_STYLES,
  townStyleOf,
  townStyleOr,
} from "./buildings";
import { HOUSE_VARIANTS } from "./buildings/houses";
import { P } from "./palette";
import { type Px, rgba } from "./px";

const SUMMER: BuildingOpts = { season: 1 };
const WINTER: BuildingOpts = { season: 3, snow: true };
const NIGHT: BuildingOpts = { season: 1, lit: true };
const PROPS: readonly PropKind[] = ["crates", "barrels", "cart", "lamp", "flagpole", "well", "stall", "bench", "sacks", "anchor"];

function same(a: Px, b: Px): boolean {
  return a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
}

function standsOnGround(p: Px): boolean {
  for (let x = 0; x < p.w; x++) if (p.isOpaque(x, p.h - 1)) return true;
  return false;
}

function has(p: Px, color: string): boolean {
  const v = rgba(color);
  return p.data.some((c) => c === v);
}

/** 第九批之前的 STYLE_ALIASES（styleOf 的结果必须与它一致）。 */
const OLD_ALIASES: Readonly<Record<string, string>> = {
  iberian: "mediterranean",
  portuguese: "mediterranean",
  spanish: "mediterranean",
  italian: "mediterranean",
  venetian: "mediterranean",
  genoese: "mediterranean",
  greek: "mediterranean",
  atlantis: "mediterranean",
  low_countries: "lowland",
  flemish: "lowland",
  dutch: "lowland",
  english: "lowland",
  french: "lowland",
  hanseatic: "nordic",
  baltic: "nordic",
  scandinavian: "nordic",
  russian: "nordic",
  ottoman: "desert",
  arabic: "desert",
  maghreb: "desert",
  persian: "desert",
  mamluk: "desert",
  swahili: "desert",
  ethiopian: "desert",
  indian: "desert",
  mughal: "desert",
  malay: "islands",
  javanese: "islands",
  moluccan: "islands",
  siamese: "islands",
  burmese: "islands",
  philippine: "islands",
  polynesian: "islands",
  ming: "eastern",
  chinese: "eastern",
  japanese: "eastern",
  korean: "eastern",
  ryukyu: "eastern",
  jurchen: "eastern",
  maya: "frontier",
  aztec: "frontier",
  mesoamerican: "frontier",
  andean: "frontier",
  inca: "frontier",
  caribbean: "frontier",
  tupi: "frontier",
  colonial: "frontier",
  west_african: "frontier",
  kongo: "frontier",
};

/**
 * 之后追加的细名（只追加、不改上面任何一个已有名字的粗类）：
 * 地方特色第二阶段的大越与占婆（街景借明与马来，港口曲是《会安的河埠》），见 docs/DECISIONS.md。
 * 配乐的数据接线（2026-10-11）：寰宇的势力改写成文化细名以后，原来没有街景去处的几个名字（寰宇 [art] styles 里的 northern、arabian，
 * 势力新用的 ottoman_maghreb、edo、ndongo、hindustani、deccan、carnatic、malabar、sinhalese、chamorro）——
 * 都指向那些势力原来用的风格，粗类与原来相同。
 */
const ADDED_ALIASES: Readonly<Record<string, string>> = {
  vietnamese: "eastern",
  dai_viet: "eastern",
  champa: "islands",
  northern: "nordic",
  arabian: "desert",
  ottoman_maghreb: "desert",
  edo: "desert",
  ndongo: "desert",
  hindustani: "desert",
  deccan: "desert",
  carnatic: "desert",
  malabar: "desert",
  sinhalese: "desert",
  chamorro: "islands",
};

describe("城镇风格（TownStyle）与回退", () => {
  it("十三种城镇风格 = 七种经典风格 + 六种文化风格；每种都有自己的套件", () => {
    expect(CULTURE_STYLES).toEqual(["japanese", "ming", "ottoman", "swahili", "malay", "maya"]);
    expect(TOWN_STYLES).toEqual([...ARCH_STYLES, ...CULTURE_STYLES]);
    for (const s of TOWN_STYLES) {
      expect(isTownStyle(s)).toBe(true);
      expect(KITS[s].style, s).toBe(s);
    }
    for (const s of CULTURE_STYLES) expect(isCultureStyle(s)).toBe(true);
    for (const s of ARCH_STYLES) expect(isCultureStyle(s)).toBe(false);
    for (const bad of ["", "klingon", "constructor", "toString", null, undefined, 3]) {
      expect(isTownStyle(bad)).toBe(false);
      expect(isCultureStyle(bad)).toBe(false);
    }
  });

  it("文化风格各映射到一个粗分的建筑风格（日本与明→东方，奥斯曼与斯瓦希里→沙漠，马来→群岛，玛雅→开拓者）", () => {
    expect(CULTURE_BASE).toEqual({ japanese: "eastern", ming: "eastern", ottoman: "desert", swahili: "desert", malay: "islands", maya: "frontier" });
    for (const s of ARCH_STYLES) expect(baseStyle(s)).toBe(s);
    for (const s of CULTURE_STYLES) expect(baseStyle(s)).toBe(CULTURE_BASE[s]);
  });

  it("townStyleOf：文化风格画成自己的街景，其余细名回退到最近的城镇风格", () => {
    for (const s of TOWN_STYLES) expect(townStyleOf("nowhere", s)).toBe(s);
    const expected: Record<string, string> = {
      indian: "ottoman",
      mughal: "ottoman",
      andean: "maya",
      inca: "maya",
      aztec: "maya",
      mesoamerican: "maya",
      korean: "ming",
      ryukyu: "ming",
      chinese: "ming",
      javanese: "malay",
      moluccan: "malay",
      siamese: "malay",
      burmese: "malay",
      philippine: "malay",
      persian: "desert",
      arabic: "desert",
      maghreb: "desert",
      mamluk: "desert",
      ethiopian: "desert",
      iberian: "mediterranean",
      italian: "mediterranean",
      venetian: "mediterranean",
      dutch: "lowland",
      hanseatic: "nordic",
      polynesian: "islands",
      jurchen: "eastern",
      caribbean: "frontier",
      colonial: "frontier",
    };
    for (const [name, town] of Object.entries(expected)) expect(townStyleOf("nowhere", name), name).toBe(town);
    // 每个细名都回退到合法的城镇风格，文化风格自己的名字不在表里
    for (const [name, town] of Object.entries(TOWN_ALIASES)) {
      expect(isTownStyle(town), name).toBe(true);
      expect(isTownStyle(name), name).toBe(false);
    }
    // 认不出的风格名按势力 key 映射，未知势力按地中海
    for (const [k, s] of Object.entries(FACTION_STYLE)) expect(townStyleOf(k, "klingon")).toBe(s);
    expect(townStyleOf("nobody", "klingon")).toBe("mediterranean");
    expect(townStyleOf(undefined, null)).toBe("mediterranean");
    expect(townStyleOf("constructor", "constructor")).toBe("mediterranean");
    expect(townStyleOf("yaohua")).toBe("eastern");
    expect(townStyleOr("javanese", "frontier")).toBe("malay");
    expect(townStyleOr("klingon", "frontier")).toBe("frontier");
    expect(townStyleOr(undefined, "frontier")).toBe("frontier");
  });

  it("styleOf 的结果与第九批之前完全一样（经典世界与按 ArchStyle 工作的模块不受影响）", () => {
    for (const s of ARCH_STYLES) expect(styleOf("nowhere", s)).toBe(s);
    for (const [k, s] of Object.entries(FACTION_STYLE)) expect(styleOf(k)).toBe(s);
    for (const [name, old] of Object.entries(OLD_ALIASES)) expect(styleOf("nowhere", name), name).toBe(old);
    // 追加的细名不与已有的重名；整张表 = 第九批之前的 + 追加的
    for (const name of Object.keys(ADDED_ALIASES)) expect(Object.prototype.hasOwnProperty.call(OLD_ALIASES, name), name).toBe(false);
    for (const [name, added] of Object.entries(ADDED_ALIASES)) expect(styleOf("nowhere", name), name).toBe(added);
    expect(STYLE_ALIASES).toEqual({ ...OLD_ALIASES, ...ADDED_ALIASES });
    // 经典世界的势力：城镇风格就是粗分风格
    for (const k of [...Object.keys(FACTION_STYLE), "nowhere", ""]) expect(townStyleOf(k)).toBe(styleOf(k));
    for (const s of ARCH_STYLES) expect(townStyleOf("cuilan", s)).toBe(styleOf("cuilan", s));
    // 文化风格的粗类就是 styleOf
    for (const s of CULTURE_STYLES) expect(styleOf("nowhere", s)).toBe(baseStyle(townStyleOf("nowhere", s)));
  });
});

describe("文化风格的设施建筑", () => {
  it("每种设施 × 文化风格都能画：尺寸在 48–110 × 40–100 之内、落地、裁边、同参数完全相同", () => {
    for (const style of CULTURE_STYLES) {
      for (const fac of FACILITIES) {
        for (const o of [SUMMER, WINTER, NIGHT, { season: 0 }, { season: 2 }]) {
          const p = drawBuilding(fac, style, o);
          const tag = `${fac}/${style}/${JSON.stringify(o)} ${p.w}×${p.h}`;
          expect(p.w, tag).toBeGreaterThanOrEqual(48);
          expect(p.w, tag).toBeLessThanOrEqual(110);
          expect(p.h, tag).toBeGreaterThanOrEqual(40);
          expect(p.h, tag).toBeLessThanOrEqual(100);
          expect(standsOnGround(p), tag).toBe(true);
          expect(p.bounds(), tag).toEqual({ x: 0, y: 0, w: p.w, h: p.h });
          expect(same(p, drawBuilding(fac, style, o)), tag).toBe(true);
        }
      }
    }
  });

  it("积雪版用到雪色，亮灯版透出灯光色，都与普通版不同", () => {
    for (const style of CULTURE_STYLES) {
      for (const fac of FACILITIES) {
        const plain = drawBuilding(fac, style, { season: 3 });
        const snow = drawBuilding(fac, style, WINTER);
        expect(same(plain, snow), `${fac}/${style}`).toBe(false);
        expect(has(snow, P.snow[3]), `${fac}/${style}`).toBe(true);
        const day = drawBuilding(fac, style, SUMMER);
        const lit = drawBuilding(fac, style, NIGHT);
        expect(same(day, lit), `${fac}/${style}`).toBe(false);
        expect(has(lit, P.lamp[1]), `${fac}/${style}`).toBe(true);
      }
    }
  });

  it("真正画出来的：十三种风格的同一设施互不相同（与粗分风格的画法也不同）；同一风格的九种设施互不相同", () => {
    for (const fac of FACILITIES) {
      const imgs = TOWN_STYLES.map((s) => drawBuilding(fac, s, SUMMER));
      for (let i = 0; i < imgs.length; i++) {
        for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${fac} ${TOWN_STYLES[i]}/${TOWN_STYLES[j]}`).toBe(false);
      }
    }
    for (const style of CULTURE_STYLES) {
      const imgs = FACILITIES.map((f) => drawBuilding(f, style, SUMMER));
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j])).toBe(false);
    }
  });

  it("期货交易所（钟楼）是同一风格里最高的设施", () => {
    for (const style of CULTURE_STYLES) {
      const ex = drawBuilding("exchange", style, SUMMER).h;
      for (const f of FACILITIES) if (f !== "exchange") expect(drawBuilding(f, style, SUMMER).h, `${f}/${style}`).toBeLessThan(ex);
    }
  });

  it("各文化的标志材质：灰瓦与藏青暖帘、红瓦与红对联、铅灰穹顶、白灰墙与铜钉、黑色棕榈纤维屋顶、赭红与绿松石", () => {
    const market = (s: (typeof CULTURE_STYLES)[number]) => drawBuilding("market", s, SUMMER);
    const office = (s: (typeof CULTURE_STYLES)[number]) => drawBuilding("office", s, SUMMER);
    // 日本：灰瓦（燻瓦）与暖帘的藏青
    expect(has(market("japanese"), P.stone[2])).toBe(true);
    expect(has(drawBuilding("tavern", "japanese", SUMMER), P.cloth.navy[1])).toBe(true);
    // 明：红瓦与门边的红对联
    expect(has(market("ming"), P.brick[2])).toBe(true);
    expect(has(drawBuilding("tavern", "ming", SUMMER), P.red[2])).toBe(true);
    // 奥斯曼：正式建筑上的铅灰穹顶
    expect(has(office("ottoman"), P.slate[2])).toBe(true);
    expect(has(market("ottoman"), P.brick[3])).toBe(true);
    // 斯瓦希里：白灰墙、雕花门上的铜钉、墙上的青花瓷碗
    expect(has(market("swahili"), P.white)).toBe(true);
    expect(has(drawBuilding("tavern", "swahili", SUMMER), P.gold[3])).toBe(true);
    expect(has(market("swahili"), P.cloth.blue[1])).toBe(true);
    // 马来：王宫式的黑色棕榈纤维屋顶，王家的黄
    expect(has(office("malay"), P.cloth.black[1])).toBe(true);
    expect(has(market("malay"), P.gold[2])).toBe(true);
    // 玛雅：赭红与绿松石
    expect(has(market("maya"), P.brick[2])).toBe(true);
    expect(has(market("maya"), P.teal[2])).toBe(true);
  });

  it("单张建筑生成足够快（平均 < 5 ms）", () => {
    for (const f of FACILITIES) drawBuilding(f, "japanese", SUMMER);
    const t0 = performance.now();
    let n = 0;
    for (const style of CULTURE_STYLES) {
      for (const fac of FACILITIES) {
        drawBuilding(fac, style, { season: 3, snow: true, lit: true });
        n++;
      }
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe("文化风格的民居", () => {
  it("每种文化风格 8 种互不相同的变体，宽 28–48、落地，variant 取模，1–3 层高度不同", () => {
    for (const style of CULTURE_STYLES) {
      const imgs = Array.from({ length: HOUSE_VARIANTS }, (_, v) => drawHouse(style, v, SUMMER));
      for (const [v, p] of imgs.entries()) {
        const tag = `${style}#${v} ${p.w}×${p.h}`;
        expect(p.w, tag).toBeGreaterThanOrEqual(28);
        expect(p.w, tag).toBeLessThanOrEqual(48);
        expect(standsOnGround(p), tag).toBe(true);
      }
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${style} ${i}/${j}`).toBe(false);
      const a = drawHouse(style, 2, SUMMER);
      const b = drawHouse(style, 2 + HOUSE_VARIANTS, SUMMER);
      expect([b.w, b.h]).toEqual([a.w, a.h]);
      expect(drawHouse(style, -1, SUMMER).w).toBeGreaterThanOrEqual(28);
      expect(same(drawHouse(style, 3, WINTER), drawHouse(style, 3, WINTER))).toBe(true);
      expect(same(drawHouse(style, 3, WINTER), drawHouse(style, 3, { season: 3 }))).toBe(false);
      const hs = imgs.map((p) => p.h);
      expect(Math.max(...hs) - Math.min(...hs), style).toBeGreaterThanOrEqual(20);
      // 与粗分风格的民居不同
      expect(same(a, drawHouse(CULTURE_BASE[style], 2, SUMMER))).toBe(false);
    }
  });
});

describe("文化风格的远景、城墙、城门与地标", () => {
  it("远景宽度任意、高 64，底边连成一片，可无缝重复；雪与灯光改变画面", () => {
    for (const style of CULTURE_STYLES) {
      for (const w of [37, 160, 333]) {
        const p = drawSkyline(style, w, SUMMER);
        expect([p.w, p.h]).toEqual([w, 64]);
        for (let x = 0; x < w; x++) expect(p.isOpaque(x, p.h - 1), `${style} ${w} x=${x}`).toBe(true);
      }
      const p = drawSkyline(style, 200, SUMMER);
      const top = (x: number) => {
        for (let y = 0; y < p.h; y++) if (p.isOpaque(x, y)) return y;
        return p.h;
      };
      expect(Math.abs(top(0) - top(p.w - 1)), style).toBeLessThanOrEqual(24);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, SUMMER))).toBe(true);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, { season: 3, snow: true }))).toBe(false);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, NIGHT))).toBe(false);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(CULTURE_BASE[style], 160, SUMMER))).toBe(false);
    }
  });

  it("城墙宽度任意、可无缝重复、底边落地；极窄或无效宽度也不出错", () => {
    for (const style of CULTURE_STYLES) {
      for (const w of [50, 150, 301]) {
        const p = drawCityWall(style, w, SUMMER);
        expect(p.w).toBe(w);
        expect(p.h).toBeGreaterThanOrEqual(40);
        for (let x = 0; x < w; x++) expect(p.isOpaque(x, p.h - 1)).toBe(true);
        for (let y = p.h - 20; y < p.h; y++) {
          expect(p.isOpaque(0, y), `${style} ${w} y=${y}`).toBe(true);
          expect(p.isOpaque(w - 1, y), `${style} ${w} y=${y}`).toBe(true);
        }
      }
      expect(same(drawCityWall(style, 150, SUMMER), drawCityWall(style, 150, SUMMER))).toBe(true);
      expect(same(drawCityWall(style, 150, SUMMER), drawCityWall(style, 150, WINTER))).toBe(false);
      expect(same(drawCityWall(style, 150, SUMMER), drawCityWall(CULTURE_BASE[style], 150, SUMMER))).toBe(false);
      for (const w of [1, 3, 7, 15]) {
        expect(drawSkyline(style, w, { season: 3, snow: true, lit: true }).w).toBe(w);
        expect(drawCityWall(style, w, WINTER).w).toBe(w);
      }
      expect(drawSkyline(style, Number.NaN, SUMMER).w).toBe(1);
      expect(drawCityWall(style, Number.NaN, SUMMER).w).toBe(1);
    }
  });

  it("每种文化风格都有城门与地标：落地、确定，冬季积雪改变画面，地标高于 90", () => {
    for (const style of CULTURE_STYLES) {
      const gate = drawGate(style, SUMMER);
      expect(gate.w).toBeGreaterThanOrEqual(40);
      expect(gate.h).toBeGreaterThanOrEqual(40);
      expect(standsOnGround(gate)).toBe(true);
      expect(same(drawGate(style, SUMMER), gate)).toBe(true);
      expect(same(drawGate(style, WINTER), gate)).toBe(false);
      expect(same(drawGate(CULTURE_BASE[style], SUMMER), gate)).toBe(false);
      const lm = drawLandmark(style, SUMMER);
      expect(lm.h, style).toBeGreaterThanOrEqual(90);
      expect(standsOnGround(lm)).toBe(true);
      expect(same(drawLandmark(style, SUMMER), lm)).toBe(true);
      expect(same(drawLandmark(style, WINTER), lm)).toBe(false);
      expect(same(drawLandmark(style, NIGHT), lm)).toBe(false);
    }
    // 十三种地标的轮廓尺寸互不相同
    const dims = new Set(TOWN_STYLES.map((s) => `${drawLandmark(s, SUMMER).w}×${drawLandmark(s, SUMMER).h}`));
    expect(dims.size).toBe(TOWN_STYLES.length);
  });
});

describe("文化风格的街道小物件", () => {
  it("全部物件 × 文化风格都能生成、落地、确定；街灯、水井、长凳与车各有自己的样子", () => {
    for (const style of CULTURE_STYLES) {
      for (const kind of PROPS) {
        const p = drawProp(kind, style, { variant: 1 });
        expect(p.w, `${kind}/${style}`).toBeGreaterThanOrEqual(4);
        expect(p.h, `${kind}/${style}`).toBeGreaterThanOrEqual(4);
        expect(p.w, `${kind}/${style}`).toBeLessThanOrEqual(40);
        expect(standsOnGround(p), `${kind}/${style}`).toBe(true);
        expect(same(p, drawProp(kind, style, { variant: 1 }))).toBe(true);
      }
      for (const kind of ["lamp", "well", "bench", "cart"] as const) {
        expect(same(drawProp(kind, style, {}), drawProp(kind, CULTURE_BASE[style], {})), `${kind}/${style}`).toBe(false);
      }
      // 街灯夜里点亮
      const lit = drawProp("lamp", style, { lit: true });
      expect(same(lit, drawProp("lamp", style, {})), style).toBe(false);
      expect(has(lit, P.lamp[2]) || has(lit, P.lamp[1]), style).toBe(true);
      // 车换一种装法
      expect(same(drawProp("cart", style, { variant: 0 }), drawProp("cart", style, { variant: 1 })), style).toBe(false);
    }
  });

  it("旗杆使用传入的势力色，写错时退回风格默认旗色", () => {
    for (const style of CULTURE_STYLES) {
      expect(has(drawProp("flagpole", style, { flag: "#c0392b" }), "#c0392b")).toBe(true);
      expect(() => drawProp("flagpole", style, { flag: "not-a-color" })).not.toThrow();
      expect(has(drawProp("flagpole", style, { flag: "not-a-color" }), KITS[style].flag[1])).toBe(true);
    }
  });
});

describe("文化风格的殖民建筑（3 级用所有者的风格）", () => {
  it("14 种建筑 × 1–3 级都能画：尺寸有界、落地、裁边、确定；3 级与开拓者不同", () => {
    for (const style of CULTURE_STYLES) {
      for (const key of COLONY_KEYS) {
        for (const lv of [1, 2, 3]) {
          const p = drawColonyBuilding(key, lv, style, SUMMER);
          const tag = `${key}/${lv}/${style} ${p.w}×${p.h}`;
          expect(p.w, tag).toBeGreaterThanOrEqual(24);
          expect(p.w, tag).toBeLessThanOrEqual(120);
          expect(p.h, tag).toBeGreaterThanOrEqual(10);
          expect(p.h, tag).toBeLessThanOrEqual(100);
          expect(standsOnGround(p), tag).toBe(true);
          expect(p.bounds(), tag).toEqual({ x: 0, y: 0, w: p.w, h: p.h });
          expect(same(p, drawColonyBuilding(key, lv, style, SUMMER)), tag).toBe(true);
        }
      }
      expect(same(drawColonyBuilding("housing", 3, style, SUMMER), drawColonyBuilding("housing", 3, "frontier", SUMMER)), style).toBe(false);
    }
  });

  it("等级越高越大：面积逐级增大，宽度不减", () => {
    for (const style of CULTURE_STYLES) {
      for (const key of COLONY_KEYS) {
        const ps = [1, 2, 3].map((lv) => drawColonyBuilding(key, lv, style, SUMMER));
        for (let i = 1; i < 3; i++) {
          const tag = `${key}/${style} ${ps[i - 1].w}×${ps[i - 1].h} → ${ps[i].w}×${ps[i].h}`;
          expect(ps[i].w * ps[i].h, tag).toBeGreaterThan(ps[i - 1].w * ps[i - 1].h);
          expect(ps[i].w, tag).toBeGreaterThanOrEqual(ps[i - 1].w);
        }
      }
    }
  });
});
