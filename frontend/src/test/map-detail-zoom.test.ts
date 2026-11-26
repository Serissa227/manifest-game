// 细海图（第九批 M01）的档位与标记比例：世界图的近档与航行视图一格 24 / 48 / 72 屏幕像素（细节美术像素的 1× / 2× / 3×），
// 缺省 48；船与港口标记的像素倍率与地形一致，相对地理变小（船长约 1.2 格、港口标记连描边约 0.8 格）。
// 渲染器本身要 WebGL，这里只测它们用的纯函数与常量；没有细图层的地图（经典世界）的档位与倍数见 map-markers.test.ts，照旧。
import { describe, expect, it } from "vitest";
import { drawCityMarker, drawPlaceDot, drawPortMarker } from "../art/map";
import { DETAIL_CELL } from "../art/map/types";
import { SHIP_TOP_H, SHIP_TOP_W, drawAnchorMark } from "../art/navArt";
import { NAV_DEFAULT_ZOOM, NAV_ZOOMS } from "../components/nav/NavCanvas";
import { NAV_DETAIL_DEFAULT_ZOOM, NAV_DETAIL_ZOOMS, navZoomsOf } from "../components/nav/navZoom";
import { declutter, detailMarkerScale, type Box } from "../map/camera";
import { cameraTiles } from "../map/navDraw";
import { BIG_MAP_ZOOM, DETAIL_MAP_ZOOM, DETAIL_MIN_ZOOM } from "../map/renderer";
import { CHART_CELL } from "../art/map";
import type { FineLayers } from "../art/map/fine";

describe("世界图：带细图层的大地图", () => {
  it("镜头 6 倍（一格 24 屏幕像素）起改用细节瓦片；缺省 12 倍，一格 48 像素、美术像素 2 倍", () => {
    expect(DETAIL_CELL).toBe(24);
    expect(DETAIL_MIN_ZOOM * CHART_CELL).toBe(DETAIL_CELL);
    expect(DETAIL_MAP_ZOOM * CHART_CELL).toBe(48);
    expect((DETAIL_MAP_ZOOM * CHART_CELL) / DETAIL_CELL).toBe(2);
    // 没有细图层的大地图照旧
    expect(BIG_MAP_ZOOM).toBe(3);
  });

  it("近档标记的像素倍率与地形一致：6 / 12 / 18 倍镜头是 1× / 2× / 3×；远档保持原尺寸，看全图时跟着缩小", () => {
    expect(detailMarkerScale(6)).toBe(1);
    expect(detailMarkerScale(12)).toBe(2);
    expect(detailMarkerScale(18)).toBe(3);
    for (const s of [6, 12, 18]) expect(detailMarkerScale(s)).toBe((s * CHART_CELL) / DETAIL_CELL);
    expect(detailMarkerScale(3)).toBe(1);
    expect(detailMarkerScale(1.5)).toBe(1);
    expect(detailMarkerScale(1)).toBe(1);
    expect(detailMarkerScale(0.4)).toBeCloseTo(0.4);
    expect(detailMarkerScale(0)).toBe(1);
    expect(detailMarkerScale(Number.NaN)).toBe(1);
    // 单调不减
    let prev = 0;
    for (let s = 0.2; s <= 18.001; s += 0.1) {
      expect(detailMarkerScale(s)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = detailMarkerScale(s);
    }
  });

  it("缺省档位下港口与城市标记不到一格：图样 17 × 18 是四分之三格，连一像素的描边 19 × 20 约 0.8 格", () => {
    const cellPx = DETAIL_MAP_ZOOM * CHART_CELL;
    const m = detailMarkerScale(DETAIL_MAP_ZOOM);
    for (const px of [drawPortMarker("lowland", "#c8373a"), drawCityMarker("lowland", "#c8373a")]) {
      expect([px.w, px.h]).toEqual([19, 20]);
      // 去掉四周一像素的描边，图样本身不超过四分之三格
      expect(((px.w - 2) * m) / cellPx).toBeLessThanOrEqual(0.75);
      expect(((px.h - 2) * m) / cellPx).toBeLessThanOrEqual(0.75);
      expect((px.h * m) / cellPx).toBeLessThan(0.85);
    }
    // 改动前（缺省镜头 3 倍、一格 12 像素、标记 1.5 倍）标记高 2.5 格
    expect((20 * 1.5) / 12).toBe(2.5);
    // 各近档都一样（标记跟着地形的美术像素一起放大）
    for (const s of [6, 12, 18]) expect((18 * detailMarkerScale(s)) / (s * CHART_CELL)).toBeCloseTo(0.75);
  });

  it("远档上挤在一起的地点：要紧的画完整的标记，排在后面的只画 5 × 5 的小圆点（港口圆、城市方、殖民点菱形）", () => {
    for (const kind of ["port", "city", "site"] as const) {
      const dot = drawPlaceDot(kind, "#c8373a");
      expect([dot.w, dot.h]).toEqual([5, 5]);
      expect(dot.isOpaque(2, 2)).toBe(true);
      const unknown = drawPlaceDot(kind, "#c8373a", { unknown: true });
      expect(unknown.get(2, 2)).not.toBe(dot.get(2, 2));
    }
    // 圆点四角透明、方点四角不透明
    expect(drawPlaceDot("port", "#fff").isOpaque(0, 0)).toBe(false);
    expect(drawPlaceDot("city", "#fff").isOpaque(0, 0)).toBe(true);
    // 避让的规则（渲染器里照这个用）：远档一格 12 像素、标记 17 × 18，相邻一格的两个港口相叠——先摆的画完整，后面的让开；
    // 近档一格 48 像素、标记 34 × 36，相邻一格的不相叠，两个都画
    const boxAt = (cellPx: number, m: number, cx: number): Box => ({ x0: cx * cellPx - 9.5 * m, y0: -15 * m, x1: cx * cellPx + 9.5 * m, y1: 5 * m });
    expect([...declutter([boxAt(12, 1, 0), boxAt(12, 1, 1)], [0, 1], new Set())]).toEqual([0]);
    expect([...declutter([boxAt(48, 2, 0), boxAt(48, 2, 1)], [0, 1], new Set())].sort()).toEqual([0, 1]);
  });
});

describe("航行视图：带细图层的地图", () => {
  const fine = { sub: 24 } as FineLayers;

  it("档位 24 / 48 / 72（细节美术像素的整数倍），缺省 48；没有细图层的地图照旧 8 / 12 / 18 / 24、缺省 18", () => {
    expect([...NAV_DETAIL_ZOOMS]).toEqual([24, 48, 72]);
    expect(NAV_DETAIL_DEFAULT_ZOOM).toBe(48);
    for (const z of NAV_DETAIL_ZOOMS) expect(z % DETAIL_CELL).toBe(0);
    expect(navZoomsOf({ input: { fine } })).toEqual({ zooms: NAV_DETAIL_ZOOMS, initial: 48 });
    expect(navZoomsOf({ input: {} })).toEqual({ zooms: NAV_ZOOMS, initial: NAV_DEFAULT_ZOOM });
    expect(navZoomsOf({ input: { fine: null } })).toEqual({ zooms: NAV_ZOOMS, initial: NAV_DEFAULT_ZOOM });
    expect(navZoomsOf(null)).toEqual({ zooms: NAV_ZOOMS, initial: NAV_DEFAULT_ZOOM });
  });

  it("缺省档位下俯视的船不超过约 1.25 格长，锚标约半格；倍率与地形一致（都是 2 倍）", () => {
    const scale = NAV_DETAIL_DEFAULT_ZOOM / DETAIL_CELL;
    expect(scale).toBe(2);
    expect((SHIP_TOP_H * scale) / NAV_DETAIL_DEFAULT_ZOOM).toBeLessThanOrEqual(1.25);
    expect((SHIP_TOP_W * scale) / NAV_DETAIL_DEFAULT_ZOOM).toBeLessThanOrEqual(0.75);
    const anchor = drawAnchorMark(true);
    expect((anchor.h * scale) / NAV_DETAIL_DEFAULT_ZOOM).toBeLessThanOrEqual(0.75);
    // 改动前（每格 18 像素、船 2 倍）船长约 3.2 格
    expect((SHIP_TOP_H * 2) / NAV_DEFAULT_ZOOM).toBeGreaterThan(3);
  });

  it("视野里的细节瓦片按 32 格一块取，四周可以多取一圈（提前画）", () => {
    const cam = { cx: 944, cy: 96, cellPx: 48, viewW: 1600, viewH: 1000, width: 1080, height: 396, wrap: true };
    const seen = cameraTiles(cam, 32);
    // 1600 × 1000 像素、每格 48 像素：约 33 × 21 格——横向从第 927 格到第 961 格（3 块），纵向跨着第 96 格的块界（2 块）
    expect(seen.map((s) => `${s.tx}:${s.ty}`).sort()).toEqual(["28:2", "28:3", "29:2", "29:3", "30:2", "30:3"]);
    const ring = cameraTiles(cam, 32, 32 * 48);
    expect(ring.length).toBeGreaterThan(seen.length);
    for (const s of seen) expect(ring.some((r) => r.tx === s.tx && r.ty === s.ty)).toBe(true);
    // 缺省的 64 格一块（旧瓦片）不受影响
    expect(cameraTiles({ ...cam, cellPx: 18 }).every((s) => s.x % 64 === 0)).toBe(true);
  });
});
