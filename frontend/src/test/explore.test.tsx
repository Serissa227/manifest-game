// 探险与情报（西幻扩展第二批）：探险窗口的名声、发现卡片与“向商会报告”、情报窗口的组合事件卡片、
// 设置里的结构化输出开关与组合事件说明、航海士的名声门槛（模拟的 Tauri IPC，不调用任何真实服务）。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ExplorePanel from "../components/panels/ExplorePanel";
import IntelPanel from "../components/panels/IntelPanel";
import MatesPanel from "../components/panels/MatesPanel";
import SettingsPanel from "../components/panels/SettingsPanel";
import type { AppSettings, DiscoveriesView, EffectView, EventView, IntelView, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import {
  colonialOverview,
  colonialStatics,
  discoveriesView,
  installIpc,
  mate,
  mates,
  overview,
  settingsView,
  startedGame,
} from "./fixtures";

/** 带六类中两类发现物的静态数据：遗迹（已发现）与沉船（未发现）。 */
const exploreStatics: StaticView = {
  ...colonialStatics,
  discoveries: [
    ...colonialStatics.discoveries,
    { id: 1, key: "morning_star_wreck", name: "晨星号残骸", kind: "wreck", fame: 20, value: 2500, lore: "首航者的旗舰在归途中触礁。" },
  ],
};

function colonialGame(s: StaticView = colonialStatics) {
  startedGame();
  useGame.setState({ statics: s, overview: colonialOverview });
}

function effect(patch: Partial<EffectView>): EffectView {
  return {
    effect: "location_supply",
    label: "当地生产",
    hint: "产量下降",
    loc: null,
    good: null,
    region: null,
    faction_a: null,
    faction_b: null,
    mult_bp: null,
    days: null,
    delta: null,
    end: null,
    ...patch,
  };
}

/** 进行中的组合事件（AI 生成）：三条效果。 */
const fire: EventView = {
  name: "维拉马雷港大火",
  description: "码头区夜间起火，半条货栈街化为焦土。",
  start: 10,
  end: 75,
  place: ["澄港", "木材"],
  origin: "composed",
  id: 3,
  source: "ai",
  title: "维拉马雷港大火",
  narrative: "码头区夜间起火，半条货栈街化为焦土。",
  effects: [
    effect({ effect: "demand_shift", label: "当地商品需求", hint: "需求旺盛", loc: "澄港", good: "木材", mult_bp: 15000, days: 45, end: 55 }),
    effect({ effect: "location_supply", label: "当地生产", hint: "产量下降", loc: "澄港", mult_bp: 7000, days: 30, end: 40 }),
    effect({ effect: "relation_shift", label: "两国关系", hint: "外交风向变化", faction_a: "翠岚", faction_b: "金穗", delta: -12 }),
  ],
  active: true,
};

/** 已结束的组合事件（离线模板）：海区与全局效果。 */
const pirates: EventView = {
  name: "海盗季",
  description: "南风一起，海盗船便从礁湾里钻出来。",
  start: 0,
  end: 9,
  place: ["内海"],
  origin: "composed",
  id: 1,
  source: "template",
  title: "海盗季",
  narrative: "南风一起，海盗船便从礁湾里钻出来。",
  effects: [
    effect({ effect: "region_pirates", label: "海区海盗", hint: "海盗猖獗", region: "内海", mult_bp: 17500, days: 60, end: 60 }),
    effect({ effect: "interest_shift", label: "银行利率", hint: "银根收紧", mult_bp: 11000, days: 90, end: 90 }),
  ],
  active: false,
};

describe("探险窗口", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc({
      discoveries: () => ({ ...discoveriesView, total: 5 }),
      submit: (args) => {
        const cmd = args.command as Record<string, unknown>;
        if ("ReportDiscovery" in cmd) return { outcome: { DiscoveryReported: { reward: 4000, fame: 30 } }, overview: colonialOverview };
        return { outcome: "Done", overview: colonialOverview };
      },
    });
    colonialGame();
  });

  it("显示名声与下一档航海士门槛、发现进度、发现卡片与“？？？”", async () => {
    render(<ExplorePanel />);
    expect(await screen.findByTestId("explore-fame")).toHaveTextContent("名声45");
    expect(screen.getByText("再得 15 点名声，可招募 5 级航海士")).toBeInTheDocument();
    const ladder = screen.getByRole("list", { name: "航海士招募门槛" });
    expect(within(ladder).getByText("4 级航海士 · 名声 20").parentElement).toHaveClass("is-ok");
    expect(within(ladder).getByText("5 级航海士 · 名声 60").parentElement).not.toHaveClass("is-ok");
    expect(screen.getByText("已发现 1 / 5")).toBeInTheDocument();
    expect(screen.getByText("待报告 1 项")).toBeInTheDocument();

    const card = screen.getByTestId("discovery-0");
    expect(within(card).getByRole("heading", { name: "沉没的阿尔坎之门" })).toBeInTheDocument();
    expect(within(card).getByText("遗迹")).toBeInTheDocument();
    expect(within(card).getByText("发现于 1502年1月9日")).toBeInTheDocument();
    expect(within(card).getByText("海图坐标 2, 0")).toBeInTheDocument();
    expect(within(card).getByText("“退潮时，古帝国的石门从海面下露出拱顶。”")).toBeInTheDocument();
    expect(within(card).getByText("赏金 4,000 金币 · 名声 +30")).toBeInTheDocument();
    expect(within(card).getByText("待报告")).toBeInTheDocument();

    // 尚未发现的只给出数量，不泄露名字
    const unknown = screen.getByTestId("discovery-unknown");
    expect(within(unknown).getByText("？？？ × 4")).toBeInTheDocument();
    expect(within(unknown).getByText("海图上还有 4 处未解之谜，等着你的船队去望见。")).toBeInTheDocument();
    // 六类统计：遗迹 1/1，其余 0/0
    const kinds = screen.getByRole("group", { name: "各类发现" });
    expect(within(kinds).getByRole("button", { name: /遗迹\s*1 \/ 1/ })).toBeInTheDocument();
    for (const k of ["奇观", "沉船", "遗物", "海兽", "地标"]) {
      expect(within(kinds).getByRole("button", { name: new RegExp(`${k}\\s*0 / 0`) })).toBeInTheDocument();
    }
    // 像素图章与图标都对辅助技术隐藏
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("停靠港口时向商会报告：命令参数为发现物与港口，报告后显示领到的赏金与名声", async () => {
    const user = userEvent.setup();
    render(<ExplorePanel />);
    expect(await screen.findByText("停靠 澄港：可以向当地商会报告发现，领取赏金与名声。")).toBeInTheDocument();
    const card = screen.getByTestId("discovery-0");
    await user.click(within(card).getByRole("button", { name: "向商会报告" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { ReportDiscovery: { owner: "player", discovery: 0, loc: 0 } } }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "在 澄港 的商会呈报「沉没的阿尔坎之门」：领得赏金 4,000 金币，名声 +30",
    );
  });

  it("停靠多个港口时可选择报告港口；没有停靠港口时不能报告；已报告的盖“已报告”章", async () => {
    const user = userEvent.setup();
    calls = installIpc({
      discoveries: () => ({ ...discoveriesView, report_at: [0, 1] }),
      submit: () => ({ outcome: { DiscoveryReported: { reward: 4000, fame: 30 } }, overview: colonialOverview }),
    });
    const { unmount } = render(<ExplorePanel />);
    await user.selectOptions(await screen.findByLabelText("报告港口"), "1");
    await user.click(within(screen.getByTestId("discovery-0")).getByRole("button", { name: "向商会报告" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { ReportDiscovery: { owner: "player", discovery: 0, loc: 1 } } }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("在 柳湾 的商会呈报");
    unmount();

    installIpc({ discoveries: () => ({ ...discoveriesView, report_at: [] }) });
    const second = render(<ExplorePanel />);
    expect(await screen.findByText("舰队或商队停靠港口后，才能向当地商会报告发现。")).toBeInTheDocument();
    expect(within(screen.getByTestId("discovery-0")).queryByRole("button")).toBeNull();
    second.unmount();

    const reported: DiscoveriesView = { ...discoveriesView, found: [{ ...discoveriesView.found[0], reported: true }] };
    installIpc({ discoveries: () => reported });
    render(<ExplorePanel />);
    const card = await screen.findByTestId("discovery-0");
    expect(within(card).getByText("已报告")).toHaveClass("is-done");
    expect(within(card).queryByRole("button")).toBeNull();
    expect(screen.queryByText("舰队或商队停靠港口后，才能向当地商会报告发现。")).toBeNull();
  });

  it("按种类筛选；多项待报告时可以全部报告", async () => {
    const user = userEvent.setup();
    useGame.setState({ statics: exploreStatics });
    calls = installIpc({
      discoveries: () => ({
        ...discoveriesView,
        total: 2,
        found: [
          { id: 0, day: 8, reported: false, x: 2, y: 0 },
          { id: 1, day: 20, reported: false, x: 3, y: 2 },
        ],
      }),
      submit: (args) => {
        const cmd = args.command as { ReportDiscovery: { discovery: number } };
        const id = cmd.ReportDiscovery.discovery;
        return { outcome: { DiscoveryReported: { reward: id === 0 ? 4000 : 2500, fame: id === 0 ? 30 : 20 } }, overview: colonialOverview };
      },
    });
    render(<ExplorePanel />);
    // 新发现的在前
    const cards = await screen.findAllByTestId(/^discovery-\d$/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(["discovery-1", "discovery-0"]);

    const kinds = screen.getByRole("group", { name: "各类发现" });
    await user.click(within(kinds).getByRole("button", { name: /沉船/ }));
    expect(within(kinds).getByRole("button", { name: /沉船/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("discovery-1")).toBeInTheDocument();
    expect(screen.queryByTestId("discovery-0")).toBeNull();
    await user.click(within(kinds).getByRole("button", { name: /奇观/ }));
    expect(screen.getByText("这一类还没有发现。")).toBeInTheDocument();
    await user.click(within(kinds).getByRole("button", { name: "全部" }));

    await user.click(screen.getByRole("button", { name: "全部报告（2 项）" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { ReportDiscovery: { owner: "player", discovery: 0, loc: 0 } } }),
    );
    expect(calls).toHaveBeenCalledWith("submit", { command: { ReportDiscovery: { owner: "player", discovery: 1, loc: 0 } } });
    expect(await screen.findByRole("status")).toHaveTextContent("在 澄港 的商会呈报 2 项发现：领得赏金 6,500 金币，名声 +50");
  });

  it("还没有任何发现时给出空白日志的提示", async () => {
    installIpc({ discoveries: () => ({ ...discoveriesView, found: [], total: 30 }) });
    render(<ExplorePanel />);
    expect(await screen.findByText(/航海日志上还没有记下任何发现/)).toBeInTheDocument();
    expect(screen.getByText("？？？ × 30")).toBeInTheDocument();
  });
});

describe("情报：组合事件卡片", () => {
  beforeEach(() => {
    startedGame();
  });

  it("标题、叙事、逐条效果（对象 · 方向与幅度 · 持续）、来源与进行中 / 已结束；目录事件照旧", async () => {
    const intel: IntelView = {
      news: [],
      events: [{ name: "丝路节", description: "每年一度的集市。", start: 5, end: 20, place: ["澄港"], origin: "catalog" }, fire],
      log: [
        {
          day: 12,
          kind: "DiscoveryReported",
          args: [
            ["owner", "player"],
            ["loc", "澄港"],
            ["discovery", "沉没的阿尔坎之门"],
            ["reward", "4000"],
            ["fame", "30"],
          ],
          mine: true,
        },
        { day: 13, kind: "ColonyLost", args: [["owner", "player"], ["loc", "银雾河口"], ["colony", "0"], ["reason", "depopulated"]], mine: true },
        { day: 14, kind: "ComposedEventStarted", args: [["composed", "3"], ["title", "维拉马雷港大火"], ["loc", "澄港"]], mine: false },
      ],
      chronicles: [],
      composed: [fire, pirates],
    };
    installIpc({ intel: () => intel });
    render(<IntelPanel />);
    // 目录事件照旧逐条列出；进行中的组合事件不重复出现在这里
    expect(await screen.findByText("丝路节（澄港）第 5–20 天")).toBeInTheDocument();
    const section = screen.getByTestId("intel-composed");
    expect(within(section).getByRole("heading", { name: "大事记" })).toBeInTheDocument();
    expect(within(section).getAllByRole("heading", { name: "维拉马雷港大火" })).toHaveLength(1);

    const live = screen.getByTestId("composed-3");
    expect(live).toHaveClass("is-active");
    expect(within(live).getByText("AI 生成")).toBeInTheDocument();
    expect(within(live).getByText("进行中")).toBeInTheDocument();
    expect(within(live).getByText("1502年1月11日 – 1502年3月16日")).toBeInTheDocument();
    expect(within(live).getByText("“码头区夜间起火，半条货栈街化为焦土。”")).toBeInTheDocument();
    const effects = within(live).getByRole("list", { name: "维拉马雷港大火 的效果" });
    const lines = within(effects)
      .getAllByRole("listitem")
      .map((li) => [li.querySelector(".pn-ce-label")?.textContent, li.querySelector(".pn-ce-text")?.textContent]);
    expect(lines).toEqual([
      ["当地商品需求", "澄港 · 木材 · 需求旺盛 +50% · 持续 45 天"],
      ["当地生产", "澄港 · 产量下降 −30% · 持续 30 天"],
      ["两国关系", "翠岚 ↔ 金穗 · 外交风向变化 −12 · 一次性"],
    ]);
    expect(within(effects).getAllByRole("listitem")[0]).toHaveAttribute("title", "至 1502年2月26日");

    const ended = screen.getByTestId("composed-1");
    expect(ended).toHaveClass("is-ended");
    expect(within(ended).getByText("离线模板")).toBeInTheDocument();
    expect(within(ended).getByText("已结束")).toBeInTheDocument();
    expect(within(ended).getByText("内海 · 海盗猖獗 +75% · 持续 60 天")).toBeInTheDocument();
    expect(within(ended).getByText("各地 · 银根收紧 +10% · 持续 90 天")).toBeInTheDocument();

    // 日志：日期按纪年；reward 与 reason 由字符串表格式化
    expect(screen.getByText("你 在 澄港 的商会呈报「沉没的阿尔坎之门」，领得赏金 4,000 金币，名声 +30")).toBeInTheDocument();
    expect(screen.getByText("你 失去了 银雾河口 的殖民地 #0（人烟断绝）")).toBeInTheDocument();
    expect(screen.getByText("大事记：维拉马雷港大火")).toBeInTheDocument();
    expect(screen.getAllByText("1502年1月13日").length).toBeGreaterThan(0);
    // 图标对辅助技术隐藏
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("旧后端没有 composed 字段时，从进行中的事件里取组合事件；都没有时给出提示", async () => {
    installIpc({ intel: () => ({ news: [], events: [fire], log: [], chronicles: [] }) });
    const { unmount } = render(<IntelPanel />);
    expect(await screen.findByTestId("composed-3")).toBeInTheDocument();
    expect(screen.getAllByText("暂无").length).toBeGreaterThan(0);
    unmount();

    installIpc();
    render(<IntelPanel />);
    expect(await screen.findByText("近来海上风平浪静，没有值得记下的大事。")).toBeInTheDocument();
  });
});

describe("设置：结构化输出与组合事件说明", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("结构化输出默认开启，关闭后随设置一起保存", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const box = await screen.findByLabelText("结构化输出（工具调用 / JSON Schema）");
    expect(box).toBeChecked();
    expect(screen.getByText(/Anthropic 用工具调用/)).toBeInTheDocument();
    // 组合事件的说明：由结构约束、裁决与内核校验、如何接入、效果词表
    const help = screen.getByTestId("settings-composed");
    expect(within(help).getByRole("heading", { name: "AI 组合事件" })).toBeInTheDocument();
    expect(within(help).getByText(/内核按 data\/effects\.toml 的边界校验/)).toBeInTheDocument();
    expect(within(help).getByRole("heading", { name: "如何接入在线模型" })).toBeInTheDocument();
    expect(within(help).getAllByRole("listitem").length).toBeGreaterThanOrEqual(9);
    expect(within(help).getByText("海区：风暴、海盗")).toBeInTheDocument();

    await user.click(box);
    expect(box).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.ai.structured).toBe(false);
    expect(saved.ai.mode).toBe(settingsView.settings.ai.mode);
  });

  it("设置里已关闭时显示为未勾选，重新勾选后保存为开启", async () => {
    const user = userEvent.setup();
    const off = { ...settingsView, settings: { ...settingsView.settings, ai: { ...settingsView.settings.ai, structured: false } } };
    calls = installIpc({ get_settings: () => off, save_settings: (a) => ({ ...off, settings: a.settings }) });
    render(<SettingsPanel />);
    const box = await screen.findByLabelText("结构化输出（工具调用 / JSON Schema）");
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.ai.structured).toBe(true);
  });
});

describe("航海士：名声门槛", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    startedGame();
    useGame.setState({ overview: { ...overview, fame: 45 } });
    calls = installIpc({
      mates: () => ({
        hired: mates.hired,
        available: [
          { ...mate, id: 5, name: "维达尔·霍尔姆斯特兰", level: 5, hire_cost: 6000 },
          { ...mate, id: 4, name: "海莉亚·瓦伊莫阿", level: 4, hire_cost: 4000 },
          { ...mate, id: 2, name: "扬·范德科伦", level: 5, at: 1 },
        ],
      }),
    });
  });

  it("高等级航海士标出所需名声；名声不足时招募按钮禁用并说明，够了可以招募", async () => {
    const user = userEvent.setup();
    render(<MatesPanel />);
    // 5 级需要名声 60，现有 45：禁用并说明
    const high = await screen.findByTestId("recruit-5");
    await waitFor(() => expect(within(high).getByText("需名声 60")).toHaveClass("short"));
    expect(within(high).getByText("名声不足：需要 60，现有 45。到港口商会报告探险发现可以提升名声。")).toBeInTheDocument();
    expect(within(high).getByRole("button", { name: "招募（6,000 金币）" })).toBeDisabled();

    // 4 级需要名声 20：可以招募
    const mid = screen.getByTestId("recruit-4");
    expect(within(mid).getByText("需名声 20")).not.toHaveClass("short");
    expect(within(mid).queryByText(/名声不足/)).toBeNull();
    await user.click(within(mid).getByRole("button", { name: "招募（4,000 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireMate: { owner: "player", mate: 4 } } }));

    // 不在停靠港口的航海士只显示门槛，没有招募按钮
    const away = screen.getByTestId("recruit-2");
    expect(within(away).getByText("需名声 60")).toBeInTheDocument();
    expect(within(away).queryByRole("button")).toBeNull();
    // 招募按钮上的图标不改变可访问名称
    expect(within(high).getByRole("button", { name: "招募（6,000 金币）" })).toHaveAccessibleName("招募（6,000 金币）");
  });
});
