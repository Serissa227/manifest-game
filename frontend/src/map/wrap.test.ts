// 东西环绕（FRAMEWORK §5.2）的坐标工具：最短差、跨缝区间与矩形、跨缝折线、相机的可见副本与取模、点选取模；
// 不环绕的地图（经典世界）退化为普通的差与裁剪。
import { describe, expect, it } from "vitest";
import { modX, nearestCopy, pickCell, seamSegments, unwrapPath, visibleCopies, wrapCamX, wrapDist, wrapDx, wrapRects, wrapSpans } from "./wrap";

const W = 1080;

describe("取模与最短差", () => {
  it("modX 结果在 [0, W)，负数与 -0 都归正", () => {
    expect(modX(0, W)).toBe(0);
    expect(modX(-0, W)).toBe(0);
    expect(Object.is(modX(-W, W), 0)).toBe(true);
    expect(modX(-1, W)).toBe(W - 1);
    expect(modX(W, W)).toBe(0);
    expect(modX(2 * W + 5, W)).toBe(5);
    expect(modX(-2.5, W)).toBeCloseTo(W - 2.5);
  });

  it("wrapDx 取跨缝的最短一条，结果在 [-W/2, W/2)；不环绕时就是普通的差", () => {
    expect(wrapDx(1075, 3, W, true)).toBe(8);
    expect(wrapDx(3, 1075, W, true)).toBe(-8);
    expect(wrapDx(100, 200, W, true)).toBe(100);
    expect(wrapDx(0, W / 2, W, true)).toBe(-W / 2);
    expect(wrapDx(1075, 3, W, false)).toBe(-1072);
    // 小数坐标
    expect(wrapDx(1079.75, 0.25, W, true)).toBeCloseTo(0.5);
  });

  it("wrapDist 横向按最短差", () => {
    expect(wrapDist({ x: 1078, y: 10 }, { x: 2, y: 13 }, W, true)).toBe(5);
    expect(wrapDist({ x: 1078, y: 10 }, { x: 2, y: 13 }, W, false)).toBeCloseTo(Math.hypot(1076, 3));
  });
});

describe("跨缝的区间与矩形", () => {
  it("区间跨过接缝时拆成两段，总宽不变；宽于整张图时就是整张", () => {
    expect(wrapSpans(1070, 20, W, true)).toEqual([
      { x: 1070, w: 10 },
      { x: 0, w: 10 },
    ]);
    expect(wrapSpans(-5, 10, W, true)).toEqual([
      { x: 1075, w: 5 },
      { x: 0, w: 5 },
    ]);
    expect(wrapSpans(2 * W + 3, 4, W, true)).toEqual([{ x: 3, w: 4 }]);
    expect(wrapSpans(10, W + 50, W, true)).toEqual([{ x: 0, w: W }]);
  });

  it("不环绕时裁到图内，完全在外为空", () => {
    expect(wrapSpans(1070, 20, W, false)).toEqual([{ x: 1070, w: 10 }]);
    expect(wrapSpans(-5, 10, W, false)).toEqual([{ x: 0, w: 5 }]);
    expect(wrapSpans(W + 1, 4, W, false)).toEqual([]);
  });

  it("矩形横向按区间拆分、纵向裁剪", () => {
    expect(wrapRects({ x: 1076, y: -2, w: 8, h: 6 }, W, 396, true)).toEqual([
      { x: 1076, y: 0, w: 4, h: 4 },
      { x: 0, y: 0, w: 4, h: 4 },
    ]);
    expect(wrapRects({ x: 10, y: 400, w: 8, h: 6 }, W, 396, true)).toEqual([]);
  });
});

describe("跨缝的折线", () => {
  const path: [number, number][] = [
    [1076, 10],
    [1078, 11],
    [1, 12],
    [3, 12],
  ];

  it("展开成横向连续：相邻两点按最短的一条", () => {
    expect(unwrapPath(path, W, true)).toEqual([
      [1076, 10],
      [1078, 11],
      [1081, 12],
      [1083, 12],
    ]);
    // 不环绕：原样
    expect(unwrapPath(path, W, false)).toEqual(path);
  });

  it("在接缝处断开成两段，断点插值到接缝上（这一段的 W、下一段的 0）", () => {
    const segs = seamSegments(path, W, true);
    expect(segs).toHaveLength(2);
    expect(segs[0][0]).toEqual([1076, 10]);
    expect(segs[0][segs[0].length - 1][0]).toBe(W);
    expect(segs[1][0][0]).toBe(0);
    // 断点的纵坐标：从 (1078, 11) 到 (1081, 12) 的 2/3 处
    expect(segs[0][segs[0].length - 1][1]).toBeCloseTo(11 + 2 / 3);
    expect(segs[1][0][1]).toBeCloseTo(11 + 2 / 3);
    expect(segs[1][segs[1].length - 1]).toEqual([3, 12]);
    // 每一段都在 [0, W] 里
    for (const s of segs) for (const [x] of s) expect(x >= 0 && x <= W).toBe(true);
    // 不跨缝的折线只有一段
    expect(seamSegments([[5, 5], [9, 6]], W, true)).toEqual([[[5, 5], [9, 6]]]);
    // 不环绕：一段原样
    expect(seamSegments(path, W, false)).toEqual([path]);
  });

  it("往西跨缝也一样", () => {
    const segs = seamSegments([[2, 0], [1077, 0]], W, true);
    expect(segs).toEqual([
      [
        [2, 0],
        [0, 0],
      ],
      [
        [W, 0],
        [1077, 0],
      ],
    ]);
  });
});

describe("相机：无限平移、可见副本与点选取模", () => {
  const MW = W * 4;

  it("视野跨过接缝时看得见两份；不环绕时只有一份", () => {
    expect(visibleCopies(100, 900, MW, true)).toEqual([0]);
    expect(visibleCopies(MW - 300, MW + 500, MW, true)).toEqual([0, MW]);
    expect(visibleCopies(-200, 300, MW, true)).toEqual([-MW, 0]);
    expect(visibleCopies(-200, MW + 300, MW, false)).toEqual([0]);
  });

  it("标记摆在离视野中心最近的那一份上", () => {
    expect(nearestCopy(10, MW - 50, MW, true)).toBe(MW + 10);
    expect(nearestCopy(MW - 10, 30, MW, true)).toBe(-10);
    expect(nearestCopy(500, 600, MW, true)).toBe(500);
    expect(nearestCopy(10, MW - 50, MW, false)).toBe(10);
  });

  it("相机的横向位置按一整张图的屏幕宽度取模，落在 (−mapW, 0]，画面不变", () => {
    const mapW = MW * 0.5;
    for (const x of [0, -100, -mapW, -mapW - 37, 250, 3 * mapW + 11]) {
      const w = wrapCamX(x, mapW);
      expect(w).toBeLessThanOrEqual(0);
      expect(w).toBeGreaterThan(-mapW);
      // 与原位置差整数张图
      expect(Math.abs(((x - w) / mapW) % 1)).toBeCloseTo(0);
    }
    expect(wrapCamX(0, mapW)).toBe(0);
  });

  it("点选：环绕时横向取模，不环绕时越界为 null", () => {
    expect(pickCell(-3, 8, 4, W, 396, true)).toEqual({ x: W - 1, y: 2 });
    expect(pickCell(W * 4 + 9, 8, 4, W, 396, true)).toEqual({ x: 2, y: 2 });
    expect(pickCell(-3, 8, 4, W, 396, false)).toBeNull();
    expect(pickCell(10, -1, 4, W, 396, true)).toBeNull();
    expect(pickCell(10, 396 * 4, 4, W, 396, true)).toBeNull();
  });
});
