import { describe, expect, it } from "vitest";
import { FACILITIES } from "../store/game";
import {
  ARCH_STYLES,
  COLONY_KEYS,
  DOCK_DECK_FROM_BOTTOM,
  type BuildingOpts,
  drawBuilding,
  drawColonyBuilding,
  drawnStyle,
  drawCityWall,
  drawGate,
  drawHouse,
  drawLandmark,
  drawProp,
  drawSkyline,
  FACTION_STYLE,
  type PropKind,
  styleOf,
} from "./buildings";
import { EMBLEMS } from "./buildings/emblems";
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

/** 底边一行至少有一个不透明像素（建筑“站”在地面线上）。 */
function standsOnGround(p: Px): boolean {
  for (let x = 0; x < p.w; x++) if (p.isOpaque(x, p.h - 1)) return true;
  return false;
}

function has(p: Px, color: string): boolean {
  const v = rgba(color);
  return p.data.some((c) => c === v);
}

describe("建筑风格", () => {
  it("styleOf：势力数据的 style 合法时优先，否则按势力 key 映射，未知势力按地中海处理", () => {
    for (const s of ARCH_STYLES) expect(styleOf("nowhere", s)).toBe(s);
    for (const [k, s] of Object.entries(FACTION_STYLE)) expect(styleOf(k)).toBe(s);
    expect(styleOf("cuilan")).toBe("mediterranean");
    expect(styleOf("yaohua")).toBe("eastern");
    expect(styleOf("jinsui", "eastern")).toBe("eastern");
    expect(styleOf("jinsui", "not-a-style")).toBe("lowland");
    expect(styleOf("constructor")).toBe("mediterranean");
    expect(styleOf(undefined)).toBe("mediterranean");
    expect(styleOf("")).toBe("mediterranean");
    expect(styleOf("nowhere")).toBe("mediterranean");
  });

  it("九种设施的招牌图样各不相同、都是 9×9", () => {
    const seen = new Set<string>();
    for (const f of FACILITIES) {
      const rows = EMBLEMS[f];
      expect(rows).toHaveLength(9);
      for (const r of rows) expect(r).toHaveLength(9);
      seen.add(rows.join("/"));
    }
    expect(seen.size).toBe(FACILITIES.length);
  });
});

describe("设施建筑", () => {
  it("每种设施 × 风格都能生成，尺寸在 48–110 × 40–100 之内，底边落地", () => {
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        for (const o of [SUMMER, WINTER, NIGHT]) {
          const p = drawBuilding(fac, style, o);
          const tag = `${fac}/${style}/${JSON.stringify(o)} ${p.w}×${p.h}`;
          expect(p.w, tag).toBeGreaterThanOrEqual(48);
          expect(p.w, tag).toBeLessThanOrEqual(110);
          expect(p.h, tag).toBeGreaterThanOrEqual(40);
          expect(p.h, tag).toBeLessThanOrEqual(100);
          expect(standsOnGround(p), tag).toBe(true);
          // 裁过边：四条边上都有像素
          expect(p.bounds(), tag).toEqual({ x: 0, y: 0, w: p.w, h: p.h });
        }
      }
    }
  });

  it("同参数结果完全相同（确定性）", () => {
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        expect(same(drawBuilding(fac, style, WINTER), drawBuilding(fac, style, WINTER))).toBe(true);
        expect(same(drawBuilding(fac, style, NIGHT), drawBuilding(fac, style, NIGHT))).toBe(true);
      }
    }
  });

  it("积雪版与普通版不同，积雪版用到雪色", () => {
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        const plain = drawBuilding(fac, style, { season: 3 });
        const snow = drawBuilding(fac, style, WINTER);
        expect(same(plain, snow), `${fac}/${style}`).toBe(false);
        expect(has(snow, P.snow[3]), `${fac}/${style}`).toBe(true);
      }
    }
  });

  it("亮灯版与白天不同，窗里透出灯光色", () => {
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        const day = drawBuilding(fac, style, SUMMER);
        const lit = drawBuilding(fac, style, NIGHT);
        expect(same(day, lit), `${fac}/${style}`).toBe(false);
        expect(has(lit, P.lamp[1]), `${fac}/${style}`).toBe(true);
      }
    }
  });

  it("五种风格的同一设施互不相同；同一风格的九种设施互不相同", () => {
    for (const fac of FACILITIES) {
      const imgs = ARCH_STYLES.map((s) => drawBuilding(fac, s, SUMMER));
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j])).toBe(false);
    }
    for (const style of ARCH_STYLES) {
      const imgs = FACILITIES.map((f) => drawBuilding(f, style, SUMMER));
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j])).toBe(false);
    }
  });

  it("期货交易所（钟楼）是同一风格里最高的设施", () => {
    for (const style of ARCH_STYLES) {
      const ex = drawBuilding("exchange", style, SUMMER).h;
      for (const f of FACILITIES) if (f !== "exchange") expect(drawBuilding(f, style, SUMMER).h, `${f}/${style}`).toBeLessThan(ex);
    }
  });

  it("季节会改变装饰（春秋两季的建筑不完全相同）", () => {
    let differs = 0;
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        if (!same(drawBuilding(fac, style, { season: 0 }), drawBuilding(fac, style, { season: 2 }))) differs++;
      }
    }
    expect(differs).toBeGreaterThan(20);
  });

  it("单张建筑生成足够快（平均 < 5 ms）", () => {
    // 先热身一轮，再计时
    for (const f of FACILITIES) drawBuilding(f, "eastern", SUMMER);
    const t0 = performance.now();
    let n = 0;
    for (const style of ARCH_STYLES) {
      for (const fac of FACILITIES) {
        drawBuilding(fac, style, { season: 3, snow: true, lit: true });
        n++;
      }
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe("民居", () => {
  it("每种风格至少 6 种互不相同的变体，宽 28–48，variant 取模", () => {
    expect(HOUSE_VARIANTS).toBeGreaterThanOrEqual(6);
    for (const style of ARCH_STYLES) {
      const imgs = Array.from({ length: HOUSE_VARIANTS }, (_, v) => drawHouse(style, v, SUMMER));
      for (const [v, p] of imgs.entries()) {
        const tag = `${style}#${v} ${p.w}×${p.h}`;
        expect(p.w, tag).toBeGreaterThanOrEqual(28);
        expect(p.w, tag).toBeLessThanOrEqual(48);
        expect(standsOnGround(p), tag).toBe(true);
      }
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${style} ${i}/${j}`).toBe(false);
      // 取模：形体一致（配色可以轮换）
      const a = drawHouse(style, 2, SUMMER);
      const b = drawHouse(style, 2 + HOUSE_VARIANTS, SUMMER);
      expect([b.w, b.h]).toEqual([a.w, a.h]);
      const neg = drawHouse(style, -1, SUMMER);
      expect(neg.w).toBeGreaterThanOrEqual(28);
      expect(same(drawHouse(style, 3, WINTER), drawHouse(style, 3, WINTER))).toBe(true);
      expect(same(drawHouse(style, 3, WINTER), drawHouse(style, 3, { season: 3 }))).toBe(false);
    }
  });

  it("有 1–3 层不同高度的民居", () => {
    for (const style of ARCH_STYLES) {
      const hs = Array.from({ length: HOUSE_VARIANTS }, (_, v) => drawHouse(style, v, SUMMER).h);
      expect(Math.max(...hs) - Math.min(...hs), style).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("远景、城墙与城门", () => {
  it("远景宽度任意、高 64，底边连成一片；雪与灯光改变画面", () => {
    for (const style of ARCH_STYLES) {
      for (const w of [37, 160, 333]) {
        const p = drawSkyline(style, w, SUMMER);
        expect([p.w, p.h]).toEqual([w, 64]);
        for (let x = 0; x < w; x++) expect(p.isOpaque(x, p.h - 1)).toBe(true);
      }
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, SUMMER))).toBe(true);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, { season: 3, snow: true }))).toBe(false);
      expect(same(drawSkyline(style, 160, SUMMER), drawSkyline(style, 160, NIGHT))).toBe(false);
    }
  });

  it("远景可无缝重复：左右两端的剪影高度相接", () => {
    for (const style of ARCH_STYLES) {
      const p = drawSkyline(style, 200, SUMMER);
      const top = (x: number) => {
        for (let y = 0; y < p.h; y++) if (p.isOpaque(x, y)) return y;
        return p.h;
      };
      // 取模绘制保证跨界的元素两边都画到：首尾两列的轮廓高度差不会像被截断那样悬殊
      expect(Math.abs(top(0) - top(p.w - 1)), style).toBeLessThanOrEqual(24);
    }
  });

  it("城墙宽度任意、可无缝重复，底边落地", () => {
    for (const style of ARCH_STYLES) {
      for (const w of [50, 150, 301]) {
        const p = drawCityWall(style, w, SUMMER);
        expect(p.w).toBe(w);
        expect(p.h).toBeGreaterThanOrEqual(40);
        for (let x = 0; x < w; x++) expect(p.isOpaque(x, p.h - 1)).toBe(true);
        // 墙体最下面 20 行首尾两列都是实心的（拼接处没有缝）
        for (let y = p.h - 20; y < p.h; y++) {
          expect(p.isOpaque(0, y)).toBe(true);
          expect(p.isOpaque(w - 1, y)).toBe(true);
        }
      }
      expect(same(drawCityWall(style, 150, SUMMER), drawCityWall(style, 150, SUMMER))).toBe(true);
      expect(same(drawCityWall(style, 150, SUMMER), drawCityWall(style, 150, WINTER))).toBe(false);
    }
  });

  it("极窄或无效宽度也不出错：返回请求的宽度（无效时为 1）", () => {
    for (const style of ARCH_STYLES) {
      for (const w of [1, 3, 7, 15]) {
        expect(drawSkyline(style, w, { season: 3, snow: true, lit: true }).w).toBe(w);
        expect(drawCityWall(style, w, WINTER).w).toBe(w);
      }
      expect(drawSkyline(style, Number.NaN, SUMMER).w).toBe(1);
      expect(drawCityWall(style, Number.NaN, SUMMER).w).toBe(1);
    }
  });

  it("每种风格都有城门与地标，地标比设施高", () => {
    for (const style of ARCH_STYLES) {
      const gate = drawGate(style, SUMMER);
      expect(gate.w).toBeGreaterThanOrEqual(40);
      expect(gate.h).toBeGreaterThanOrEqual(40);
      expect(standsOnGround(gate)).toBe(true);
      expect(same(drawGate(style, WINTER), gate)).toBe(false);
      const lm = drawLandmark(style, SUMMER);
      expect(lm.h, style).toBeGreaterThanOrEqual(90);
      expect(standsOnGround(lm)).toBe(true);
      expect(same(drawLandmark(style, SUMMER), lm)).toBe(true);
      expect(same(drawLandmark(style, WINTER), lm)).toBe(false);
    }
    const heights = new Set(ARCH_STYLES.map((s) => `${drawLandmark(s, SUMMER).w}×${drawLandmark(s, SUMMER).h}`));
    expect(heights.size).toBe(ARCH_STYLES.length);
  });
});

describe("街道小物件", () => {
  it("全部物件 × 风格都能生成、落地、确定", () => {
    for (const style of ARCH_STYLES) {
      for (const kind of PROPS) {
        const p = drawProp(kind, style, { variant: 1 });
        expect(p.w, `${kind}/${style}`).toBeGreaterThanOrEqual(4);
        expect(p.h, `${kind}/${style}`).toBeGreaterThanOrEqual(4);
        expect(p.w).toBeLessThanOrEqual(40);
        expect(standsOnGround(p), `${kind}/${style}`).toBe(true);
        expect(same(p, drawProp(kind, style, { variant: 1 }))).toBe(true);
      }
    }
  });

  it("旗杆使用传入的势力色", () => {
    const p = drawProp("flagpole", "lowland", { flag: "#c0392b" });
    expect(has(p, "#c0392b")).toBe(true);
    expect(has(drawProp("flagpole", "lowland", { flag: "#2e86c1" }), "#c0392b")).toBe(false);
  });

  it("旗色写错时退回风格默认旗色，不抛错", () => {
    expect(() => drawProp("flagpole", "desert", { flag: "not-a-color" })).not.toThrow();
    expect(has(drawProp("flagpole", "desert", { flag: "not-a-color" }), P.red[2])).toBe(true);
  });

  it("variant 改变摆法", () => {
    for (const kind of ["crates", "barrels", "sacks"] as const) {
      expect(same(drawProp(kind, "eastern", { variant: 0 }), drawProp(kind, "eastern", { variant: 1 }))).toBe(false);
    }
  });
});

describe("新风格：地中海与开拓者", () => {
  const NEW = ["mediterranean", "frontier"] as const;

  it("九种设施尺寸在 48–110 × 40–100 之内、落地、裁边，同参数完全相同", () => {
    for (const style of NEW) {
      for (const fac of FACILITIES) {
        for (const o of [SUMMER, WINTER, NIGHT, { season: 2 }]) {
          const p = drawBuilding(fac, style, o);
          const tag = `${fac}/${style} ${p.w}×${p.h}`;
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

  it("有自己的画法：与原先借用的低地、北地画法都不相同", () => {
    for (const fac of FACILITIES) {
      expect(same(drawBuilding(fac, "mediterranean", SUMMER), drawBuilding(fac, "lowland", SUMMER)), fac).toBe(false);
      expect(same(drawBuilding(fac, "frontier", SUMMER), drawBuilding(fac, "nordic", SUMMER)), fac).toBe(false);
    }
    for (const v of [0, 3, 5]) {
      expect(same(drawHouse("mediterranean", v, SUMMER), drawHouse("lowland", v, SUMMER))).toBe(false);
      expect(same(drawHouse("frontier", v, SUMMER), drawHouse("nordic", v, SUMMER))).toBe(false);
    }
    for (const [a, b] of [
      ["mediterranean", "lowland"],
      ["frontier", "nordic"],
    ] as const) {
      expect(same(drawSkyline(a, 160, SUMMER), drawSkyline(b, 160, SUMMER))).toBe(false);
      expect(same(drawCityWall(a, 150, SUMMER), drawCityWall(b, 150, SUMMER))).toBe(false);
      expect(same(drawGate(a, SUMMER), drawGate(b, SUMMER))).toBe(false);
      expect(same(drawProp("well", a, {}), drawProp("well", b, {}))).toBe(false);
    }
  });

  it("地中海用白灰墙与赭红筒瓦；开拓者用原木墙与风化木瓦", () => {
    const med = drawBuilding("market", "mediterranean", SUMMER);
    expect(has(med, P.brick[2])).toBe(true);
    expect(has(med, P.plaster[3])).toBe(true);
    // 蓝白瓷砖
    expect(has(med, P.cloth.blue[1])).toBe(true);
    const fr = drawBuilding("market", "frontier", SUMMER);
    expect(has(fr, P.wood[3])).toBe(true);
    expect(has(fr, P.stone[1])).toBe(true);
    expect(has(fr, P.plaster[3])).toBe(false);
  });

  it("地标：地中海是带钟楼的圆顶大教堂，开拓者是原木瞭望塔", () => {
    const cathedral = drawLandmark("mediterranean", SUMMER);
    expect(cathedral.h).toBeGreaterThanOrEqual(110);
    expect(has(cathedral, P.brick[2])).toBe(true);
    const tower = drawLandmark("frontier", SUMMER);
    expect(tower.h).toBeGreaterThanOrEqual(90);
    expect(has(tower, P.wood[2])).toBe(true);
  });

  it("其他美术模块仍可通过 drawnStyle 借用画法", () => {
    expect(drawnStyle("mediterranean")).toBe("lowland");
    expect(drawnStyle("frontier")).toBe("nordic");
    for (const s of ["nordic", "lowland", "desert", "islands", "eastern"] as const) expect(drawnStyle(s)).toBe(s);
  });
});

describe("殖民建筑", () => {
  it("14 种建筑的 key 与顺序同 docs/EXPANSION.md §4.1", () => {
    expect(COLONY_KEYS).toEqual(["farm", "plantation", "lumber", "mine", "fishery", "hunting", "distillery", "sugarmill", "storehouse", "fort", "chapel", "tavern", "dock", "housing"]);
  });

  it("每种建筑 × 等级 × 风格都能生成：尺寸有界、落地、裁边、确定", () => {
    for (const style of ARCH_STYLES) {
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
    }
  });

  it("等级越高越大：面积逐级增大，宽度不减", () => {
    for (const style of ARCH_STYLES) {
      for (const key of COLONY_KEYS) {
        const ps = [1, 2, 3].map((lv) => drawColonyBuilding(key, lv, style, SUMMER));
        for (let i = 1; i < 3; i++) {
          const tag = `${key}/${style} ${ps[i - 1].w}×${ps[i - 1].h} → ${ps[i].w}×${ps[i].h}`;
          expect(ps[i].w * ps[i].h, tag).toBeGreaterThan(ps[i - 1].w * ps[i - 1].h);
          expect(ps[i].w, tag).toBeGreaterThanOrEqual(ps[i - 1].w);
          expect(same(ps[i], ps[i - 1]), tag).toBe(false);
        }
      }
    }
  });

  it("等级夹到 1–3，未知 key 按住宅区画", () => {
    const lv1 = drawColonyBuilding("farm", 1, "frontier", SUMMER);
    expect(same(drawColonyBuilding("farm", 0, "frontier", SUMMER), lv1)).toBe(true);
    expect(same(drawColonyBuilding("farm", -5, "frontier", SUMMER), lv1)).toBe(true);
    expect(same(drawColonyBuilding("farm", Number.NaN, "frontier", SUMMER), lv1)).toBe(true);
    expect(same(drawColonyBuilding("farm", 9, "frontier", SUMMER), drawColonyBuilding("farm", 3, "frontier", SUMMER))).toBe(true);
    expect(same(drawColonyBuilding("no-such", 2, "frontier", SUMMER), drawColonyBuilding("housing", 2, "frontier", SUMMER))).toBe(true);
  });

  it("14 种建筑同一等级互不相同", () => {
    for (const lv of [1, 2, 3]) {
      const imgs = COLONY_KEYS.map((k) => drawColonyBuilding(k, lv, "frontier", SUMMER));
      for (let i = 0; i < imgs.length; i++) {
        for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `${COLONY_KEYS[i]}/${COLONY_KEYS[j]}/${lv}`).toBe(false);
      }
    }
  });

  it("3 级换成所有者的风格（地中海用赭红瓦），1 级是开拓者营地", () => {
    const med = drawColonyBuilding("chapel", 3, "mediterranean", SUMMER);
    const fr = drawColonyBuilding("chapel", 3, "frontier", SUMMER);
    expect(same(med, fr)).toBe(false);
    expect(has(med, P.brick[2])).toBe(true);
    expect(has(drawColonyBuilding("housing", 3, "mediterranean", SUMMER), P.brick[2])).toBe(true);
    // 1 级住宅区是帐篷与窝棚：各风格都用帆布
    for (const s of ARCH_STYLES) expect(has(drawColonyBuilding("housing", 1, s, SUMMER), P.parchment)).toBe(true);
  });

  it("季节、积雪与灯光改变画面；堡垒挂所有者的旗色", () => {
    let seasonal = 0;
    for (const key of COLONY_KEYS) {
      for (const lv of [1, 2, 3]) {
        const summer = drawColonyBuilding(key, lv, "frontier", SUMMER);
        const snow = drawColonyBuilding(key, lv, "frontier", WINTER);
        expect(same(summer, snow), `${key}/${lv}`).toBe(false);
        expect(has(snow, P.snow[3]), `${key}/${lv}`).toBe(true);
        if (!same(drawColonyBuilding(key, lv, "frontier", { season: 0 }), drawColonyBuilding(key, lv, "frontier", { season: 2 }))) seasonal++;
      }
    }
    expect(seasonal).toBeGreaterThanOrEqual(12);
    // 农田：夏天有金色麦穗
    expect(has(drawColonyBuilding("farm", 2, "frontier", SUMMER), P.gold[2])).toBe(true);
    for (const key of ["tavern", "chapel", "housing"] as const) {
      expect(has(drawColonyBuilding(key, 3, "frontier", NIGHT), P.lamp[1]), key).toBe(true);
    }
    for (const lv of [1, 2, 3]) {
      const fort = drawColonyBuilding("fort", lv, "frontier", { season: 1, flag: "#2e86c1" });
      expect(has(fort, "#2e86c1"), `fort ${lv}`).toBe(true);
    }
    expect(() => drawColonyBuilding("fort", 2, "frontier", { season: 1, flag: "bad" })).not.toThrow();
  });

  it("码头的桩脚在底边，桥面离底边固定高度", () => {
    for (const lv of [1, 2, 3]) {
      const p = drawColonyBuilding("dock", lv, "frontier", SUMMER);
      expect(p.h).toBeGreaterThan(DOCK_DECK_FROM_BOTTOM);
      // 桥面那一行横贯整座码头
      const deck = p.h - DOCK_DECK_FROM_BOTTOM;
      let run = 0;
      for (let x = 0; x < p.w; x++) if (p.isOpaque(x, deck)) run++;
      expect(run, `dock ${lv}`).toBeGreaterThan(p.w * 0.8);
    }
  });

  it("生成足够快（平均 < 5 ms）", () => {
    for (const key of COLONY_KEYS) drawColonyBuilding(key, 3, "mediterranean", SUMMER);
    const t0 = performance.now();
    let n = 0;
    for (const key of COLONY_KEYS) {
      for (const lv of [1, 2, 3]) {
        drawColonyBuilding(key, lv, "frontier", { season: 3, snow: true, lit: true });
        n++;
      }
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe("第九批的风格名回退到最接近的已有风格", () => {
  it("日本与明画成东方，奥斯曼与斯瓦希里画成沙漠，马来画成群岛，玛雅画成开拓者，伊比利亚画成地中海；未知的照旧按地中海", async () => {
    const { styleOf } = await import("./buildings");
    expect(styleOf("ashikaga", "japanese")).toBe("eastern");
    expect(styleOf("ming", "ming")).toBe("eastern");
    expect(styleOf("ottoman", "ottoman")).toBe("desert");
    expect(styleOf("kilwa", "swahili")).toBe("desert");
    expect(styleOf("ternate", "malay")).toBe("islands");
    expect(styleOf("mayapan", "maya")).toBe("frontier");
    expect(styleOf("castile", "iberian")).toBe("mediterranean");
    expect(styleOf("nobody", "klingon")).toBe("mediterranean");
  });
});

