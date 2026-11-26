// 短乐句的时机：出港、入港、发现、大赚（比较前后两次概览），优先级，以及读档、新开局这类不是同一局连续两刻的情形。
import { describe, expect, it } from "vitest";
import type { CargoLine, FleetView, Overview } from "../ipc/types";
import { overview } from "../test/fixtures";
import { CUE_ORDER, cuesOf, FORTUNE, saleProfit } from "./cues";

const fleet = (patch: Partial<FleetView>): FleetView => ({ ...overview.fleets[0], ...patch });
const at = (patch: Partial<Overview>, f: Partial<FleetView> = {}): Overview => ({ ...overview, ...patch, fleets: [fleet(f)] });
const cargo = (good: number, qty: number, avg_cost: number): CargoLine => ({ good, qty, avg_cost });

describe("短乐句的时机", () => {
  it("出港与入港：旗舰队从停靠变成在海上、从海上变成停靠", () => {
    const docked = at({}, { docked: 0 });
    const sailing = at({ day: 13 }, { docked: null, x: 5, y: 5 });
    expect(cuesOf(docked, sailing)).toEqual(["depart"]);
    expect(cuesOf(sailing, at({ day: 15 }, { docked: 1 }))).toEqual(["arrive"]);
    // 一直停着、一直在海上：没有
    expect(cuesOf(docked, at({ day: 13 }, { docked: 0 }))).toEqual([]);
    expect(cuesOf(sailing, at({ day: 14 }, { docked: null, x: 6, y: 5 }))).toEqual([]);
  });

  it("发现：已发现的发现物总数增加；旧后端没有这个字段时不奏", () => {
    expect(cuesOf(at({ discovered_count: 2 }, { docked: null }), at({ discovered_count: 3, day: 13 }, { docked: null }))).toEqual(["discover"]);
    expect(cuesOf(at({ discovered_count: 3 }), at({ discovered_count: 3 }))).toEqual([]);
    expect(cuesOf(at({}), at({ discovered_count: 1 }))).toEqual([]);
  });

  it("大赚：货物减少、现金增加，利润够多、够高才奏；买货、少赚、亏本都不奏", () => {
    const before = at({ cash: 10000, net_worth: 20000 }, { cargo: [cargo(1, 100, 50)] });
    // 卖掉 100 件、成本 5000，收入 9000：赚 4000（净资产的 20%、成本的 80%）
    const sold = at({ cash: 19000, net_worth: 24000 }, { cargo: [] });
    expect(saleProfit(before, sold)).toEqual({ profit: 4000, cost: 5000 });
    expect(cuesOf(before, sold)).toEqual(["fortune"]);
    // 只卖一半、赚 900：不到 1500 金币
    const half = at({ cash: 13400 }, { cargo: [cargo(1, 50, 50)] });
    expect(saleProfit(before, half)).toEqual({ profit: 900, cost: 2500 });
    expect(cuesOf(before, half)).toEqual([]);
    // 利润 1600、超过 1500 金币，但只是成本的 20%（门槛 25%）
    const stock = at({ cash: 10000, net_worth: 20000 }, { cargo: [cargo(2, 80, 100)] });
    const soldThin = at({ cash: 19600, net_worth: 21600 }, { cargo: [] });
    expect(saleProfit(stock, soldThin)).toEqual({ profit: 1600, cost: 8000 });
    expect(1600 / 8000).toBeLessThan(FORTUNE.margin);
    expect(cuesOf(stock, soldThin)).toEqual([]);
    // 净资产很大时，门槛是净资产的 3%
    const rich = at({ cash: 10000, net_worth: 1_000_000 }, { cargo: [cargo(1, 100, 50)] });
    expect(cuesOf(rich, at({ cash: 19000, net_worth: 1_004_000 }, { cargo: [] }))).toEqual([]);
    // 买货（现金减少、货物增加）与亏本卖
    expect(saleProfit(at({ cash: 10000 }, { cargo: [] }), at({ cash: 5000 }, { cargo: [cargo(1, 100, 50)] }))).toBeNull();
    expect(saleProfit(before, at({ cash: 13000 }, { cargo: [] }))).toEqual({ profit: -2000, cost: 5000 });
    expect(cuesOf(before, at({ cash: 13000 }, { cargo: [] }))).toEqual([]);
  });

  it("商队卖货也算；只是转运到别处（现金不变）不算", () => {
    const caravan = { id: 4, animal: 0, count: 2, guards: 0, at: 0, leg: null, dest: null, capacity: 40, cargo: [cargo(0, 40, 20)], daily_cost: 5 };
    const before = at({ cash: 10000, net_worth: 20000, caravans: [caravan] });
    const after = at({ cash: 12500, net_worth: 21700, caravans: [{ ...caravan, cargo: [] }] });
    expect(saleProfit(before, after)).toEqual({ profit: 1700, cost: 800 });
    expect(cuesOf(before, after)).toEqual(["fortune"]);
    expect(saleProfit(before, at({ cash: 10000, caravans: [{ ...caravan, cargo: [] }] }))).toBeNull();
  });

  it("同一刻有几件事：按优先级排好（发现 > 大赚 > 入港 > 出港）", () => {
    expect([...CUE_ORDER]).toEqual(["discover", "fortune", "arrive", "depart"]);
    const prev = at({ discovered_count: 1, cash: 10000 }, { docked: null, cargo: [cargo(1, 100, 50)] });
    const next = at({ discovered_count: 2, cash: 19000, day: 13 }, { docked: 0, cargo: [] });
    expect(cuesOf(prev, next)).toEqual(["discover", "fortune", "arrive"]);
  });

  it("不是同一局的连续两刻（读档、新开局、日子倒退或跳得太远）：不奏", () => {
    const docked = at({}, { docked: 0 });
    const sailing = at({ day: 13 }, { docked: null });
    expect(cuesOf(null, sailing)).toEqual([]);
    expect(cuesOf(docked, null)).toEqual([]);
    expect(cuesOf(docked, { ...sailing, scenario: "别的剧本" })).toEqual([]);
    expect(cuesOf(docked, { ...sailing, day: 5 })).toEqual([]);
    expect(cuesOf(docked, { ...sailing, day: 40 })).toEqual([]);
    // 换了旗舰队（编号不同）不算出港
    expect(cuesOf(docked, at({ day: 13 }, { id: 9, docked: null }))).toEqual([]);
  });
});
