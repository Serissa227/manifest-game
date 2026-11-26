// 新手教程：新开局自动开始、读档（第 12 天）不出现；上一步 / 下一步 / 跳过，看完或跳过后记在本机不再自动出现；
// 圈出界面上的目标；进入“交易所”一步时自动打开港口窗口的交易所；买了货自动进入下一步；设置里可以重新开始；键盘操作。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "../components/panels/SettingsPanel";
import { useShell } from "../components/shell/shellState";
import { STEPS } from "../components/tutorial/steps";
import Tutorial from "../components/tutorial/Tutorial";
import { resetTutorial, useTutorial } from "../components/tutorial/tutorialState";
import { useVoyageStore } from "../hooks/useVoyage";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame } from "./fixtures";

const step = (id: string) => STEPS.findIndex((s) => s.id === id);

describe("新手教程", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    resetTutorial();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("新开局（第 0 天、旗舰队在港）自动开始；读档进来的第 12 天不出现", () => {
    const { unmount } = render(<Tutorial />);
    expect(screen.queryByTestId("tutorial")).toBeNull();
    unmount();
    useGame.setState({ overview: { ...overview, day: 0 } });
    render(<Tutorial />);
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "welcome");
    expect(screen.getByRole("dialog", { name: "嘎！欢迎，船长" })).toBeInTheDocument();
    expect(screen.getByText(`1 / ${STEPS.length}`)).toBeInTheDocument();
  });

  it("下一步、上一步、跳过；跳过后记在本机，新开局不再自动出现", async () => {
    useGame.setState({ overview: { ...overview, day: 0 } });
    const user = userEvent.setup();
    const { unmount } = render(<Tutorial />);
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这里是现金、净资产与总资产");
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "welcome");
    expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "跳过教程" }));
    expect(screen.queryByTestId("tutorial")).toBeNull();
    expect(localStorage.getItem("manifest.tutorial")).toBe("done");
    unmount();
    render(<Tutorial />);
    expect(screen.queryByTestId("tutorial")).toBeNull();
  });

  it("圈出这一步的目标：目标在页面上时画出高亮框，没有目标时整屏压暗、说明框居中", async () => {
    useGame.setState({ overview: { ...overview, day: 0 } });
    const cash = document.createElement("div");
    cash.className = "hud-cash";
    document.body.appendChild(cash);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this as HTMLElement).classList?.contains("hud-cash")
        ? ({ left: 100, top: 20, width: 160, height: 40, right: 260, bottom: 60, x: 100, y: 20, toJSON: () => ({}) } as DOMRect)
        : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    const { container } = render(<Tutorial />);
    expect(container.querySelector(".tut-dim")).not.toBeNull();
    act(() => useTutorial.getState().go(step("cash")));
    await waitFor(() => expect(container.querySelector(".tut-spot")).not.toBeNull());
    const spot = container.querySelector(".tut-spot") as HTMLElement;
    expect(spot.style.left).toBe("94px");
    expect(spot.style.width).toBe("172px");
    cash.remove();
  });

  it("进入“交易所”一步时打开港口窗口的交易所；“买货”一步里真的买了货就自动进入下一步", async () => {
    useGame.setState({ overview: { ...overview, day: 0 }, facility: "tavern", tab: "fleet" });
    useShell.setState({ windowOpen: false });
    render(<Tutorial />);
    act(() => useTutorial.getState().go(step("market")));
    await waitFor(() => expect(useGame.getState().facility).toBe("market"));
    expect(useGame.getState().tab).toBe("port");
    expect(useShell.getState().windowOpen).toBe(true);
    expect(useGame.getState().stage).toBe("town");

    act(() => useTutorial.getState().go(step("buy")));
    expect(screen.getByText("照着做一次，会自动进入下一步。")).toBeInTheDocument();
    const o = useGame.getState().overview!;
    act(() => useGame.getState().setOverview({ ...o, fleets: [{ ...o.fleets[0], used: o.fleets[0].used + 10 }] }));
    await waitFor(() => expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "sell"));
  });

  it("最后一步“完成”结束教程；键盘：→ 下一步、← 上一步、Esc 跳过", async () => {
    useGame.setState({ overview: { ...overview, day: 0 } });
    const user = userEvent.setup();
    render(<Tutorial />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(useTutorial.getState().step).toBe(1);
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(useTutorial.getState().step).toBe(0);
    act(() => useTutorial.getState().go(STEPS.length - 1));
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(useTutorial.getState()).toMatchObject({ active: false, done: true });

    act(() => useTutorial.getState().start());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useTutorial.getState().active).toBe(false);
  });

  it("“确认航线”一步：确认框还没出现时说明框放在左下角、不压暗，不挡住海图；起航后自动进入“航行”", async () => {
    useGame.setState({ overview: { ...overview, day: 0 } });
    const { container } = render(<Tutorial />);
    act(() => useTutorial.getState().go(step("route")));
    expect(screen.getByRole("dialog", { name: "确认航线" })).toBeInTheDocument();
    expect(container.querySelector(".tut-dim")).toBeNull();
    expect(container.querySelector(".tut-spot")).toBeNull();
    const o = useGame.getState().overview!;
    act(() => useGame.getState().setOverview({ ...o, fleets: [{ ...o.fleets[0], docked: null }] }));
    await waitFor(() => expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "sea"));
  });

  it("看不见的目标不圈：航海图层切走时（visibility 隐藏）出港确认框仍量得出位置，也不高亮", async () => {
    useGame.setState({ overview: { ...overview, day: 0 }, stage: "chart" });
    useVoyageStore.setState({ picking: true, target: 1, plan: null });
    const layer = document.createElement("div");
    layer.className = "stage-layer stage-chart is-hidden";
    layer.style.visibility = "hidden";
    const dialog = document.createElement("section");
    dialog.setAttribute("data-testid", "departure-dialog");
    layer.appendChild(dialog);
    document.body.appendChild(layer);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "departure-dialog"
        ? ({ left: 420, top: 360, width: 320, height: 220, right: 740, bottom: 580, x: 420, y: 360, toJSON: () => ({}) } as DOMRect)
        : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    const { container } = render(<Tutorial />);
    act(() => useTutorial.getState().go(step("route")));
    // 隐藏着：不圈、说明框放左下角
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(container.querySelector(".tut-spot")).toBeNull();
    // 海图层回到前面：圈出确认框
    act(() => {
      layer.className = "stage-layer stage-chart";
      layer.style.visibility = "";
    });
    await waitFor(() => expect(container.querySelector(".tut-spot")).not.toBeNull());
    layer.remove();
  });

  it("确认航线时回到了港口街景（取消出港或点了底栏的“港口”）：自动退回“出港”一步，再点出港又回来", async () => {
    useGame.setState({ overview: { ...overview, day: 0 }, stage: "chart" });
    useVoyageStore.setState({ picking: true, target: null, plan: null });
    render(<Tutorial />);
    act(() => useTutorial.getState().go(step("route")));
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "route");
    // 点了底栏的“港口”：还在选目的地，但海图不在前面
    act(() => useGame.getState().setStage("town"));
    await waitFor(() => expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "depart"));
    // 再点“出港”：切回海图、进入“确认航线”
    act(() => {
      useVoyageStore.setState({ picking: true, target: null, plan: null });
      useGame.getState().setStage("chart");
    });
    await waitFor(() => expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "route"));
    // 取消出港：退回“出港”
    act(() => {
      useVoyageStore.setState({ picking: false, target: null, plan: null });
      useGame.getState().setStage("town");
    });
    await waitFor(() => expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "depart"));
  });

  it("没点出港、直接点“下一步”进入“确认航线”：不会被弹回“出港”，说明框放左下角、不圈东西", async () => {
    useGame.setState({ overview: { ...overview, day: 0 }, stage: "town" });
    useVoyageStore.setState({ picking: false, target: null, plan: null });
    const user = userEvent.setup();
    const { container } = render(<Tutorial />);
    act(() => useTutorial.getState().go(step("depart")));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "route");
    // 过了一天（概览推送）也还在这一步
    const o = useGame.getState().overview!;
    act(() => useGame.getState().setOverview({ ...o, day: o.day + 1 }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "route");
    expect(container.querySelector(".tut-spot")).toBeNull();
    // 再点“下一步”照常往下走
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "sea");
  });

  it("“船员”一步打开港口窗口的酒馆，圈出最上面的“招募船员”", async () => {
    useGame.setState({ overview: { ...overview, day: 0 }, facility: "market", tab: "fleet" });
    useShell.setState({ windowOpen: false });
    render(<Tutorial />);
    act(() => useTutorial.getState().go(step("crew")));
    await waitFor(() => expect(useGame.getState().facility).toBe("tavern"));
    expect(useShell.getState().windowOpen).toBe(true);
    expect(STEPS[step("crew")].target).toBe('[data-testid="tavern-crew"]');
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("一键");
  });

  it("设置里的“新手教程”一节可以从头再看", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SettingsPanel />
        <Tutorial />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "开始新手教程" }));
    expect(screen.getByTestId("tutorial")).toHaveAttribute("data-step", "welcome");
  });

  it("讲解的是一只没有名字的小乌鸦：站在说明框上沿；换一步时蹦一下、张嘴说一阵，最后扬翅", async () => {
    vi.useFakeTimers();
    try {
      useGame.setState({ overview: { ...overview, day: 0 } });
      render(<Tutorial />);
      const guide = screen.getByTestId("tutorial-guide");
      expect(guide).toHaveAccessibleName("小乌鸦");
      expect(screen.getByTestId("tutorial-text")).toHaveTextContent("我是一只记性特别好的乌鸦");
      expect(screen.getByTestId("tutorial-text")).not.toHaveTextContent("主人");
      // 换一步：说话帧与待机帧交替，说完扬翅，再回到待机
      act(() => useTutorial.getState().go(1));
      act(() => vi.advanceTimersByTime(130));
      expect(screen.getByTestId("tutorial-guide")).toHaveAttribute("data-frame", "caw");
      act(() => vi.advanceTimersByTime(150));
      expect(screen.getByTestId("tutorial-guide")).not.toHaveAttribute("data-frame", "caw");
      act(() => vi.advanceTimersByTime(150 * 7));
      expect(screen.getByTestId("tutorial-guide")).toHaveAttribute("data-frame", "wing");
      act(() => vi.advanceTimersByTime(600));
      expect(["idle", "blink", "tilt"]).toContain(screen.getByTestId("tutorial-guide").getAttribute("data-frame"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("小乌鸦转头朝向被圈出的地方：目标在说明框左边时朝左", async () => {
    useGame.setState({ overview: { ...overview, day: 0 } });
    const time = document.createElement("div");
    time.className = "hud-time";
    document.body.appendChild(time);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this as HTMLElement).classList?.contains("hud-time")
        ? ({ left: 20, top: 20, width: 40, height: 30, right: 60, bottom: 50, x: 20, y: 20, toJSON: () => ({}) } as DOMRect)
        : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    render(<Tutorial />);
    act(() => useTutorial.getState().go(step("time")));
    await waitFor(() => expect(screen.getByTestId("tutorial-guide")).toHaveAttribute("data-facing", "left"));
    time.remove();
  });

  it("每一步都有中英文的标题与说明", async () => {
    const { tk } = await import("../i18n");
    for (const s of STEPS) {
      expect(tk(`tut.${s.id}.title`)).not.toBe(`tut.${s.id}.title`);
      expect(tk(`tut.${s.id}.text`)).not.toBe(`tut.${s.id}.text`);
    }
  });
});
