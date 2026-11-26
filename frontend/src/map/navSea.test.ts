// H03 看得见的海：天气团的块图、船位插值与船的像素图。
import { describe, expect, it } from "vitest";
import type { NavShip } from "../ipc/types";
import { CELL_BLOCKS, cellMask, hash01, placeShips, shipAt, shipPixels } from "./navSea";

const ship = (over: Partial<NavShip>): NavShip => ({ id: "p1", kind: "pirate", size: 1, x: 5, y: 5, track: [], heading: 0, chasing: false, ...over });

describe("天气团的块图", () => {
  it("内圈、外圈与空白都有，边长按半径与块数算，同一个 id 结果相同", () => {
    const a = cellMask(4, "0:12:0");
    expect(a.n).toBe(4 * 2 * CELL_BLOCKS);
    const count = (v: number) => a.data.filter((x) => x === v).length;
    expect(count(3)).toBeGreaterThan(0);
    expect(count(2)).toBeGreaterThan(0);
    expect(count(1)).toBeGreaterThan(0);
    expect(count(0)).toBeGreaterThan(0);
    expect(cellMask(4, "0:12:0").data).toEqual(a.data);
    // 中心是内圈，四角是空白
    const mid = Math.floor(a.n / 2);
    expect(a.data[mid * a.n + mid]).toBe(3);
    // 雾有浓淡：同样大小的雾团与风暴团块图不同
    expect(cellMask(4, "0:12:0", "fog").data).not.toEqual(a.data);
    expect(a.data[0]).toBe(0);
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
  });
});

describe("船位", () => {
  it("追击航迹按 15 分钟一点插值；走航线的在日初与日末之间插值", () => {
    const s = ship({ track: [[0, 0], [1, 0], [2, 2]] });
    expect(shipAt(s, 0)).toEqual({ x: 0, y: 0 });
    expect(shipAt(s, 15)).toEqual({ x: 1, y: 0 });
    expect(shipAt(s, 22.5)).toEqual({ x: 1.5, y: 1 });
    expect(shipAt(s, 999)).toEqual({ x: 2, y: 2 });
    const r = ship({ kind: "merchant", from: [10, 10], to: [14, 10] });
    expect(shipAt(r, 720)).toEqual({ x: 12, y: 10 });
    expect(shipAt(r, null)).toEqual({ x: 5, y: 5 });
    // 追击的海盗：航向取航迹的走向（往东 = 90°）
    expect(Math.round(placeShips([ship({ track: [[0, 0], [1, 0], [2, 0]] })], 0)[0].ship.heading)).toBe(90);
  });

  it("帆影只有一角帆；近处的船身长短按几艘船", () => {
    // 帆影（A 打磨后加大并描半透明深边）仍比认出来的三艘船队小
    expect(shipPixels("sail", 0).length).toBeLessThan(shipPixels("merchant", 3).length);
    // 帆影有描边，雨线多的海面上也看得见
    expect(shipPixels("sail", 0).some(([, , c]) => c.startsWith("rgba(26, 20, 35"))).toBe(true);
    const hull = (n: number) => new Set(shipPixels("merchant", n).map(([, y]) => y)).size;
    expect(hull(3)).toBeGreaterThan(hull(1));
    // 海盗的旗是红的，与商船不同
    const flag = (k: NavShip["kind"]) => shipPixels(k, 1).at(-1)?.[2];
    expect(flag("pirate")).not.toBe(flag("merchant"));
  });
});
