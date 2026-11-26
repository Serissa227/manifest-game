// V01 补给的前端接入：寰宇的粮水按船员人日累计（一份够 50 人一天），后端给了能撑几天、补到 10 / 30 天的库存目标与出航预估的缺口。
// - 算法（components/panels/supplyKit.ts）：照后端的字段；旧后端没有这些字段时按原来的“每天各需 daily_need”推算。
// - 舰队页（v2）：粮水合成一项“粮 X / 水 Y，够 N 天”；航行条“预计 N 天 · 粮水够 M 天”，不够时写清还差多少并就地补足。
// - 购买补给（v2）：“补到 10 / 30 天 · 约 N 金币”点一下就买好，提示条里回一句；已够、钱不够、舱位不够时不可用并写明为什么；
//   旧界面（v1）照旧只把数量填进加减框。
// - 出航确认（经典世界的海图）、航行状态、手动航行的仪表与出港框、任务日志里跨洋那几章的沿途补给。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import VoyageHud from "../components/VoyageHud";
import FleetPanel from "../components/panels/FleetPanel";
import {
  daysAfter,
  fillPlan,
  pairText,
  stockDays,
  supplyDays,
  topUpTo,
  tripShort,
  tripShortfall,
} from "../components/panels/supplyKit";
import QuestsPanel from "../components/people/QuestsPanel";
import { useShell } from "../components/shell/shellState";
import { resetNav } from "../hooks/useNavigation";
import { beginDeparture, useVoyage, useVoyageStore } from "../hooks/useVoyage";
import { setLocale } from "../i18n/locale";
import type { FleetView, LocView, NavView, Overview, StaticView, TrackView } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, port, startedGame, statics, v01Fleet, v01Preview, v01Statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

// jsdom 没有 PointerEvent（航行视图的罗经盘要用）：同 nav.test.tsx 补一个
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventShim;
  }
});

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 机器忙时交互多的用例会慢好几倍：单项给 15 秒，等异步结果给 4 秒（只是等得久一点，断言一条没少）。 */
const HEAVY = 15_000;
const SLOW = { timeout: 4_000 };

const RULES = v01Statics.rules;
const withV01 = (patch: Partial<FleetView> = {}, extra: Partial<Overview> = {}): Overview => ({
  ...overview,
  ...extra,
  fleets: [{ ...v01Fleet, ...patch }],
});

/** 提交过的 Resupply。 */
const resupplies = (calls: ReturnType<typeof installIpc>) =>
  calls.mock.calls.filter(([cmd, a]) => cmd === "submit" && "Resupply" in (a.command as object)).map(([, a]) => (a.command as { Resupply: unknown }).Resupply);

/** 买好以后的概览：现金少了 spent，舰队换成 after。 */
const bought = (before: Overview, spent: number, after: Partial<FleetView>) => () => ({
  outcome: "Done",
  overview: { ...before, cash: before.cash - spent, fleets: [{ ...before.fleets[0], ...after }] },
});

beforeEach(() => {
  setLocale("zh-CN");
  setUiFor("v1");
  useShell.setState({ windowOpen: false });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
  resetNav();
  useVoyageStore.setState({ picking: false, target: null, plan: null });
});

describe("粮水的算法（supplyKit）", () => {
  it("能撑几天照后端的 supplies_days（旧算法“粮 2 ÷ 每天 1”只得 2 天）；没有船员为 null；旧后端照旧推算", () => {
    expect(supplyDays(v01Fleet)).toBe(3);
    expect(supplyDays({ ...v01Fleet, crew: 0, supplies_days: null })).toBeNull();
    const old = overview.fleets[0];
    expect(supplyDays(old)).toBe(10);
    expect(supplyDays({ ...old, crew: 0, daily_need: 0 })).toBeNull();
  });

  it("补到 10 / 30 天：库存目标减现有（各 5、12 份，现有各 2）；已够了时都是 0；旧后端按天数 × 每天各需", () => {
    expect(topUpTo(v01Fleet, 10)).toEqual({ food: 3, water: 3 });
    expect(topUpTo(v01Fleet, 30)).toEqual({ food: 10, water: 10 });
    expect(topUpTo({ ...v01Fleet, supplies_days: 10 }, 10)).toEqual({ food: 0, water: 0 });
    expect(topUpTo({ ...v01Fleet, food: 6, water: 3, supplies_days: 8 }, 10)).toEqual({ food: 0, water: 2 });
    expect(topUpTo(overview.fleets[0], 30)).toEqual({ food: 20, water: 20 });
  });

  it("买了以后约够几天：按偏少的一边估（不会多算）；旧后端照旧整除", () => {
    // 现有各 60 人日左右（够 3 天），各加 3 份 = 150 人日：至少 (54 + 150) ÷ 18 = 11 天
    expect(daysAfter(v01Fleet, RULES, { food: 3, water: 3 })).toBe(11);
    expect(daysAfter(v01Fleet, RULES, { food: 0, water: 0 })).toBe(3);
    // 只补粮：水还是够 3 天
    expect(daysAfter(v01Fleet, RULES, { food: 5, water: 0 })).toBe(3);
    expect(daysAfter(overview.fleets[0], statics.rules, { food: 20, water: 20 })).toBe(30);
    // 一项单看：粮多水少时粮那一项按自己的份数估
    expect(stockDays({ ...v01Fleet, food: 10 }, RULES, 10)).toBe(Math.floor((10 * 50 - 49) / 18));
    expect(stockDays(v01Fleet, RULES, 2)).toBe(3);
  });

  it("这趟的缺口照 sail_preview 的 shortfall；旧后端按“天数 × 每天各需 − 库存”推算", () => {
    expect(tripShortfall(v01Fleet, v01Preview)).toEqual({ food: 1, water: 1 });
    expect(tripShort(v01Fleet, { ...v01Preview, shortfall: { food: 0, water: 0 } })).toBe(false);
    const old = overview.fleets[0];
    expect(tripShortfall(old, { days: 12, path: [], supplies: 16 })).toEqual({ food: 2, water: 2 });
    expect(tripShort(old, { days: 10, path: [], supplies: 16 })).toBe(false);
  });

  it("就地补足：钱够时补到建议量（各 4，约 6 金币）；只够补缺口时补缺口（约 3）；连缺口都不够时写明为什么", () => {
    expect(fillPlan(v01Fleet, RULES, v01Preview, 100)).toEqual({ buy: { food: 2, water: 2 }, cost: 6, margin: true, limit: null, block: null });
    expect(fillPlan(v01Fleet, RULES, v01Preview, 4)).toEqual({ buy: { food: 1, water: 1 }, cost: 3, margin: false, limit: "cash", block: null });
    expect(fillPlan(v01Fleet, RULES, v01Preview, 2).block).toEqual({ kind: "cash", cost: 3, cash: 2 });
    // 舱位只剩 3 格：建议量要 4 格，缺口 2 格放得下
    expect(fillPlan({ ...v01Fleet, used: 77 }, RULES, v01Preview, 100)).toMatchObject({ buy: { food: 1, water: 1 }, margin: false, limit: "room", block: null });
  });

  it("“粮 2、水 1”：为 0 的一项不写，买到的写成 +N", () => {
    expect(pairText({ food: 2, water: 0 })).toBe("粮 2");
    expect(pairText({ food: 3, water: 3 }, true)).toBe("粮 +3、水 +3");
  });
});

describe("舰队页（新界面）", { timeout: HEAVY }, () => {
  beforeEach(() => {
    startedGame();
    useGame.setState({ statics: v01Statics, overview: withV01(), tab: "fleet" });
    setUiFor("v2");
  });

  it("粮水合成一项“粮 2 / 水 2，够 3 天”，下面写每天各用约 0.36 份", async () => {
    installIpc({ sail_preview: () => ({ ...v01Preview, days: 2, shortfall: { food: 0, water: 0 } }) });
    render(<FleetPanel />);
    expect(screen.getByTestId("fleet-supplies")).toHaveTextContent("粮 2 / 水 2，够 3 天");
    expect(screen.getByText("每天粮、水各用约 0.36 份")).toBeInTheDocument();
    // 粮水够这趟：航行条写“预计 2 天 · 粮水够 3 天”，补给按钮照旧在“出航”旁
    await waitFor(() => expect(screen.getByTestId("sail-preview")).toHaveTextContent("预计 2 天 · 粮水够 3 天"), SLOW);
    expect(screen.queryByTestId("fleet-sail-supply")).toBeNull();
    expect(screen.getByRole("button", { name: "补给到建议量（6 金币）" })).toBeEnabled();
  });

  it("不够这趟：写清这趟几天、够几天、还差多少粮水；就地“补给到建议量”，买完提示条里回一句；“出航”指向这一条", async () => {
    const before = withV01();
    const calls = installIpc({ sail_preview: () => v01Preview, submit: bought(before, 6, { food: 4, water: 4, supplies_days: 6 }) });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const block = await screen.findByTestId("fleet-sail-supply", {}, SLOW);
    expect(screen.getByTestId("sail-preview")).toHaveTextContent(/^预计 5 天$/);
    const note = within(block).getByTestId("inline-error");
    expect(note).toHaveTextContent("这趟约 5 天，粮水只够 3 天，还差粮 1、水 1。");
    expect(note).toHaveTextContent("补到粮、水各 4，多留几天余量。");
    // 是风险、不是失败：不打断读屏，照样能出航，“出航”的 aria-describedby 指向它
    expect(note).not.toHaveAttribute("role");
    const sail = screen.getByRole("button", { name: "出航" });
    expect(sail).toBeEnabled();
    expect(sail).toHaveAttribute("aria-describedby", note.id);
    // 补给按钮只在这一条里（“出航”旁不再另有一个）
    expect(screen.getAllByRole("button", { name: /^补给到建议量/ })).toHaveLength(1);
    await user.click(within(note).getByRole("button", { name: "补给到建议量（约 6 金币）" }));
    await waitFor(() => expect(resupplies(calls)).toEqual([{ owner: "player", fleet: 0, food: 2, water: 2 }]), SLOW);
    await waitFor(() => expect(useGame.getState().message).toBe("补好了：粮 +2、水 +2，花了 6 金币，现在够 6 天。"), SLOW);
  });

  it("钱只够补齐缺口：按钮改成“补齐缺口”，写明不留余量；连缺口都买不起时不可用并写明为什么", async () => {
    const calls = installIpc({ sail_preview: () => v01Preview });
    useGame.setState({ overview: withV01({}, { cash: 4 }) });
    const user = userEvent.setup();
    const { unmount } = render(<FleetPanel />);
    let note = within(await screen.findByTestId("fleet-sail-supply", {}, SLOW)).getByTestId("inline-error");
    expect(note).toHaveTextContent("钱只够补齐缺口，不留余量。");
    await user.click(within(note).getByRole("button", { name: "补齐缺口（约 3 金币）" }));
    await waitFor(() => expect(resupplies(calls)).toEqual([{ owner: "player", fleet: 0, food: 1, water: 1 }]), SLOW);
    unmount();
    useGame.setState({ overview: withV01({}, { cash: 2 }) });
    render(<FleetPanel />);
    note = within(await screen.findByTestId("fleet-sail-supply", {}, SLOW)).getByTestId("inline-error");
    expect(note).toHaveTextContent("钱不够补足：约要 3 金币，现有 2 金币。");
    expect(within(note).getByRole("button", { name: "补齐缺口（约 3 金币）" })).toBeDisabled();
  });

  it("在海上：只写缺口与“先就近靠港”，没有补给按钮", async () => {
    installIpc({ sail_preview: () => v01Preview });
    useGame.setState({ overview: withV01({ docked: null, dest: 1 }) });
    render(<FleetPanel />);
    const note = within(await screen.findByTestId("fleet-sail-supply", {}, SLOW)).getByTestId("inline-error");
    expect(note).toHaveTextContent("还差粮 1、水 1。");
    expect(note).toHaveTextContent("先就近靠港补足粮水，再接着走。");
    expect(within(note).queryByRole("button")).toBeNull();
  });

  it("没有船员（supplies_days 为 null）：写不耗粮水，不给一键补给", async () => {
    installIpc({ sail_preview: () => ({ ...v01Preview, supplies_days: null, shortfall: { food: 0, water: 0 } }) });
    useGame.setState({ overview: withV01({ crew: 0, supplies_days: null, daily_need: 0, daily_need_milli: 0 }) });
    render(<FleetPanel />);
    expect(screen.getByTestId("fleet-supplies")).toHaveTextContent("粮 2 / 水 2，没有船员，不耗粮水");
    expect(screen.getByTestId("sp-have")).toHaveTextContent("船上粮 2 / 水 2，没有船员，不耗粮水");
    expect(screen.queryByTestId("sp-quick")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("sail-preview")).toHaveTextContent("预计 5 天 · 没有船员，不耗粮水"), SLOW);
  });
});

describe("购买补给：一键补到 10 / 30 天（新界面）", { timeout: HEAVY }, () => {
  beforeEach(() => {
    startedGame();
    useGame.setState({ statics: v01Statics, overview: withV01({}, { cash: 20 }), tab: "fleet" });
    setUiFor("v2");
  });

  it("按钮上写花多少；点一下就买好（提交 Resupply），提示条里回一句；钱不够的那一档不可用并写明为什么", async () => {
    const before = withV01({}, { cash: 20 });
    const calls = installIpc({ submit: bought(before, 9, { food: 5, water: 5, supplies_days: 11 }) });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const desk = screen.getByTestId("supply-desk");
    expect(within(desk).getByTestId("sp-have")).toHaveTextContent("船上粮 2 / 水 2，够 3 天");
    const ten = within(desk).getByRole("button", { name: "补到 10 天 · 约 9 金币" });
    const thirty = within(desk).getByRole("button", { name: "补到 30 天 · 约 30 金币" });
    expect(ten).toBeEnabled();
    expect(thirty).toBeDisabled();
    const why = within(desk).getByTestId("sp-quick-why");
    expect(why).toHaveTextContent("钱不够补到 30 天：约要 30 金币，现有 20 金币。");
    expect(thirty).toHaveAttribute("aria-describedby", why.id);
    expect(ten).not.toHaveAttribute("aria-describedby");
    // 一次点击就买好，不用再点“购买补给”
    await user.click(ten);
    await waitFor(() => expect(resupplies(calls)).toEqual([{ owner: "player", fleet: 0, food: 3, water: 3 }]), SLOW);
    await waitFor(() => expect(useGame.getState().message).toBe("补好了：粮 +3、水 +3，花了 9 金币，现在够 11 天。"), SLOW);
    // 加减框没有被填上数量
    expect(within(desk).getByRole("spinbutton", { name: "要买的粮食" })).toHaveValue(0);
    // 累计规则的世界：最后一行说明一份够几人吃
    expect(within(desk).getByTestId("sp-help")).toHaveTextContent("一份粮或水够 50 人吃喝一天；吃到一半的那份照样占一格舱位。");
  });

  it("正在买时两档都不可用，连点两下也只买一次", async () => {
    let release: (v: unknown) => void = () => {};
    const calls = installIpc({ submit: () => new Promise((r) => (release = r)) });
    useGame.setState({ overview: withV01({}, { cash: 500 }) });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const ten = screen.getByRole("button", { name: "补到 10 天 · 约 9 金币" });
    await user.dblClick(ten);
    expect(ten).toBeDisabled();
    expect(screen.getByRole("button", { name: "补到 30 天 · 约 30 金币" })).toBeDisabled();
    expect(resupplies(calls)).toHaveLength(1);
    release({ outcome: "Done", overview: useGame.getState().overview });
    await waitFor(() => expect(ten).toBeEnabled(), SLOW);
    expect(resupplies(calls)).toHaveLength(1);
  });

  it("已经够了：写“已够 N 天”并且不可用", async () => {
    installIpc();
    useGame.setState({ overview: withV01({ food: 12, water: 14, supplies_days: 31 }, { cash: 500 }) });
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"), SLOW);
    expect(screen.getByRole("button", { name: "已够 10 天" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "已够 30 天" })).toBeDisabled();
    expect(screen.queryByTestId("sp-quick-why")).toBeNull();
  });

  it("舱位不够：不可用，写明要几格、只剩几格", async () => {
    installIpc();
    useGame.setState({ overview: withV01({ used: 75 }, { cash: 500 }) });
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"), SLOW);
    expect(screen.getByRole("button", { name: "补到 10 天 · 约 9 金币" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "补到 30 天 · 约 30 金币" })).toBeDisabled();
    expect(screen.getByTestId("sp-quick-why")).toHaveTextContent("舱位不够补到 10 天：要 6 格，只剩 5 格。");
  });

  it("旧界面照旧：“够 30 天”只把数量填进加减框（按后端的库存目标各 12 份），补完约够几天按累计规则估", async () => {
    setUiFor("v1");
    const calls = installIpc();
    useGame.setState({ overview: withV01({}, { cash: 500 }) });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const desk = screen.getByTestId("supply-desk");
    expect(within(desk).queryByTestId("sp-have")).toBeNull();
    expect(within(desk).queryByTestId("sp-quick")).toBeNull();
    await user.click(within(desk).getByRole("button", { name: "够 30 天" }));
    expect(within(desk).getByRole("spinbutton", { name: "要买的粮食" })).toHaveValue(10);
    expect(within(desk).getByRole("spinbutton", { name: "要买的淡水" })).toHaveValue(10);
    expect(screen.getByTestId("sp-note")).toHaveTextContent("约花 30 金币 · 占舱位 20（还剩 60） · 补完约够 30 天");
    expect(resupplies(calls)).toEqual([]);
    // 旧界面的两行粮、水也照后端的天数（不再是“粮 2 ÷ 每天 1 = 2 天”）
    expect(screen.getByText("粮 2（约 3 天）")).toBeInTheDocument();
    expect(screen.getByText("每日各需 0.36")).toBeInTheDocument();
  });
});

describe("出航确认（经典世界的海图）", { timeout: HEAVY }, () => {
  function Harness() {
    useVoyage();
    return (
      <>
        <MapView />
        <VoyageHud />
      </>
    );
  }

  function setup(over: Overview, ipc: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    const calls = installIpc({
      sail_preview: () => v01Preview,
      port: (args) => ({ ...port, loc: args.loc as number, known: args.loc !== 1 }),
      ...ipc,
    });
    startedGame();
    useGame.setState({ statics: v01Statics, overview: over });
    useVoyageStore.setState({ picking: false, target: null, plan: null, known: {} });
    create.mockReset();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
    return calls;
  }

  async function openConfirm() {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    const dialog = await screen.findByRole("dialog", { name: "扬帆出港" });
    return { user, dialog };
  }

  it("新界面：现有粮水写“粮 2 / 水 2，够 3 天”；不够这趟时写清还差多少，就地补足并在提示条里回一句", async () => {
    const before = withV01();
    const calls = setup(before, { submit: bought(before, 6, { food: 4, water: 4, supplies_days: 6 }) });
    setUiFor("v2");
    const { user, dialog } = await openConfirm();
    expect(await within(dialog).findByTestId("departure-have")).toHaveTextContent("粮 2 / 水 2，够 3 天");
    const note = (await within(dialog).findByText("这趟约 5 天，粮水只够 3 天，还差粮 1、水 1。")).closest("[data-testid='inline-error']") as HTMLElement;
    expect(note).toHaveClass("v2-voyage-risk");
    expect(note).toHaveTextContent("补到粮、水各 4，多留几天余量。");
    expect(within(dialog).getByRole("button", { name: /^起航/ })).toHaveAttribute("aria-describedby", note.id);
    await user.click(within(note).getByRole("button", { name: "补给到建议量（约 6 金币）" }));
    await waitFor(() => expect(resupplies(calls)).toEqual([{ owner: "player", fleet: 0, food: 2, water: 2 }]), SLOW);
    await waitFor(() => expect(useGame.getState().message).toBe("补好了：粮 +2、水 +2，花了 6 金币，现在够 6 天。"), SLOW);
  });

  it("旧界面照旧一句“粮水不足以支撑全程”，可支撑的天数照后端（3 天，不是旧算法的 2 天）", async () => {
    setup(withV01());
    const { dialog } = await openConfirm();
    expect(await within(dialog).findByText("粮水不足以支撑全程，途中可能断粮。")).toHaveClass("chart-warn");
    expect(within(dialog).getByTestId("departure-have")).toHaveTextContent("粮 2，水 2（可支撑 3 天）");
  });

  it("航行状态：粮水可支撑照后端的 supplies_days", async () => {
    setup(withV01({ docked: null, dest: 1, x: 2, y: 1, path: [[2, 1], [2, 2]], days_at_sea: 1 }));
    render(<Harness />);
    expect(await screen.findByTestId("voyage-supply")).toHaveTextContent("3 天");
  });
});

describe("手动航行", { timeout: HEAVY }, () => {
  const manual: StaticView = { ...v01Statics, world: { ...v01Statics.world, modules: ["navigation_manual"] } };
  const NAV: NavView = {
    fleet: 0,
    mode: "manual",
    day: 12,
    minute: 0,
    pos: { x: 1.5, y: 1.25 },
    heading: 292,
    sail: "half",
    speed: 5.26,
    wind: { dir: 0, force: 4, name: "北风 4 级" },
    current: null,
    sail_limit: 67,
    trail: [],
    forecast: [],
    stops: [],
    supplies_days: 2,
    morale: 72,
    sight: 6,
    autopilot: null,
    known_dests: [],
    lat_lon: null,
  };

  function setup(over: Overview, nav: NavView | null, ipc: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    const calls = installIpc({ navigation: () => nav, preview_course: () => ({ points: [], stops: [] }), ...ipc });
    startedGame();
    useGame.setState({ statics: manual, overview: over, stage: "chart" });
    resetNav();
    create.mockReset();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
    return calls;
  }

  const atSea = withV01({ docked: null, pos: { x: 1.5, y: 1.25 }, heading: 292 }, { sighted: [0] });

  it("仪表的“粮水”照 navigation.supplies_days：不到 3 天标告急；没有船员写“无人消耗”", async () => {
    setup(atSea, NAV);
    const { unmount } = render(<MapView />);
    const supplies = await screen.findByTestId("nav-supplies");
    expect(supplies).toHaveTextContent("2 天");
    expect(supplies.closest(".nav-hud-item")).toHaveClass("warn");
    unmount();
    resetNav();
    setup(atSea, { ...NAV, supplies_days: null });
    render(<MapView />);
    const idle = await screen.findByTestId("nav-supplies");
    expect(idle).toHaveTextContent("无人消耗");
    expect(idle.closest(".nav-hud-item")).not.toHaveClass("warn");
  });

  it("新界面的出港框：罗经盘下面写船上粮水够几天，一键补到 10 天就地买好；旧界面没有这一块", async () => {
    const docked = withV01({}, { cash: 500 });
    const calls = setup(docked, null, { submit: bought(docked, 9, { food: 5, water: 5, supplies_days: 11 }) });
    setUiFor("v2");
    const user = userEvent.setup();
    const { unmount } = render(<MapView />);
    act(() => beginDeparture());
    const dialog = await screen.findByTestId("nav-depart");
    const supply = within(dialog).getByTestId("nav-depart-supply");
    expect(supply).toHaveTextContent("船上粮 2 / 水 2，够 3 天");
    expect(supply.querySelector(".chart-warn")).not.toBeNull();
    await user.click(within(supply).getByRole("button", { name: "补到 10 天 · 约 9 金币" }));
    await waitFor(() => expect(useGame.getState().message).toBe("补好了：粮 +3、水 +3，花了 9 金币，现在够 11 天。"), SLOW);
    expect(resupplies(calls)).toEqual([{ owner: "player", fleet: 0, food: 3, water: 3 }]);
    unmount();
    useGame.setState({ overview: docked });
    setUiFor("v1");
    render(<MapView />);
    act(() => beginDeparture());
    expect(within(await screen.findByTestId("nav-depart")).queryByTestId("nav-depart-supply")).toBeNull();
  });
});

describe("任务日志：跨洋那几章的沿途补给", () => {
  const loc = (id: number, key: string, name: string): LocView => ({
    id,
    key,
    name,
    kind: "port",
    x: 0,
    y: 0,
    faction: 0,
    shipyard: false,
    founded: null,
    lore: "",
    site: null,
  });
  const world: StaticView = {
    ...statics,
    locations: [
      ...statics.locations,
      loc(10, "bilbao", "毕尔巴鄂"),
      loc(11, "funchal", "丰沙尔"),
      loc(12, "ribeira_grande", "大里贝拉"),
      loc(13, "san_juan", "圣胡安"),
      loc(14, "st_johns", "圣约翰斯渔港"),
      loc(15, "red_bay", "红湾"),
    ],
  };
  const track = (patch: Partial<TrackView>): TrackView => ({
    key: "free_basque_whaling",
    name: "冰封以前",
    kind: "main",
    status: "waiting",
    chapter: "a01_redbay",
    chapter_title: "第一头鲸",
    objectives: [],
    ...patch,
  });

  it("巴斯克捕鲸线去红湾的那一章：写出正月出发、逐港补给的路线（港名照地点数据）；完成以后、别的章节不写", async () => {
    installIpc({
      story_log: () => ({
        tracks: [track({}), track({ key: "free_lisbon_medicine", name: "周五的灯", chapter: "a01_orta", chapter_title: "果阿的药园" }), track({ key: "other", name: "别的", chapter: "a01_redbay" })],
      }),
    });
    startedGame();
    useGame.setState({ statics: world });
    render(<QuestsPanel />);
    expect(await screen.findByTestId("track-free_basque_whaling-stopover")).toHaveTextContent(
      "沿途补给：正月就从毕尔巴鄂出发，经丰沙尔、大里贝拉、圣胡安、圣约翰斯渔港到红湾，每到一港补足粮水。北大西洋直航顶风又逆流，一口气走不到。",
    );
    // 里斯本那条的港口不在这份地点数据里：不写半句
    expect(screen.queryByTestId("track-free_lisbon_medicine-stopover")).toBeNull();
    expect(screen.queryByTestId("track-other-stopover")).toBeNull();
    cleanup();
    // 到了下一章（或已完成）：不再写
    installIpc({
      story_log: () => ({ tracks: [track({ chapter: "a02_stjohns", chapter_title: "晒鱼滩" }), track({ key: "free_lisbon_medicine", status: "done", chapter: "a01_orta", chapter_title: "果阿的药园" })] }),
    });
    render(<QuestsPanel />);
    await screen.findByText("晒鱼滩", {}, { timeout: 4_000 });
    expect(screen.queryByTestId("track-free_basque_whaling-stopover")).toBeNull();
  });
});
