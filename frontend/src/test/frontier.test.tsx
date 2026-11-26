// 西幻扩展的前端基础：殖民与探险的类型与命令、货币与纪年的格式化、顶栏的名声 / 殖民地 / 发现提示、
// 命令栏的“殖民地”“探险”与占位窗口、由殖民地摘要推算的航海日志提醒。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { useShell } from "../components/shell/shellState";
import { calendarYear, currency, dateText, dayDate, money, setWorld, t, tk } from "../i18n";
import { api } from "../ipc/api";
import type { Command, Overview, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import {
  colonialOverview,
  colonialStatics,
  coloniesView,
  discoveriesView,
  installIpc,
  overview,
  siteView,
  startedGame,
  statics,
} from "./fixtures";

function colonialGame(patch: Partial<Overview> = {}, s: StaticView = colonialStatics) {
  startedGame();
  useGame.setState({ statics: s, overview: { ...colonialOverview, ...patch } });
  useShell.setState({ windowOpen: true });
}

describe("殖民与探险的 IPC", () => {
  it("查询殖民地、殖民点与探险记录时按后端的命令名与参数调用", async () => {
    const calls = installIpc();
    expect(await api.colonies()).toEqual(coloniesView);
    expect(calls).toHaveBeenLastCalledWith("colonies", {});
    expect(await api.site(3)).toEqual(siteView);
    expect(calls).toHaveBeenLastCalledWith("site", { loc: 3 });
    expect(await api.discoveries()).toEqual(discoveriesView);
    expect(calls).toHaveBeenLastCalledWith("discoveries", {});
  });

  it("殖民与报告发现的命令以 manifest_core::Command 的 JSON 形式提交，结果带 ColonyFounded / DiscoveryReported", async () => {
    const calls = installIpc({
      submit: (args) => {
        const cmd = args.command as Record<string, unknown>;
        if ("FoundColony" in cmd) return { outcome: { ColonyFounded: { colony: 0 } }, overview: colonialOverview };
        if ("ReportDiscovery" in cmd) return { outcome: { DiscoveryReported: { reward: 4000, fame: 30 } }, overview };
        return { outcome: "Done", overview };
      },
    });
    const commands: Command[] = [
      { FoundColony: { owner: "player", fleet: 0, site: 3, name: "新晨港", settlers: 20 } },
      { BuildColony: { owner: "player", colony: 0, building: 1 } },
      { SetColonyTax: { owner: "player", colony: 0, rate: 2 } },
      { AbandonColony: { owner: "player", colony: 0 } },
      { ReportDiscovery: { owner: "player", discovery: 0, loc: 0 } },
      { Transfer: { owner: "player", from: { Fleet: 0 }, to: { Warehouse: 3 }, good: 0, qty: 60 } },
    ];
    const outcomes = [];
    for (const command of commands) {
      outcomes.push((await api.submit(command)).outcome);
      expect(calls).toHaveBeenLastCalledWith("submit", { command });
    }
    expect(outcomes[0]).toEqual({ ColonyFounded: { colony: 0 } });
    expect(outcomes[4]).toEqual({ DiscoveryReported: { reward: 4000, fame: 30 } });
    expect(outcomes[1]).toBe("Done");
  });
});

describe("货币与纪年", () => {
  afterEach(() => setWorld(statics.world));

  it("金额默认用“金币”，随静态数据的 world.currency 变化；字符串表里的 {cur} 同步", () => {
    setWorld(null);
    expect(currency()).toBe("金币");
    expect(money(12345)).toBe("12,345 金币");
    setWorld({ currency: "杜卡特", era: "航海历", start_year: 1502 });
    expect(money(1500.4)).toBe("1,500 杜卡特");
    expect(t("mtHire", { cost: 1500 })).toBe("招募（1500 杜卡特）");
    expect(t("syRepair", { cost: 30 })).toBe("修理全舰队（30 杜卡特）");
    expect(tk("log.DiscoveryReported", { owner: "你", loc: "澄港", discovery: "沉没的阿尔坎之门", reward: "4000", fame: "30" })).toBe(
      "你 在 澄港 的商会呈报「沉没的阿尔坎之门」，领得赏金 4,000 杜卡特，名声 +30",
    );
  });

  it("载入静态数据时（store 中的 statics 变化）自动设置货币与纪年", () => {
    useGame.setState({ statics: { ...statics, world: { currency: "弗罗林", era: "航海历", start_year: 1600 } } });
    expect(money(7)).toBe("7 弗罗林");
    expect(calendarYear(1)).toBe(1600);
    useGame.setState({ statics });
    expect(money(7)).toBe("7 金币");
    expect(calendarYear(1)).toBe(1502);
  });

  it("日期写作“1502年1月13日”：优先用 calendar_year，缺失时用 start_year + 年序 − 1，再缺失用 1502", () => {
    expect(dateText({ year: 3, month: 2, date: 9, calendar_year: 1520 })).toBe("1520年2月9日");
    setWorld({ currency: "金币", era: "航海历", start_year: 1490 });
    expect(dateText({ year: 3, month: 2, date: 9 })).toBe("1492年2月9日");
    setWorld(undefined);
    expect(dateText({ year: 3, month: 2, date: 9 })).toBe("1504年2月9日");
    // 绝对天数（从 0 起算）：每月 30 天、每年 360 天
    expect(dayDate(0)).toBe("1502年1月1日");
    expect(dayDate(12)).toBe("1502年1月13日");
    expect(dayDate(3600)).toBe("1512年1月1日");
    expect(dayDate(359)).toBe("1502年12月30日");
  });

  it("编年史年份与剧本限期按纪年显示；查表占位符把原因代码译成文字", () => {
    expect(t("itChronicleYear", { year: 1 })).toBe("1502年");
    expect(t("itChronicleYear", { year: 4 })).toBe("1505年");
    expect(t("goalDeadline", { day: 3600 })).toBe("（限 1512年1月1日前）");
    expect(tk("log.ColonyLost", { owner: "你", loc: "银雾河口", colony: "0", reason: "abandoned" })).toBe(
      "你 失去了 银雾河口 的殖民地 #0（主动放弃）",
    );
    expect(tk("log.ColonyLost", { owner: "你", loc: "银雾河口", colony: "0", reason: "sold" })).toContain("破产变卖");
    // 未知的原因代码原样显示；没给出的占位符原样保留
    expect(tk("log.ColonyLost", { owner: "你", loc: "银雾河口", colony: "0", reason: "odd" })).toContain("（odd）");
    expect(tk("log.ColonyLost", {})).toContain("{owner}");
  });

  it("新的日志类型、账簿用语与提醒都有文案", () => {
    const kinds = [
      "ColonyFounded",
      "ColonyBuilt",
      "ColonyStarving",
      "ColonyRaided",
      "ColonyEpidemic",
      "ColonyLost",
      "SiteClaimed",
      "Discovered",
      "DiscoveryReported",
      "ComposedEventStarted",
    ];
    for (const k of kinds) expect(tk(`log.${k}`)).not.toBe(`log.${k}`);
    for (const k of ["memo.Colony", "memo.Discovery", "flow.Colony", "flow.Discovery"]) expect(tk(k)).not.toBe(k);
    for (const k of ["notice.colonyStarving", "notice.colonyLowFood", "notice.discoveryUnreported"]) expect(tk(k)).not.toBe(k);
    expect(tk("log.SiteClaimed", { faction: "埃斯佩兰王国", loc: "银雾河口" })).toBe("埃斯佩兰王国 的旗帜插上了 银雾河口，此地从此归其所有");
  });
});

describe("顶部状态栏：纪年、名声、殖民地与发现提示", () => {
  beforeEach(() => {
    installIpc({ static_data: () => colonialStatics });
  });

  it("显示纪年日期、名声与殖民地数量；殖民地剧本的目标与限期", async () => {
    colonialGame({
      calendar_year: 1510,
      goal: { kind: "colonies", current: 1, target: 3, population: 200, deadline: 3600 },
    });
    render(<App />);
    const hud = await screen.findByTestId("hud");
    expect(screen.getByTestId("date")).toHaveTextContent("1510年1月13日（春）");
    expect(screen.getByTestId("fame")).toHaveTextContent("45");
    expect(within(hud).getByText("名声")).toBeInTheDocument();
    expect(screen.getByTestId("colonies")).toHaveTextContent("1 座");
    expect(screen.getByTestId("colonies").closest(".hud-stat")).toHaveAttribute("title", "新晨港：120 人，士气 62");
    expect(screen.getByTestId("goal")).toHaveTextContent("目标：殖民地 1 / 3 座（每座人口 ≥ 200）（限 1512年1月1日前）");
    expect(screen.getByRole("progressbar", { name: "剧本目标进度" })).toHaveAttribute("aria-valuenow", "33");
  });

  it("有未报告的发现时给出提示，点击打开探险窗口；没有时不显示", async () => {
    const user = userEvent.setup();
    colonialGame();
    const { unmount } = render(<App />);
    const hint = await screen.findByRole("button", { name: "1 项发现待报告" });
    expect(hint).toHaveAttribute("title", "到任意港口的商会报告发现，可领取赏金并扬名四海");
    await user.click(hint);
    expect(await screen.findByTestId("explore-panel")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "探险" })).toBeInTheDocument();
    unmount();

    colonialGame({ discoveries_unreported: 0 });
    render(<App />);
    await screen.findByTestId("hud");
    expect(screen.queryByTestId("discoveries-unreported")).toBeNull();
  });

  it("殖民地断粮时状态栏标红，航海日志出现断粮提醒；存粮不足时提醒存粮天数", async () => {
    colonialGame({
      colonies: [
        { ...colonialOverview.colonies[0], starving_days: 3, food_days: 0 },
        { id: 1, name: "琥珀湾", loc: 3, population: 40, morale: 55, starving_days: 0, food_days: 2, construction: null },
      ],
    });
    render(<App />);
    const stat = (await screen.findByTestId("colonies")).closest(".hud-stat");
    expect(stat).toHaveClass("hud-warn");
    expect(stat?.getAttribute("title")).toContain("新晨港：断粮 3 天！");
    const log = screen.getByRole("region", { name: "航海日志" });
    expect(within(log).getByText("新晨港 已断粮 3 天，殖民者正在饿死")).toBeInTheDocument();
    expect(within(log).getByText("琥珀湾 的存粮只够 2 天")).toBeInTheDocument();
  });
});

describe("命令栏：殖民地与探险", () => {
  beforeEach(() => {
    // App 挂载时会重新载入静态数据：让后端返回带殖民点与发现物的世界
    installIpc({ static_data: () => colonialStatics });
  });

  it("世界里有殖民点与发现物时，命令栏在“产业”后出现“殖民地”“探险”，各自打开占位窗口", async () => {
    const user = userEvent.setup();
    colonialGame();
    render(<App />);
    const bar = await screen.findByRole("tablist", { name: "功能面板" });
    const names = within(bar)
      .getAllByRole("tab")
      .map((b) => b.textContent);
    expect(names).toEqual(["港口", "舰队", "航海士", "期货", "行情", "商队", "产业", "殖民地", "探险", "报表", "情报", "设置"]);

    await user.click(within(bar).getByRole("tab", { name: "殖民地" }));
    // 占位窗口：只检查 testid 与窗口名称（殖民地界面会重写窗口内容）
    expect(await screen.findByTestId("colonies-panel")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "殖民地" })).toBeInTheDocument();
    expect(within(bar).getByRole("tab", { name: "殖民地" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("game-window")).toHaveClass("gw-center", "gw-large");

    await user.click(within(bar).getByRole("tab", { name: "探险" }));
    expect(await screen.findByTestId("explore-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("colonies-panel")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "探险" })).toBeInTheDocument();
  });

  it("没有扩展内容的旧数据不出现这两个按钮；已有殖民地时仍出现“殖民地”", async () => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    const { unmount } = render(<App />);
    const bar = await screen.findByRole("tablist", { name: "功能面板" });
    expect(within(bar).queryByRole("tab", { name: "殖民地" })).toBeNull();
    expect(within(bar).queryByRole("tab", { name: "探险" })).toBeNull();
    unmount();

    colonialGame({}, statics);
    render(<App />);
    const bar2 = await screen.findByRole("tablist", { name: "功能面板" });
    await waitFor(() => expect(within(bar2).getByRole("tab", { name: "殖民地" })).toBeInTheDocument());
    expect(within(bar2).queryByRole("tab", { name: "探险" })).toBeNull();
  });

  it("命令栏按钮的图标对辅助技术隐藏，按钮名称只有文字", async () => {
    colonialGame();
    render(<App />);
    const bar = await screen.findByRole("tablist", { name: "功能面板" });
    for (const name of ["殖民地", "探险"]) {
      const tab = within(bar).getByRole("tab", { name });
      expect(tab).toHaveAccessibleName(name);
      for (const c of tab.querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");
    }
  });
});
