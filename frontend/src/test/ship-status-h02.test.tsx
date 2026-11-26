// H02：航行视图的船况状态区与常设命令面板。
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JettisonMenu, OrdersMenu, ShipStatus } from "../components/nav/ShipStatus";
import { gauges, supplyAlertDue } from "../components/nav/shipStatusKit";
import type { NavView, WearView } from "../ipc/types";
import { useGame } from "../store/game";
import { startedGame } from "./fixtures";

const wear: WearView = {
  hull: 64,
  rigging: 92,
  fouling: 35,
  crew: 40,
  sick: 3,
  fatigue: 62,
  fresh_days: 48,
  scurvy_after: 45,
  timber: 0,
  timber_cap: 20,
  load_slow: 2,
  speed_pct: 86,
  slowdown: true,
  promise_until: null,
  orders: { rations: "full", pace: "normal" },
  tired: 60,
  exhausted: 85,
};

const nav = (w: WearView | undefined, supplies: number | null = 30): NavView => ({
  fleet: 0, day: 12, minute: 120, mode: "manual", pos: { x: 10, y: 10 }, heading: 90, sail: "full", speed: 5,
  wind: { dir: 0, force: 3, name: "" }, current: null, sail_limit: 50, trail: [], forecast: [], stops: [],
  supplies_days: supplies, morale: 100, sight: 3, autopilot: null, known_dests: [], lat_lon: null, wear: w,
});

beforeEach(() => startedGame());
afterEach(cleanup);

describe("船况状态区", () => {
  it("七项读数按内核的阈值上色：船体 < 70 注意、疲劳 ≥ 60 注意、断鲜过线要紧、有病号注意、没有船材注意", () => {
    const level = Object.fromEntries(gauges(wear).map((g) => [g.key, g.level]));
    expect(level).toEqual({ hull: "caution", rigging: "ok", fouling: "caution", crew: "caution", fatigue: "caution", fresh: "warn", timber: "caution" });
    expect(gauges({ ...wear, hull: 20, fatigue: 90 }).find((g) => g.key === "hull")?.level).toBe("warn");
  });

  it("缺省只有图标与数字；点开写名字与合计航速；怠工、载重写在下面一行", () => {
    render(<ShipStatus wear={wear} />);
    const box = screen.getByTestId("ship-status");
    expect(within(box).getByTestId("wear-crew")).toHaveTextContent("40·3");
    expect(within(box).queryByText("船体")).toBeNull();
    expect(screen.getByTestId("wear-notes")).toHaveTextContent("船员在怠工；货装得太满，慢 2%");
    fireEvent.click(within(box).getByRole("button"));
    expect(within(box).getByText("船体")).toBeInTheDocument();
    expect(box).toHaveTextContent("航速 86%");
  });

  it("粮水低于提醒天数（缺省 7 天）时该暂停；设成 0 不提醒；规则关着（没有 wear）不提醒", () => {
    expect(supplyAlertDue(nav(wear, 5))).toBe(true);
    expect(supplyAlertDue(nav(wear, 9))).toBe(false);
    expect(supplyAlertDue(nav({ ...wear, orders: { ...wear.orders, supply_alert: 0 } }, 1))).toBe(false);
    expect(supplyAlertDue(nav(undefined, 1))).toBe(false);
  });
});

describe("常设命令", () => {
  it("改口粮、节奏、自动项都提交整套常设命令（其余照旧）", () => {
    const submit = vi.fn().mockResolvedValue({ Done: null });
    useGame.setState({ submit });
    render(<OrdersMenu nav={nav(wear)} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("orders-rations-half"));
    expect(submit).toHaveBeenLastCalledWith({
      Voyage: { owner: "player", fleet: 0, order: { set_orders: { rations: "half", pace: "normal", auto_reef: true, auto_repair: true, supply_alert: 7 } } },
    });
    fireEvent.click(screen.getByTestId("orders-pace-easy"));
    expect(submit.mock.lastCall?.[0].Voyage.order.set_orders.pace).toBe("easy");
    fireEvent.click(screen.getByTestId("orders-auto-reef"));
    expect(submit.mock.lastCall?.[0].Voyage.order.set_orders.auto_reef).toBe(false);
    fireEvent.change(screen.getByTestId("orders-alert"), { target: { value: "0" } });
    expect(submit.mock.lastCall?.[0].Voyage.order.set_orders.supply_alert).toBe(0);
  });

  it("规则关着（没有 wear）时什么也不画", () => {
    const { container } = render(<OrdersMenu nav={nav(undefined)} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("抛货", () => {
  it("两档（一成 / 三成）写明约几件；点了就提交按比例抛货；没有货时不画", () => {
    const submit = vi.fn().mockResolvedValue({ Done: null });
    useGame.setState({ submit });
    render(<JettisonMenu nav={nav({ ...wear, cargo: 45 })} onClose={() => {}} />);
    expect(screen.getByTestId("jettison-10")).toHaveTextContent("约 5 件");
    expect(screen.getByTestId("jettison-30")).toHaveTextContent("约 14 件");
    fireEvent.click(screen.getByTestId("jettison-30"));
    expect(submit).toHaveBeenLastCalledWith({ Voyage: { owner: "player", fleet: 0, order: { jettison_share: { pct: 30 } } } });
    cleanup();
    const { container } = render(<JettisonMenu nav={nav({ ...wear, cargo: 0 })} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
