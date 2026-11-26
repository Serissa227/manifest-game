// H06 点海图选喊话对象：只认能喊话的船、0.8 格以内最近的一条。
import { describe, expect, it } from "vitest";
import type { NavShip } from "../../ipc/types";
import { pickHail, useHailStore } from "./hailStore";

const ship = (id: string, hail: boolean): NavShip => ({
  id,
  kind: "merchant",
  size: 1,
  x: 0,
  y: 0,
  track: [],
  heading: 0,
  chasing: false,
  hail: hail ? { target: { fleet: 1 }, options: [{ action: "news", used: false }], last: null } : undefined,
});

describe("点船喊话", () => {
  it("点中能喊话的船才打开卡片", () => {
    useHailStore.setState({ target: null });
    const placed = [
      { ship: ship("f1", true), x: 10, y: 10 },
      { ship: ship("f2", false), x: 10.2, y: 10 },
      { ship: ship("f3", true), x: 10.5, y: 10 },
    ];
    expect(pickHail(placed, 12, 12)).toBe(false);
    expect(useHailStore.getState().target).toBeNull();
    // f2 最近但不能喊话；能喊话的里 f1 最近
    expect(pickHail(placed, 10.15, 10)).toBe(true);
    expect(useHailStore.getState().target).toBe("f1");
  });
});
