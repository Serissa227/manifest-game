// 新界面（v2）的经营扩展画面（商队、产业、殖民地、探险；docs/UI-REDESIGN.md 第 8 节第 5 组）：
// 只在 v2 下做的小结构调整——规划结果与每日估算拆成小数字、收不回来的操作先确认（解散、出售、放弃）、
// 驮着货的商队不能解散并就地写明原因、装卸按钮写明数量、空状态的“下一步”、报告不了的原因就地写出；
// 以及旧界面（v1）下这些画面里没有任何 v2 的类、照旧直接做（原有的测试另在 panels-art、colony-ui、explore 里）。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useColonyUi } from "../components/colony/colonyUi";
import { FoundDialog } from "../components/colony/FoundDialog";
import CaravanPanel from "../components/panels/CaravanPanel";
import ColoniesPanel from "../components/panels/ColoniesPanel";
import ExplorePanel from "../components/panels/ExplorePanel";
import IndustryPanel from "../components/panels/IndustryPanel";
import { useShell } from "../components/shell/shellState";
import { setLocale } from "../i18n/locale";
import type { CaravanPlanView, CaravanView, FleetView, IndustriesView, Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { colonialOverview, colonialStatics, coloniesView, installIpc, overview, siteView, startedGame } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

/** 提交命令的调用（命令体）。 */
const submits = (calls: ReturnType<typeof installIpc>) =>
  calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, args]) => (args as { command: unknown }).command);

const ok = () => ({ outcome: "Done", overview: useGame.getState().overview ?? overview });

beforeEach(() => {
  setLocale("zh-CN");
  startedGame();
  useShell.setState({ windowOpen: true });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
});

// ───────────── 商队 ─────────────

const plan: CaravanPlanView = {
  stops: [0, 2],
  legs: [{ road: 0, from: 0, to: 2, length: 10, toll_bp: 200, robbery_bp: 160 }],
  days: 6,
  distance: 24,
  tolls: 250,
  risk_bp: 190,
  upkeep: 96,
};
const loaded: CaravanView = {
  id: 3,
  animal: 0,
  count: 7,
  guards: 2,
  at: 0,
  leg: null,
  dest: null,
  capacity: 140,
  cargo: [{ good: 0, qty: 30, avg_cost: 10 }],
  daily_cost: 29,
};
const emptyCaravan: CaravanView = { ...loaded, id: 4, cargo: [] };

function caravanGame(caravans: CaravanView[]) {
  useGame.setState({ overview: { ...overview, caravans } });
}

describe("商队（v2）", () => {
  it("规划结果拆成五项小数字；“组建商队”是主按钮；商队卡片的标题与副标题分开", async () => {
    installIpc({ caravan_plan: () => plan });
    setUiFor("v2");
    caravanGame([emptyCaravan]);
    render(<CaravanPanel />);
    const summary = await screen.findByTestId("caravan-plan");
    expect(summary.tagName).toBe("DL");
    const figures = [...summary.querySelectorAll("div")].map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    expect(figures).toEqual([
      ["路程", "6 天"],
      ["距离", "24 格"],
      ["关卡税", "250 金币"],
      ["遭劫风险", "1.9%"],
      ["路上开销", "96 金币"],
    ]);
    // 风险高于每日 1% 的那一项标红
    expect(within(summary).getByText("遭劫风险").parentElement).toHaveClass("is-risky");
    expect(screen.getByRole("button", { name: "组建商队（澄港）" })).toHaveClass("primary");
    const card = screen.getByText("商队 #4").closest("article") as HTMLElement;
    expect(within(card).getByText("骡 × 7 · 护卫 2 · 每天 29 金币")).toBeInTheDocument();
  });

  it("“遭劫风险”标红看逐段的每日概率：每段都安全的长路，累计过 1% 也不标红", async () => {
    // risk_bp 是整条路线累计的概率（逐日相乘），robbery_bp 才是每段的每日概率
    const longSafe: CaravanPlanView = {
      ...plan,
      legs: [
        { road: 0, from: 0, to: 1, length: 30, toll_bp: 0, robbery_bp: 40 },
        { road: 1, from: 1, to: 2, length: 30, toll_bp: 0, robbery_bp: 60 },
      ],
      days: 20,
      risk_bp: 900,
    };
    installIpc({ caravan_plan: () => longSafe });
    setUiFor("v2");
    caravanGame([emptyCaravan]);
    render(<CaravanPanel />);
    const summary = await screen.findByTestId("caravan-plan");
    const risk = within(summary).getByText("遭劫风险").parentElement as HTMLElement;
    expect(risk).not.toHaveClass("is-risky");
    expect(risk.querySelector("dd")?.textContent).toBe("9%");
    // 下面逐段路况也没有“危险”段
    expect(document.querySelectorAll(".pn-legs li.risky")).toHaveLength(0);
  });

  it("驮着货的商队不能解散：按钮不可用，原因就地写出并由 aria-describedby 指过去", async () => {
    installIpc({ caravan_plan: () => plan });
    setUiFor("v2");
    caravanGame([loaded]);
    render(<CaravanPanel />);
    const card = (await screen.findByText("商队 #3")).closest("article") as HTMLElement;
    const disband = within(card).getByRole("button", { name: "解散" });
    expect(disband).toBeDisabled();
    const why = within(card).getByText("驮着货不能解散：先卸下货物。");
    const box = why.closest("[data-testid='inline-error']") as HTMLElement;
    expect(box.id).not.toBe("");
    expect(disband).toHaveAttribute("aria-describedby", box.id);
    // 装卸货物仍然可以点
    expect(within(card).getByRole("button", { name: "装卸货物" })).toBeEnabled();
  });

  it("解散先确认：取消不提交，确认后提交 DisbandCaravan 并在提示条回一句", async () => {
    const calls = installIpc({ caravan_plan: () => plan, submit: ok });
    setUiFor("v2");
    caravanGame([emptyCaravan]);
    const user = userEvent.setup();
    render(<CaravanPanel />);
    const card = (await screen.findByText("商队 #4")).closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "解散" }));
    let ask = screen.getByRole("alertdialog", { name: "解散商队 #4？" });
    expect(ask).toHaveTextContent("驮畜折价卖掉、护卫遣散");
    await user.click(within(ask).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(submits(calls)).toEqual([]);

    await user.click(within(card).getByRole("button", { name: "解散" }));
    ask = screen.getByRole("alertdialog", { name: "解散商队 #4？" });
    await user.click(within(ask).getByRole("button", { name: "解散商队 #4" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ DisbandCaravan: { owner: "player", caravan: 4 } }]));
    await waitFor(() => expect(useGame.getState().message).toBe("商队 #4 已解散"));
  });

  it("还没有商队：空状态写一句怎么开始", async () => {
    installIpc({ caravan_plan: () => plan });
    setUiFor("v2");
    caravanGame([]);
    render(<CaravanPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("你还没有商队");
    expect(empty).toHaveTextContent("在上面选好路线与驮畜，点“组建商队”。");
  });
});

// ───────────── 产业 ─────────────

const industries: IndustriesView = {
  industries: [
    {
      id: 7,
      loc: 0,
      kind: 0,
      recipe: 0,
      level: 2,
      manager: false,
      stalled: false,
      book_value: 5001,
      input_stock: [[0, 4]],
      daily_revenue: 90,
      daily_inputs: 24,
      daily_costs: 25,
      daily_profit: 41,
    },
  ],
  sites: [0],
};

describe("产业（v2）", () => {
  it("每日估算拆成四项，日盈亏单独标出；“建设”是主按钮", async () => {
    installIpc({ industries: () => industries });
    setUiFor("v2");
    render(<IndustryPanel />);
    const dl = (await screen.findByText("日盈亏")).closest("dl") as HTMLElement;
    const figures = [...dl.querySelectorAll("div")].map((d) => [d.querySelector("dt")?.textContent, d.querySelector("dd")?.textContent]);
    expect(figures).toEqual([
      ["产出", "90 金币"],
      ["原料", "24 金币"],
      ["人工维护", "25 金币"],
      ["日盈亏", "41 金币"],
    ]);
    expect(within(dl).getByText("日盈亏").parentElement).toHaveClass("is-profit", "up");
    expect(screen.queryByText(/日估算：/)).toBeNull();
    expect(screen.getByRole("button", { name: "建设（5000 金币）" })).toHaveClass("primary");
  });

  it("出售先确认并写明能得多少（账面价值的一半）；确认后提交 SellIndustry", async () => {
    const calls = installIpc({ industries: () => industries, submit: ok });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<IndustryPanel />);
    await user.click(await screen.findByRole("button", { name: "出售" }));
    const ask = screen.getByRole("alertdialog", { name: "出售作坊（澄港）？" });
    expect(ask).toHaveTextContent("按账面价值的一半卖出，可得 2,500 金币。");
    expect(submits(calls)).toEqual([]);
    await user.click(within(ask).getByRole("button", { name: "出售，得 2,500 金币" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ SellIndustry: { owner: "player", industry: 7 } }]));
  });

  it("出售：问的时候“出售”按钮不被锁住，取消（Esc）后焦点回到“出售”上且没有提交", async () => {
    const calls = installIpc({ industries: () => industries, submit: ok });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<IndustryPanel />);
    const sellBtn = await screen.findByRole("button", { name: "出售" });
    await user.click(sellBtn);
    expect(screen.getByRole("alertdialog", { name: "出售作坊（澄港）？" })).toBeInTheDocument();
    expect(sellBtn).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sellBtn).toHaveFocus();
    expect(submits(calls)).toEqual([]);
  });

  it("还没有产业：空状态写一句怎么开始，不放第二个主按钮（建设表单就在下面，“建设”才是主按钮）", async () => {
    installIpc({ industries: () => ({ industries: [], sites: [0] }) });
    setUiFor("v2");
    render(<IndustryPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("你还没有产业");
    expect(empty).toHaveTextContent("在下面选好地点、类型与配方就能建。");
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(screen.getByRole("combobox", { name: "地点（需有仓库）" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((b) => b.classList.contains("primary"))).toHaveLength(1);
  });

  it("没有可以建设的地方：空状态说明要先有仓库，“下一步”打开港口的仓库页", async () => {
    installIpc({ industries: () => ({ industries: [], sites: [] }) });
    setUiFor("v2");
    useGame.setState({ tab: "industry", facility: "market" });
    const user = userEvent.setup();
    render(<IndustryPanel />);
    const site = (await screen.findByText("还没有可以建设产业的地方")).closest("[data-testid='empty-state']") as HTMLElement;
    await user.click(within(site).getByRole("button", { name: "去港口仓库" }));
    expect(useGame.getState().tab).toBe("port");
    expect(useGame.getState().facility).toBe("warehouse");
    expect(useShell.getState().windowOpen).toBe(true);
  });

  it("“去港口仓库”先选好港口：此刻选中的是殖民点（没有仓库页）时换成旗舰停靠的港口", async () => {
    installIpc({ industries: () => ({ industries: [], sites: [] }) });
    setUiFor("v2");
    useGame.setState({ statics: colonialStatics, selectedLoc: 3, tab: "industry", facility: "market" });
    const user = userEvent.setup();
    render(<IndustryPanel />);
    await user.click(await screen.findByRole("button", { name: "去港口仓库" }));
    expect(useGame.getState().selectedLoc).toBe(0);
    expect(useGame.getState().tab).toBe("port");
    expect(useGame.getState().facility).toBe("warehouse");
  });

  it("“去港口仓库”：没选地点、舰队在海上时去它正驶往的港口；都在海上漂着就改成打开航海图选港口", async () => {
    installIpc({ industries: () => ({ industries: [], sites: [] }) });
    setUiFor("v2");
    const atSea = { ...overview.fleets[0], docked: null, dest: 2 };
    useGame.setState({ overview: { ...overview, fleets: [atSea] }, selectedLoc: null, tab: "industry", facility: "market" });
    const user = userEvent.setup();
    const view = render(<IndustryPanel />);
    await user.click(await screen.findByRole("button", { name: "去港口仓库" }));
    expect(useGame.getState().selectedLoc).toBe(2);
    expect(useGame.getState().facility).toBe("warehouse");
    view.unmount();

    useGame.setState({ overview: { ...overview, fleets: [{ ...atSea, dest: null }] }, selectedLoc: null, tab: "industry", stage: "town" });
    render(<IndustryPanel />);
    await user.click(await screen.findByRole("button", { name: "打开航海图选港口" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useGame.getState().selectedLoc).toBeNull();
    expect(useShell.getState().windowOpen).toBe(false);
  });
});

// ───────────── 殖民地 ─────────────

const fleetAtSite: FleetView = {
  ...overview.fleets[0],
  docked: 3,
  x: 2,
  y: 0,
  crew: 40,
  capacity: 200,
  used: 70,
  cargo: [
    { good: 0, qty: 60, avg_cost: 12 },
    { good: 1, qty: 10, avg_cost: 90 },
  ],
};

function colonyGame(o: Overview = { ...colonialOverview, fleets: [fleetAtSite] }) {
  useGame.setState({ statics: colonialStatics, overview: o, selectedLoc: 3, selectedColony: 0 });
  useColonyUi.setState({ foundSite: null, focus: null });
}

describe("殖民地（v2）", () => {
  it("装卸按钮写明这一下搬多少；改了数量跟着变", async () => {
    const calls = installIpc({ submit: ok });
    setUiFor("v2");
    colonyGame();
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    const unload = await screen.findByTestId("unload-0");
    await user.click(within(unload).getByRole("button", { name: "一半" }));
    await user.click(within(unload).getByRole("button", { name: "卸货 30" }));
    await waitFor(() =>
      expect(submits(calls)).toEqual([{ Transfer: { owner: "player", from: { Fleet: 0 }, to: { Warehouse: 3 }, good: 0, qty: 30 } }]),
    );
    expect(within(screen.getByTestId("load-0")).getByRole("button", { name: "装船 130" })).toBeInTheDocument();
  });

  it("搬不了时写明原因（aria-describedby 指过去）：船舱满了按钮只写动作、原因在栏里写一次；超出空位写剩多少，“改成 N”一下改好", async () => {
    installIpc({ submit: ok });
    setUiFor("v2");
    // 船舱满了：不出现“装船 0”；原因在“殖民地库存”一栏的标题下写一次，不逐行重复
    colonyGame({ ...colonialOverview, fleets: [{ ...fleetAtSite, used: 200 }] });
    const user = userEvent.setup();
    const view = render(<ColoniesPanel />);
    let load = await screen.findByTestId("load-0");
    const full = within(load).getByRole("button", { name: "装船" });
    expect(full).toBeDisabled();
    expect(screen.getAllByText("船舱已满，装不下了")).toHaveLength(1);
    const why = screen.getByText("船舱已满，装不下了").closest("[data-testid='inline-error']") as HTMLElement;
    expect(why.id).not.toBe("");
    expect(full).toHaveAttribute("aria-describedby", why.id);
    expect(within(load).queryByTestId("inline-error")).toBeNull();
    expect(screen.queryByRole("button", { name: /改成/ })).toBeNull();
    // 能搬的行没有原因、也没有 aria-describedby
    const unload = screen.getByTestId("unload-0");
    expect(within(unload).getByRole("button", { name: "卸货 60" })).not.toHaveAttribute("aria-describedby");
    expect(within(unload).queryByTestId("inline-error")).toBeNull();
    view.unmount();

    // 还剩 40 的空位：填 100 就写明只剩 40，“改成 40”后可以装
    colonyGame({ ...colonialOverview, fleets: [{ ...fleetAtSite, used: 160 }] });
    render(<ColoniesPanel />);
    load = await screen.findByTestId("load-0");
    expect(within(load).getByRole("button", { name: "装船 40" })).toBeEnabled();
    const input = within(load).getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "100");
    const over = within(load).getByRole("button", { name: "装船 100" });
    expect(over).toBeDisabled();
    expect(within(load).getByText("船舱只剩 40 的空位")).toBeInTheDocument();
    await user.click(within(load).getByRole("button", { name: "改成 40" }));
    expect(within(load).getByRole("button", { name: "装船 40" })).toBeEnabled();
    expect(within(load).queryByTestId("inline-error")).toBeNull();
  });

  it("放弃殖民地用确认对话框：主按钮写清“放弃新晨港”，确认后提交并取消选中", async () => {
    const calls = installIpc({ submit: ok });
    setUiFor("v2");
    colonyGame();
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    await user.click(await screen.findByRole("button", { name: "放弃殖民地" }));
    const ask = screen.getByRole("alertdialog", { name: "放弃新晨港？" });
    expect(ask).toHaveTextContent("这里的殖民者、建筑与库存都将失去，无法恢复。");
    // 危险操作：打开时焦点在“取消”上
    expect(within(ask).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(within(ask).getByRole("button", { name: "放弃新晨港" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ AbandonColony: { owner: "player", colony: 0 } }]));
    await waitFor(() => expect(useGame.getState().selectedColony).toBeNull());
  });

  it("还没有殖民地：空状态的“下一步”切到航海图并收起窗口", async () => {
    installIpc({ colonies: () => ({ colonies: [], slots_left: 5 }) });
    setUiFor("v2");
    colonyGame({ ...colonialOverview, colonies: [], site_claims: [] });
    useGame.setState({ stage: "town", selectedLoc: 0, selectedColony: null });
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("你还没有殖民地");
    await user.click(within(empty).getByRole("button", { name: "打开航海图找殖民点" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("“建立殖民地”对话框：底部按钮与共用的确认对话框同一个顺序——“取消”在前、主按钮在后；v1 照旧是“立下界碑、取消”", async () => {
    installIpc({});
    colonyGame({ ...colonialOverview, colonies: [], site_claims: [], fleets: [fleetAtSite] });
    for (const ui of ["v2", "v1"] as const) {
      setUiFor(ui);
      const { unmount } = render(<FoundDialog site={siteView} />);
      const dialog = await screen.findByRole("dialog", { name: "在银雾河口建立殖民地" });
      const footer = dialog.querySelector("footer") as HTMLElement;
      expect(within(footer).getAllByRole("button").map((b) => b.textContent)).toEqual(ui === "v2" ? ["取消", "立下界碑"] : ["立下界碑", "取消"]);
      // 两种界面下“立下界碑”都是主按钮（只换了位置）
      expect(within(footer).getByRole("button", { name: "立下界碑" })).toHaveClass("primary");
      unmount();
    }
  });

  it("详情照常：名册、状态牌与建造选项都在（v2 只换样式）", async () => {
    installIpc({ colonies: () => coloniesView });
    setUiFor("v2");
    colonyGame();
    render(<ColoniesPanel />);
    expect(await screen.findByTestId("colony-detail-0")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "税率档位" })).toBeInTheDocument();
    expect(screen.getByTestId("colony-option-0")).toBeInTheDocument();
  });
});

// ───────────── 探险 ─────────────

describe("探险（v2）", () => {
  it("还没有任何发现：空状态的“下一步”打开航海图", async () => {
    installIpc({ discoveries: () => ({ fame: 0, found: [], total: 3, mate_fame: [], report_at: [] }) });
    setUiFor("v2");
    useGame.setState({ statics: colonialStatics, overview: colonialOverview, stage: "town" });
    const user = userEvent.setup();
    render(<ExplorePanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("航海日志上还没有记下任何发现");
    await user.click(within(empty).getByRole("button", { name: "打开航海图" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("没有停靠港口时，报告不了的原因就地写出（做不了，不是出错）", async () => {
    installIpc({ discoveries: () => ({ fame: 45, found: [{ id: 0, day: 8, reported: false, x: 2, y: 0 }], total: 1, mate_fame: [], report_at: [] }) });
    setUiFor("v2");
    useGame.setState({ statics: colonialStatics, overview: colonialOverview, selectedLoc: 3 });
    render(<ExplorePanel />);
    const why = await screen.findByText("舰队或商队停靠港口后，才能向当地商会报告发现。");
    const box = why.closest("[data-testid='inline-error']") as HTMLElement;
    expect(box).toHaveClass("is-blocked");
    expect(box).not.toHaveAttribute("role", "alert");
    expect(screen.queryByRole("button", { name: "报告" })).toBeNull();
  });
});

// ───────────── 旧界面不变 ─────────────

describe("旧界面（v1）", () => {
  it("四个画面里没有 v2 的类；空状态照旧是一句话、没有“下一步”按钮", async () => {
    installIpc({
      caravan_plan: () => plan,
      industries: () => ({ industries: [], sites: [] }),
      colonies: () => ({ colonies: [], slots_left: 5 }),
      discoveries: () => ({ fame: 0, found: [], total: 3, mate_fame: [], report_at: [] }),
    });
    useGame.setState({ statics: colonialStatics, overview: { ...colonialOverview, colonies: [], site_claims: [], caravans: [loaded] }, selectedLoc: 0, selectedColony: null });
    render(
      <>
        <CaravanPanel />
        <IndustryPanel />
        <ColoniesPanel />
        <ExplorePanel />
      </>,
    );
    expect(await screen.findByText("你还没有产业")).toHaveClass("empty");
    expect(await screen.findByText(/你还没有殖民地。带上移民/)).toHaveClass("empty");
    expect(await screen.findByText(/航海日志上还没有记下任何发现。/)).toHaveClass("empty");
    expect(screen.getByText("地点（需有仓库）", { selector: "p" })).toHaveClass("empty");
    expect(screen.queryByTestId("empty-state")).toBeNull();
    // 商队：规划结果仍是一句话，驮着货的“解散”照旧可点（由内核拒绝）
    await waitFor(() => expect(screen.getByTestId("caravan-plan").tagName).toBe("P"));
    expect(screen.getByRole("button", { name: "解散" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "组建商队（澄港）" })).not.toHaveClass("primary");
    expect(v2Classes()).toEqual([]);
  });

  it("v1 下解散、出售都直接提交（不问）", async () => {
    const calls = installIpc({ caravan_plan: () => plan, industries: () => industries, submit: ok });
    caravanGame([emptyCaravan]);
    const user = userEvent.setup();
    render(
      <>
        <CaravanPanel />
        <IndustryPanel />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "解散" }));
    await user.click(await screen.findByRole("button", { name: "出售" }));
    await waitFor(() =>
      expect(submits(calls)).toEqual([
        { DisbandCaravan: { owner: "player", caravan: 4 } },
        { SellIndustry: { owner: "player", industry: 7 } },
      ]),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
