// 世界图的标记倍数与地名避让（map/camera.ts），以及航行图的默认格宽与锚标倍数。
// 渲染器本身要 WebGL，这里只测它们用的纯函数与常量。
import { describe, expect, it } from "vitest";
import { NAV_DEFAULT_ZOOM, NAV_ZOOMS } from "../components/nav/NavCanvas";
import { boxesOverlap, declutter, markerScale, type Box } from "../map/camera";
import { navMarkScale } from "../map/navDraw";
import { BIG_MAP_ZOOM } from "../map/renderer";

const box = (x0: number, y0: number, w = 40, h = 14): Box => ({ x0, y0, x1: x0 + w, y1: y0 + h });

describe("标记的倍数（markerScale）", () => {
  it("缺省镜头（大地图 3 倍）下标记是 1.5 倍：约为改动前 2 倍镜头下的四分之三", () => {
    expect(BIG_MAP_ZOOM).toBe(3);
    expect(markerScale(BIG_MAP_ZOOM)).toBe(1.5);
    expect(markerScale(BIG_MAP_ZOOM) / 2).toBeCloseTo(0.75);
  });

  it("海图放大时标记只长一半；1–2 倍之间保持原尺寸；看全图时跟着海图缩小", () => {
    expect(markerScale(6)).toBe(3);
    expect(markerScale(4)).toBe(2);
    expect(markerScale(2)).toBe(1);
    expect(markerScale(1.5)).toBe(1);
    expect(markerScale(1)).toBe(1);
    expect(markerScale(0.4)).toBeCloseTo(0.4);
  });

  it("随镜头倍数单调不减，而且从不比海图长得快", () => {
    let prev = 0;
    for (let s = 0.2; s <= 6.001; s += 0.1) {
      const m = markerScale(s);
      expect(m).toBeGreaterThanOrEqual(prev);
      expect(m).toBeLessThanOrEqual(s + 1e-9);
      prev = m;
    }
  });

  it("不像样的倍数按 1 倍", () => {
    expect(markerScale(0)).toBe(1);
    expect(markerScale(-2)).toBe(1);
    expect(markerScale(Number.NaN)).toBe(1);
    expect(markerScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("地名避让（declutter）", () => {
  it("贴边不算相交，重叠才算", () => {
    expect(boxesOverlap(box(0, 0), box(40, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(0, 14))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(39, 13))).toBe(true);
  });

  it("按先后摆：后来的与已经摆下的相交就不显示", () => {
    const boxes = [box(0, 0), box(20, 4), box(100, 0), box(110, 6)];
    expect([...declutter(boxes, [0, 1, 2, 3], new Set())].sort()).toEqual([0, 2]);
    // 换一个先后，赢的就换了
    expect([...declutter(boxes, [1, 0, 3, 2], new Set())].sort()).toEqual([1, 3]);
  });

  it("一定要显示的（悬停、选中、自己舰队所在）先占位，挤掉原本排在前面的", () => {
    // 中间那个（1）与两边都叠；两边（0 与 2）互不相叠
    const boxes = [box(0, 0), box(30, 4), box(60, 8)];
    // 没有一定要显示的：排在最前的 1 占了位，两边都让开
    expect([...declutter(boxes, [1, 0, 2], new Set())]).toEqual([1]);
    // 2 一定要显示：它先占位，1 让开，0 就摆得下了
    const shown = declutter(boxes, [1, 0, 2], new Set([2]));
    expect(shown.has(2)).toBe(true);
    expect(shown.has(0)).toBe(true);
    expect(shown.has(1)).toBe(false);
  });

  it("两个一定要显示的互相重叠时都显示", () => {
    const shown = declutter([box(0, 0), box(10, 2)], [0, 1], new Set([0, 1]));
    expect([...shown].sort()).toEqual([0, 1]);
  });

  it("没有位置的（画面外、缩放太小不画的）不参与，也不占位", () => {
    const shown = declutter([null, box(0, 0), null], [0, 1, 2], new Set([0]));
    expect([...shown]).toEqual([1]);
  });

  it("不在先后里的下标不显示", () => {
    expect(declutter([box(0, 0), box(200, 0)], [1], new Set()).has(0)).toBe(false);
  });
});

describe("航行图的默认格宽与锚标", () => {
  it("默认每格 18 像素，而且在可选的档位里（进航行图时落在这一档，不会悄悄退回最小档）", () => {
    expect(NAV_DEFAULT_ZOOM).toBe(18);
    expect(NAV_ZOOMS.indexOf(NAV_DEFAULT_ZOOM)).toBeGreaterThan(NAV_ZOOMS.indexOf(12));
  });

  it("锚标不跟着格宽翻倍：每格 12 与 18 像素都是原尺寸，24 像素才放大一倍；再小也不小于原尺寸", () => {
    expect(navMarkScale(12)).toBe(1);
    expect(navMarkScale(18)).toBe(1);
    expect(navMarkScale(24)).toBe(2);
    expect(navMarkScale(8)).toBe(1);
  });
});
