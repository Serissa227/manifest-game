// H08 航海日志、航程总结与一句话提示的纯函数。
import { describe, expect, it } from "vitest";
import type { NavView } from "../../ipc/types";
import { nauticalMiles, pendingHint, profitOf } from "./voyageKit";

const nav = (over: Partial<NavView>): NavView => ({ cells: [], ships: [], sightings: null, journal: null, ...over }) as unknown as NavView;

describe("一句话提示", () => {
  it("按顺序给第一样眼下有、还没提示过的", () => {
    const n = nav({
      cells: [{ kind: "storm", x: 0, y: 0, r: 3, dir: 0, id: "a" }],
      journal: { start_day: 1, from: null, distance: 0, entries: [] },
    });
    expect(pendingHint(n, () => false)).toBe("cells");
    expect(pendingHint(n, (h) => h === "cells")).toBe("journal");
    expect(pendingHint(n, () => true)).toBeNull();
    expect(pendingHint(nav({}), () => false)).toBeNull();
  });
});

describe("航程总结", () => {
  it("里程按每格公里换成海里，盈亏是现金与货值的增减合计", () => {
    expect(nauticalMiles(10, 37)).toBe(200);
    expect(nauticalMiles(10, undefined)).toBe(200);
    expect(profitOf({ cash_change: -120, cargo_change: 400 })).toBe(280);
  });
});
