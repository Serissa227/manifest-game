// 手动航行的纯计算：32 个罗经点的名字与角度换算、逆风禁区、屏幕向量与航向、应用层时钟换算成“从 6:00 起的分钟”、
// 帆的三档、键盘映射、按分钟插值的船位（含跨缝）、经纬度文字与出港的初始航向。
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../i18n/locale";
import {
  angleDiff,
  clockMinuteOf,
  compassPoint,
  formatLatLon,
  headingToward,
  headingVector,
  inIrons,
  navKeyOf,
  navMinute,
  noGoZone,
  normDeg,
  offWind,
  pointIndex,
  positionAt,
  sailDown,
  sailUp,
  seawardHeading,
  sectorPath,
  turnBy,
} from "./navKit";

afterEach(() => setLocale("zh-CN"));

describe("罗经点", () => {
  it("32 个点按 11.25° 一格，四舍五入到最近的点", () => {
    expect(pointIndex(0)).toBe(0);
    expect(pointIndex(5.6)).toBe(0);
    expect(pointIndex(5.7)).toBe(1);
    expect(pointIndex(90)).toBe(8);
    expect(pointIndex(354.5)).toBe(0);
    expect(pointIndex(-11.25)).toBe(31);
    expect(pointIndex(720 + 180)).toBe(16);
  });

  it("中文名：四正、四隅、“偏”与“微”", () => {
    expect(compassPoint(0)).toBe("北");
    expect(compassPoint(45)).toBe("东北");
    expect(compassPoint(22.5)).toBe("东北偏北");
    expect(compassPoint(33.75)).toBe("东北微北");
    expect(compassPoint(11.25)).toBe("北微东");
    expect(compassPoint(292.5)).toBe("西北偏西");
    expect(compassPoint(281.25)).toBe("西微北");
    expect(compassPoint(303.75)).toBe("西北微西");
    expect(compassPoint(180)).toBe("南");
    expect(compassPoint(202.5)).toBe("西南偏南");
    // 32 个名字各不相同
    const names = new Set(Array.from({ length: 32 }, (_, i) => compassPoint(i * 11.25)));
    expect(names.size).toBe(32);
  });

  it("英文名", () => {
    setLocale("en");
    expect(compassPoint(292.5)).toBe("West-Northwest");
    expect(compassPoint(303.75)).toBe("Northwest by West");
    expect(compassPoint(11.25)).toBe("North by East");
  });
});

describe("角度", () => {
  it("normDeg 与最短转角", () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(360)).toBe(0);
    expect(normDeg(Number.NaN)).toBe(0);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 90)).toBe(0);
  });

  it("逆风夹角与禁区：迎风开是 0°，正顺风 180°；夹角小于 sail_limit 时在禁区里", () => {
    expect(offWind(0, 0)).toBe(0);
    expect(offWind(180, 0)).toBe(180);
    expect(offWind(300, 20)).toBe(80);
    expect(inIrons(30, 0, 67)).toBe(true);
    expect(inIrons(70, 0, 67)).toBe(false);
    expect(inIrons(300, 0, 67)).toBe(true);
    expect(inIrons(10, 0, 0)).toBe(false);
    expect(noGoZone(10, 50)).toEqual([320, 60]);
  });

  it("屏幕向量 → 航向（0 正北、顺时针），航向 → 单位向量", () => {
    expect(headingToward(0, -1)).toBe(0);
    expect(headingToward(1, 0)).toBe(90);
    expect(headingToward(0, 1)).toBe(180);
    expect(headingToward(-1, 0)).toBe(270);
    expect(headingToward(-1, -1)).toBe(315);
    expect(headingToward(0, 0)).toBeNull();
    const v = headingVector(90);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
    expect(headingToward(headingVector(123).x, headingVector(123).y)).toBe(123);
  });

  it("按住转舵：每秒 60°，跨过 0° 时归正", () => {
    expect(turnBy(350, 1, 500)).toBe(20);
    expect(turnBy(10, -1, 1000)).toBe(310);
    expect(turnBy(10, 1, -5)).toBe(10);
  });

  it("扇形路径以 M 圆心起、A 弧、Z 结束", () => {
    const d = sectorPath(60, 60, 50, 320, 40);
    expect(d.startsWith("M 60 60 L")).toBe(true);
    expect(d).toContain(" A 50 50 0 0 1 ");
    expect(d.endsWith(" Z")).toBe(true);
  });
});

describe("时钟与命令的分钟", () => {
  it("应用层时钟（当天 0–1439）→ 从 6:00 起的分钟，往返一致", () => {
    expect(navMinute(360)).toBe(0);
    expect(navMinute(480)).toBe(120);
    expect(navMinute(0)).toBe(1080);
    expect(navMinute(359)).toBe(1439);
    for (const m of [0, 1, 359, 360, 361, 720, 1439]) expect(clockMinuteOf(navMinute(m))).toBe(m);
  });
});

describe("帆与键盘", () => {
  it("帆的三档升降，到头不变", () => {
    expect(sailUp("furled")).toBe("half");
    expect(sailUp("half")).toBe("full");
    expect(sailUp("full")).toBe("full");
    expect(sailDown("full")).toBe("half");
    expect(sailDown("furled")).toBe("furled");
  });

  it("A/D、←/→ 转舵，W/S 帆，空格暂停，Tab 切换；带修饰键的不算", () => {
    expect(navKeyOf({ key: "a" })).toBe("left");
    expect(navKeyOf({ key: "A" })).toBe("left");
    expect(navKeyOf({ key: "ArrowLeft" })).toBe("left");
    expect(navKeyOf({ key: "d" })).toBe("right");
    expect(navKeyOf({ key: "ArrowRight" })).toBe("right");
    expect(navKeyOf({ key: "w" })).toBe("sailUp");
    expect(navKeyOf({ key: "s" })).toBe("sailDown");
    expect(navKeyOf({ key: " " })).toBe("pause");
    expect(navKeyOf({ key: "Unidentified", code: "Space" })).toBe("pause");
    expect(navKeyOf({ key: "Tab" })).toBe("toggleView");
    expect(navKeyOf({ key: "d", ctrlKey: true })).toBeNull();
    expect(navKeyOf({ key: "q" })).toBeNull();
  });
});

describe("按分钟插值的船位", () => {
  const pts: [number, number, number][] = [
    [10, 20, 0],
    [12, 20, 60],
    [12, 24, 120],
  ];

  it("在两点之间线性插值，早于第一点、晚于最后一点各取端点；没有点为 null", () => {
    expect(positionAt(pts, 30, 400, false)).toEqual({ x: 11, y: 20 });
    expect(positionAt(pts, 90, 400, false)).toEqual({ x: 12, y: 22 });
    expect(positionAt(pts, -5, 400, false)).toEqual({ x: 10, y: 20 });
    expect(positionAt(pts, 999, 400, false)).toEqual({ x: 12, y: 24 });
    expect(positionAt([], 10, 400, false)).toBeNull();
  });

  it("环绕地图跨缝时按最短的一条插值，结果取模", () => {
    const seam: [number, number, number][] = [
      [1079, 5, 0],
      [1, 5, 60],
    ];
    expect(positionAt(seam, 30, 1080, true)!.x).toBeCloseTo(0);
    expect(positionAt(seam, 15, 1080, true)!.x).toBeCloseTo(1079.5);
  });

  it("整日 1441 点按二分查找定位，保留小数分钟、重复分钟和非法分钟的原有端点行为", () => {
    let reads = 0;
    const points = new Proxy(Array.from({ length: 1441 }, (_, i): [number, number, number] => [i, 0, i]), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(positionAt(points, 1000.5, 2000, false)).toEqual({ x: 1000.5, y: 0 });
    expect(reads).toBeLessThan(30);
    const duplicate: [number, number, number][] = [[0, 0, 0], [1, 0, 60], [5, 0, 60], [6, 0, 120]];
    expect(positionAt(duplicate, 60, 2000, false)).toEqual({ x: 1, y: 0 });
    expect(positionAt(duplicate, 90, 2000, false)).toEqual({ x: 5.5, y: 0 });
    expect(positionAt(duplicate, Number.NaN, 2000, false)).toEqual({ x: 6, y: 0 });
  });
});

describe("经纬度与出港的航向", () => {
  it("“北纬 38°42′ 西经 9°08′”；英文 “38°42′N 9°08′W”；分进位到度", () => {
    expect(formatLatLon(38.7, -9.1333)).toBe("北纬 38°42′ 西经 9°08′");
    expect(formatLatLon(-33.9, 18.42)).toBe("南纬 33°54′ 东经 18°25′");
    expect(formatLatLon(10.9999, 0)).toBe("北纬 11°00′ 东经 0°00′");
    setLocale("en");
    expect(formatLatLon(38.7, -9.1333)).toBe("38°42′N 9°08′W");
  });

  it("出港的初始航向朝着港外最开阔的海面", () => {
    // 港口在 (10, 10)，只有东南方是开阔的海
    const sea = (x: number, y: number) => x > 10 && y > 10;
    const h = seawardHeading(sea, 10, 10, 8);
    expect(h).toBeGreaterThanOrEqual(90);
    expect(h).toBeLessThanOrEqual(180);
    // 四面是海时取 prefer
    expect(seawardHeading(() => true, 0, 0, 5, 270)).toBe(270);
  });
});
