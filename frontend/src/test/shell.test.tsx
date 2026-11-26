// 游戏外壳：顶部状态栏、命令栏与功能窗口、主舞台切换、航海日志与结局横幅、界面贴图。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useShell } from "../components/shell/shellState";
import {
  FRAME_SLICE,
  PLAQUE_H,
  PLAQUE_SLICE,
  RIBBON_H,
  UI_TEXTURES,
  drawFrame,
  drawPlaque,
  drawRibbon,
  drawTitle,
  installUiTheme,
  nineSlice,
} from "../art/ui";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, settingsView, startedGame } from "./fixtures";

function withOverview(patch: Partial<Overview>) {
  useGame.setState({ overview: { ...overview, ...patch } });
}

const atSea: Overview["fleets"][number] = { ...overview.fleets[0], docked: null, dest: 1, days_at_sea: 3 };

describe("顶部状态栏", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
  });

  it("显示主角的姓名、头衔与所在港口", async () => {
    withOverview({ captain: { name: "林远舟", portrait: 3 } });
    render(<App />);
    expect(await screen.findByTestId("captain-name")).toHaveTextContent("林远舟");
    const hud = screen.getByTestId("hud");
    expect(within(hud).getByText("新晋船主")).toBeInTheDocument();
    expect(within(hud).getByText("停泊于澄港")).toBeInTheDocument();
    // 资产、预算、日期与目标仍然可以按 testid 找到
    expect(screen.getByTestId("cash")).toHaveTextContent("12,345 金币");
    expect(screen.getByTestId("budget")).toHaveTextContent("3/60 次");
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(screen.getByTestId("goal")).toHaveTextContent("目标：净资产 20,000 / 300,000 金币");
    const bar = screen.getByRole("progressbar", { name: "剧本目标进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "6");
  });

  it("按主角开局的局：名牌用主角的名字，头像用后端给的主角头像素材", async () => {
    withOverview({ captain: { name: "一条澪", portrait: 0 }, captain_asset: "t16-mio-16" });
    render(<App />);
    expect(await screen.findByTestId("captain-name")).toHaveTextContent("一条澪");
    expect(screen.getByTestId("hud").querySelector('.hud-portrait img[data-portrait="t16-mio-16"]')).not.toBeNull();
  });

  it("没有主角时使用默认称呼；在海上时显示出海天数", async () => {
    withOverview({ captain: null, fleets: [atSea] });
    render(<App />);
    expect(await screen.findByTestId("captain-name")).toHaveTextContent("无名船长");
    expect(screen.getByText("航行中 · 出海第 3 天")).toBeInTheDocument();
  });

  it("时间控制与存读档按钮的名称不含图标文字", async () => {
    render(<App />);
    const speed = await screen.findByRole("group", { name: "游戏速度" });
    // 11-03 时间机制：倍速只有慢、普通、快三档
    for (const name of ["暂停", "慢", "普通", "快", "下一天"]) {
      expect(within(speed).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(speed).getByRole("button", { name: "暂停" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("存档名")).toHaveValue("save1");
    for (const name of ["存档", "读档", "主菜单"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("点“主菜单”先确认：取消还在这一局，点“回到主菜单”才回标题（11-03）", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "主菜单" }));
    const ask = await screen.findByRole("alertdialog", { name: "回到主菜单？" });
    expect(ask).toHaveTextContent("没存档的进度会丢掉");
    await user.click(within(ask).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(useGame.getState().overview).not.toBeNull();
    // 真回到标题会让标题画面的状态留到后面的测试：这里只确认点了就去离开
    const leave = vi.spyOn(useGame.getState(), "leave").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "主菜单" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "回到主菜单？" })).getByRole("button", { name: "回到主菜单" }));
    expect(leave).toHaveBeenCalledTimes(1);
    leave.mockRestore();
  });
});

describe("命令栏与功能窗口", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
  });

  it("开局默认打开港口窗口；命令栏切换窗口，窗口以当前功能页命名", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();
    const bar = screen.getByRole("tablist", { name: "功能面板" });
    expect(within(bar).getByRole("tab", { name: "港口" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "港口" })).toBeInTheDocument();

    await user.click(within(bar).getByRole("tab", { name: "舰队" }));
    expect(await screen.findByTestId("fleet-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("port-panel")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "舰队" })).toBeInTheDocument();
    expect(within(bar).getByRole("tab", { name: "舰队" })).toHaveAttribute("aria-selected", "true");
    expect(within(bar).getByRole("tab", { name: "港口" })).toHaveAttribute("aria-selected", "false");

    await user.click(within(bar).getByRole("tab", { name: "报表" }));
    expect(await screen.findByTestId("game-window")).toHaveClass("gw-center", "gw-large");
  });

  it("窗口可以关闭，再点命令栏重新打开；再点当前页、按 Esc 也能关闭", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    expect(screen.queryByTestId("port-panel")).toBeNull();
    expect(screen.queryByTestId("game-window")).toBeNull();
    // 只剩舞台：没有标签处于选中状态
    const bar = screen.getByRole("tablist", { name: "功能面板" });
    expect(within(bar).getByRole("tab", { name: "港口" })).toHaveAttribute("aria-selected", "false");

    await user.click(within(bar).getByRole("tab", { name: "港口" }));
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();

    // 再点当前页：收起窗口
    await user.click(within(bar).getByRole("tab", { name: "港口" }));
    expect(screen.queryByTestId("port-panel")).toBeNull();

    // 打开航海士窗口；焦点在窗口里时按 Esc 关闭
    await user.click(within(bar).getByRole("tab", { name: "航海士" }));
    const win = await screen.findByTestId("game-window");
    act(() => within(win).getByRole("button", { name: "关闭窗口" }).focus());
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("game-window")).toBeNull();
  });

  it("窗口关闭后，在航海图上选中地点或别处切换功能页会重新打开窗口", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "关闭窗口" }));
    expect(screen.queryByTestId("game-window")).toBeNull();
    // 地点列表（航海图始终挂载）：选中柳湾 → 港口窗口重新打开
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();
    expect(useGame.getState().selectedLoc).toBe(1);

    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    act(() => useGame.getState().setTab("intel"));
    expect(await screen.findByTestId("intel-panel")).toBeInTheDocument();
  });

  it("有进行中的战术海战时命令栏出现“海战”，开发者模式出现“调试”", async () => {
    installIpc({ get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, dev_mode: true } }) });
    withOverview({ tactical_battles: [4] });
    render(<App />);
    const bar = await screen.findByRole("tablist", { name: "功能面板" });
    const names = () =>
      within(bar)
        .getAllByRole("tab")
        .map((b) => b.textContent);
    await waitFor(() => expect(names()).toContain("调试"));
    expect(names()).toEqual(["港口", "海战", "舰队", "航海士", "期货", "行情", "商队", "产业", "报表", "情报", "设置", "调试"]);
  });
});

describe("主舞台", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
  });

  it("靠港时显示港口街景，航海图始终挂载在 DOM 中；可以切到航海图再切回", async () => {
    const user = userEvent.setup();
    render(<App />);
    const stage = await screen.findByTestId("stage");
    expect(stage).toHaveAttribute("data-stage", "town");
    expect(screen.getByTestId("stage-town")).toBeInTheDocument();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(screen.getByTestId("stage-chart")).toHaveClass("is-hidden");

    const group = screen.getByRole("group", { name: "主舞台" });
    const town = within(group).getByRole("button", { name: "港口街景" });
    const chart = within(group).getByRole("button", { name: "航海图" });
    expect(town).toHaveAttribute("aria-pressed", "true");
    expect(town).toBeEnabled();

    await user.click(chart);
    expect(useGame.getState().stage).toBe("chart");
    expect(stage).toHaveAttribute("data-stage", "chart");
    expect(screen.queryByTestId("stage-town")).toBeNull();
    expect(screen.getByTestId("stage-chart")).not.toHaveClass("is-hidden");
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(chart).toHaveAttribute("aria-pressed", "true");

    await user.click(town);
    expect(stage).toHaveAttribute("data-stage", "town");
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });

  it("旗舰队在海上时只能看航海图：街景按钮不可用，舞台显示航海图", async () => {
    const user = userEvent.setup();
    withOverview({ fleets: [atSea] });
    render(<App />);
    const stage = await screen.findByTestId("stage");
    // 即使 store 里仍是 town，实际也只显示航海图
    act(() => useGame.getState().setStage("town"));
    expect(stage).toHaveAttribute("data-stage", "chart");
    expect(screen.queryByTestId("stage-town")).toBeNull();
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "主舞台" });
    expect(within(group).getByRole("button", { name: "港口街景" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "航海图" })).toHaveAttribute("aria-pressed", "true");

    // 旗舰队靠港后可以回到街景
    act(() => useGame.getState().setOverview({ ...overview }));
    const town = within(group).getByRole("button", { name: "港口街景" });
    await waitFor(() => expect(town).toBeEnabled());
    await user.click(town);
    expect(stage).toHaveAttribute("data-stage", "town");
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });
});

describe("航海日志、提示与结局", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
  });

  it("每日提醒显示为航海日志条目", async () => {
    withOverview({
      notices: [
        { kind: "lowSupplies", args: [["fleet", "0"]] },
        { kind: "loanOverdue", args: [["loan", "2"]] },
      ],
    });
    render(<App />);
    const log = await screen.findByRole("region", { name: "航海日志" });
    const items = within(log).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["第 0 号舰队粮水不足 5 天", "第 2 号贷款逾期"]);
    expect(within(log).getByRole("status")).toBeInTheDocument();
  });

  it("操作提示是卷轴，点“知道了”收起；错误用警示角色", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("stage");
    act(() => useGame.getState().notify("已存档：save1"));
    expect(await screen.findByText("已存档：save1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByText("已存档：save1")).toBeNull();
    act(() => useGame.getState().fail("网络断了"));
    expect(await screen.findByRole("alert")).toHaveTextContent("出错了：网络断了");
  });

  it("结局横幅居中展开，点“继续经营”后收成小缎带，可以再次展开", async () => {
    const user = userEvent.setup();
    withOverview({ outcome: { kind: "Won", reason: "GoalReached", day: 400 } });
    render(<App />);
    const banner = await screen.findByTestId("outcome");
    expect(banner).toHaveTextContent("胜利！");
    expect(banner).toHaveTextContent("达成了剧本目标（第 400 天）");
    await user.click(within(banner).getByRole("button", { name: "继续经营" }));
    const chip = await screen.findByTestId("outcome");
    expect(chip).not.toHaveTextContent("达成了剧本目标");
    await user.click(within(chip).getByRole("button", { name: "查看结局：胜利！" }));
    expect(await screen.findByTestId("outcome")).toHaveTextContent("达成了剧本目标");
  });
});

describe("开机画面", () => {
  it("静态数据载入前显示标题与载入提示", () => {
    installIpc({ static_data: () => new Promise(() => {}) });
    useGame.setState({ statics: null, overview: null });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Manifest · 船货清单" })).toBeInTheDocument();
    expect(screen.getByText("正在载入……")).toBeInTheDocument();
  });
});

describe("界面贴图", () => {
  it("没有画布时不安装贴图变量，也不报错", () => {
    expect(installUiTheme()).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--ui-frame-wood")).toBe("");
  });

  it("每张贴图都能画出来，尺寸符合九宫格约定，且调色克制", () => {
    for (const tex of UI_TEXTURES) {
      const px = tex.draw();
      expect(px.bounds(), tex.name).not.toBeNull();
      expect(px.colorCount(), tex.name).toBeLessThanOrEqual(24);
      expect(tex.cssVar.startsWith("--ui-"), tex.name).toBe(true);
    }
    const frame = drawFrame("wood");
    expect(frame.w).toBe(FRAME_SLICE * 4);
    expect(frame.h).toBe(FRAME_SLICE * 4);
    // 中间透明（内容区由羊皮纸背景负责）
    expect(frame.isOpaque(frame.w / 2, frame.h / 2)).toBe(false);
    expect(drawPlaque().h).toBe(PLAQUE_H);
    expect(drawPlaque().w).toBe(PLAQUE_SLICE.h * 2 + 4);
    expect(drawRibbon("won").h).toBe(RIBBON_H);
    // 同样的输入永远画出同样的图
    expect(drawFrame("brass").data).toEqual(drawFrame("brass").data);
    expect(drawTitle("Manifest").w).toBeGreaterThan(50);
  });

  it("九宫格合成：四角保持原样，边沿平铺", () => {
    const src = drawFrame("wood");
    const S = FRAME_SLICE;
    const big = nineSlice(src, { t: S, r: S, b: S, l: S }, 100, 60);
    expect(big.w).toBe(100);
    expect(big.h).toBe(60);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        expect(big.get(x, y)).toBe(src.get(x, y));
        expect(big.get(100 - S + x, 60 - S + y)).toBe(src.get(src.w - S + x, src.h - S + y));
      }
    }
    expect(big.isOpaque(50, 30)).toBe(false);
  });
});
