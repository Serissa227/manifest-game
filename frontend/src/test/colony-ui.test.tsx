// 殖民地界面：殖民地窗口（名册、详情、建造、税率、装卸、放弃）、港口窗口里的殖民点与殖民地、
// 建立殖民地的完整流程（街景按钮 → 对话框 → FoundColony）、殖民地街景的建筑热点。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PLAYER_FLAG } from "../art/map";
import { useColonyUi } from "../components/colony/colonyUi";
import {
  colonySceneInput,
  raidMonthlyBp,
  raidRisk,
  suggestName,
  taxLevels,
  validName,
} from "../components/colony/model";
import ColoniesPanel from "../components/panels/ColoniesPanel";
import PortPanel from "../components/panels/PortPanel";
import PortScene from "../components/PortScene";
import { useShell } from "../components/shell/shellState";
import type { ColoniesView, ColonyView, FleetView, Overview, SiteView, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import {
  colonialOverview,
  colonialStatics,
  coloniesView,
  installIpc,
  overview,
  siteView,
  startedGame,
} from "./fixtures";

/** 停在殖民点（地点 3）的旗舰队：40 名船员，船上有 60 件谷物、10 件丝绸。 */
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

/** 殖民地 #0（新晨港）的详情。 */
const colony0: ColonyView = coloniesView.colonies[0];

/** 殖民点无人占领、玩家还没有殖民地的概览。 */
const wildOverview: Overview = { ...colonialOverview, colonies: [], site_claims: [], fleets: [fleetAtSite] };

/** 提交命令后，后端返回的概览保持“殖民地 + 旗舰队停在那里”。 */
function ipc(overrides: Parameters<typeof installIpc>[0] = {}) {
  return installIpc({ submit: () => ({ outcome: "Done", overview: useGame.getState().overview ?? overview }), ...overrides });
}

function withColony(patch: Partial<ColonyView>): ColoniesView {
  return { ...coloniesView, colonies: [{ ...colony0, ...patch }] };
}

/** 已开局，世界里有殖民点；默认有殖民地“新晨港”，旗舰队停在那里。 */
function colonyGame(o: Overview = { ...colonialOverview, fleets: [fleetAtSite] }, s: StaticView = colonialStatics) {
  startedGame();
  useGame.setState({ statics: s, overview: o, selectedLoc: 3, selectedColony: null });
  useColonyUi.setState({ foundSite: null, focus: null });
  useShell.setState({ windowOpen: true });
}

describe("殖民地的纯计算", () => {
  it("建议的殖民地名称：确定性、1–16 字，换一次通常会变", () => {
    const a = suggestName("silvermist_mouth", 0);
    expect(a).toBe(suggestName("silvermist_mouth", 0));
    expect(validName(a)).toBe(true);
    const names = new Set(Array.from({ length: 12 }, (_, i) => suggestName("silvermist_mouth", i)));
    expect(names.size).toBeGreaterThan(3);
    expect(validName("  ")).toBe(false);
    expect(validName("一二三四五六七八九十一二三四五六")).toBe(true);
    expect(validName("一二三四五六七八九十一二三四五六七")).toBe(false);
  });

  it("税率档位：收入按当前档位的估算线性换算，士气取规则里的增减", () => {
    const levels = taxLevels(colonialStatics, colony0);
    expect(levels.map((l) => l.share)).toEqual([0, 50, 100, 150, 200]);
    expect(levels.map((l) => l.morale)).toEqual([10, 5, 0, -10, -20]);
    expect(levels.map((l) => l.income)).toEqual([0, 72, 144, 216, 288]);
    // 当前免税：无法换算其他档位的收入
    expect(taxLevels(colonialStatics, { ...colony0, tax: 0, tax_estimate: 0 }).map((l) => l.income)).toEqual([0, null, null, null, null]);
  });

  it("袭击风险：每日概率换算成一个月内的概率并分档", () => {
    expect(raidMonthlyBp(0)).toBe(0);
    expect(raidMonthlyBp(12)).toBe(354);
    expect(raidRisk(12)).toBe("low");
    expect(raidRisk(40)).toBe("mid");
    expect(raidRisk(100)).toBe("high");
  });

  it("街景输入：你的殖民地按实际建筑画、势力据点按势力风格与旗色、无人殖民点画荒野", () => {
    const mine = colonySceneInput(colonialStatics, colonialOverview, 3, coloniesView);
    expect(mine).toEqual({ buildings: [{ key: "farm", level: 1 }], population: 120, style: "frontier", flag: PLAYER_FLAG });
    const claimed = colonySceneInput(
      colonialStatics,
      { ...colonialOverview, colonies: [], site_claims: [{ loc: 3, faction: 1, colony: null, mine: false }] },
      3,
      null,
    );
    expect(claimed?.style).toBe("lowland");
    expect(claimed?.flag).toBe("#2e86c1");
    expect(claimed?.buildings.map((b) => b.key)).toContain("fort");
    const styled = colonySceneInput(
      { ...colonialStatics, factions: colonialStatics.factions.map((f) => ({ ...f, style: "eastern" })) },
      { ...colonialOverview, colonies: [], site_claims: [{ loc: 3, faction: 1, colony: null, mine: false }] },
      3,
      null,
    );
    expect(styled?.style).toBe("eastern");
    expect(colonySceneInput(colonialStatics, wildOverview, 3, null)).toBeNull();
    // 港口不是殖民点
    expect(colonySceneInput(colonialStatics, colonialOverview, 0, coloniesView)).toBeNull();
  });
});

describe("殖民地窗口", () => {
  beforeEach(() => {
    installIpc();
    colonyGame();
  });

  it("名册列出殖民地；详情有状态牌、建筑卡片、在建工程、建造选项与槽位", async () => {
    render(<ColoniesPanel />);
    const panel = screen.getByTestId("colonies-panel");
    expect(await within(panel).findByText("还可建立 4 处殖民地（上限 5 处）")).toBeInTheDocument();
    const roster = screen.getByRole("navigation", { name: "你的殖民地" });
    const item = within(roster).getByRole("button", { name: /新晨港/ });
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(item).toHaveTextContent("120 人");
    expect(item).toHaveTextContent("士气 62");
    expect(item).toHaveTextContent("存粮 36 天");
    expect(item).toHaveTextContent("在建");

    const detail = screen.getByTestId("colony-detail-0");
    expect(within(detail).getByRole("heading", { name: "新晨港" })).toBeInTheDocument();
    expect(within(detail).getByText("1502年1月3日立下界碑 · 银雾河口 · 森林 · 账面价值 7,500 金币")).toBeInTheDocument();
    expect(within(detail).getByText("120 / 150")).toBeInTheDocument();
    expect(within(screen.getByTestId("colony-food")).getByText("36 天")).toBeInTheDocument();
    expect(within(detail).getByText("存粮 144 件 · 每天吃 4 件")).toBeInTheDocument();

    // 建筑卡片：殖民建筑图标（对辅助技术隐藏）、等级、每天产出
    const farm = screen.getByTestId("colony-building-0");
    expect(within(farm).getByText("农庄")).toBeInTheDocument();
    expect(within(farm).getByText("Lv1/3")).toBeInTheDocument();
    expect(within(farm).getByText("+7.2/天")).toBeInTheDocument();
    for (const c of farm.querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");

    // 在建工程：进度与完工日
    const k = screen.getByTestId("colony-construction");
    expect(within(k).getByText("栅栏堡 → Lv1")).toBeInTheDocument();
    expect(within(k).getByText("预计 1502年2月11日完工，还需 28 天")).toBeInTheDocument();

    // 建造选项：费用、工期、产出与不能开工的原因
    const up = screen.getByTestId("colony-option-0");
    expect(within(up).getByText("Lv1 → Lv2")).toBeInTheDocument();
    expect(within(up).getByText("费用 1,500 金币")).toBeInTheDocument();
    expect(within(up).getByText("工期 20 天")).toBeInTheDocument();
    expect(within(up).getByText("在此地产出谷物，产量 42%")).toBeInTheDocument();
    expect(within(up).getByText("已有工程在建")).toBeInTheDocument();
    expect(within(up).getByRole("button", { name: "升级" })).toBeDisabled();
    const fort = screen.getByTestId("colony-option-1");
    expect(within(fort).getByText("新建")).toBeInTheDocument();
    expect(within(fort).getByText("防御 +20")).toBeInTheDocument();
  });

  it("可开工的选项点“建造”提交 BuildColony；缺的建材标红", async () => {
    const calls = ipc({
      colonies: () =>
        withColony({
          construction: null,
          build_options: [
            { ...colony0.build_options[0], ok: false, reason: "仓库里建材不足", missing: [[0, 10]] },
            { ...colony0.build_options[1], ok: true, reason: null },
          ],
        }),
    });
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    const farm = await screen.findByTestId("colony-option-0");
    expect(within(farm).getByText("缺 10")).toBeInTheDocument();
    expect(within(farm).getByRole("button", { name: "升级" })).toBeDisabled();
    expect(screen.getByText("眼下没有在建工程。同一时间只能进行一项工程。")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("colony-option-1")).getByRole("button", { name: "建造" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { BuildColony: { owner: "player", colony: 0, building: 1 } } }),
    );
  });

  it("税率档位显示对收入与士气的影响；点其他档位提交 SetColonyTax，点当前档位不提交", async () => {
    const calls = ipc();
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    const group = await screen.findByRole("radiogroup", { name: "税率档位" });
    const light = within(group).getByRole("radio", { name: /^轻税/ });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(light).toHaveTextContent("月税收约 72 金币");
    const heavy = within(group).getByRole("radio", { name: /^重税/ });
    expect(heavy).toHaveAttribute("aria-checked", "false");
    expect(heavy).toHaveTextContent("收入 150%");
    expect(heavy).toHaveTextContent("士气 -10");
    expect(heavy).toHaveTextContent("月税收约 216 金币");
    await user.click(light);
    expect(calls.mock.calls.some(([cmd]) => cmd === "submit")).toBe(false);
    await user.click(heavy);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { SetColonyTax: { owner: "player", colony: 0, rate: 3 } } }),
    );
    // 士气构成里列出税率的影响
    const detail = screen.getByTestId("colony-detail-0");
    expect(within(detail).getByText("税率：轻税")).toBeInTheDocument();
  });

  it("舰队停在殖民地时可以装卸：卸货的“全部 / 一半”快捷键、装船的数量输入", async () => {
    const calls = ipc();
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    const unload = await screen.findByTestId("unload-0");
    const qty = within(unload).getByRole("spinbutton", { name: "谷物数量" });
    expect(qty).toHaveValue(60);
    await user.click(within(unload).getByRole("button", { name: "一半" }));
    expect(qty).toHaveValue(30);
    await user.click(within(unload).getByRole("button", { name: "全部" }));
    expect(qty).toHaveValue(60);
    await user.click(within(unload).getByRole("button", { name: "卸货" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { Transfer: { owner: "player", from: { Fleet: 0 }, to: { Warehouse: 3 }, good: 0, qty: 60 } },
      }),
    );

    // 装船：数量默认取“船上空位与库存中较小者”，可以改
    const load = screen.getByTestId("load-0");
    const lq = within(load).getByRole("spinbutton", { name: "谷物数量" });
    expect(lq).toHaveValue(130);
    await user.clear(lq);
    await user.type(lq, "25");
    await user.click(within(load).getByRole("button", { name: "装船" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { Transfer: { owner: "player", from: { Warehouse: 3 }, to: { Fleet: 0 }, good: 0, qty: 25 } },
      }),
    );
    // 丝绸也能卸
    expect(within(screen.getByTestId("unload-1")).getByText("丝绸")).toBeInTheDocument();
  });

  it("没有舰队停在殖民地时只列库存，并提示靠港后才能装卸", async () => {
    installIpc({ colonies: () => withColony({ fleets_here: [] }) });
    render(<ColoniesPanel />);
    const section = await screen.findByTestId("colony-cargo-section");
    expect(within(section).getByText("没有舰队停泊在此。船队停靠殖民地后，可以在这里装卸货物。")).toBeInTheDocument();
    expect(within(section).getByText("×144")).toBeInTheDocument();
    expect(screen.queryByTestId("unload-0")).toBeNull();
  });

  it("断粮时状态牌标红并给出警示", async () => {
    installIpc({ colonies: () => withColony({ starving_days: 3, food_days: 0 }) });
    render(<ColoniesPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("粮仓见底，已断粮 3 天！");
    expect(screen.getByTestId("colony-food")).toHaveClass("is-bad");
    expect(screen.getByRole("button", { name: /新晨港/ })).toHaveTextContent("断粮 3 天");
  });

  it("放弃殖民地要二次确认：取消不提交，确认后提交 AbandonColony", async () => {
    const calls = ipc();
    const user = userEvent.setup();
    useGame.setState({ selectedColony: 0 });
    render(<ColoniesPanel />);
    await user.click(await screen.findByRole("button", { name: "放弃殖民地" }));
    const ask = screen.getByRole("alertdialog", { name: "放弃殖民地" });
    expect(ask).toHaveTextContent("确定放弃 新晨港 吗？");
    await user.click(within(ask).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.mock.calls.some(([cmd]) => cmd === "submit")).toBe(false);

    await user.click(screen.getByRole("button", { name: "放弃殖民地" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认放弃" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { AbandonColony: { owner: "player", colony: 0 } } }),
    );
    await waitFor(() => expect(useGame.getState().selectedColony).toBeNull());
  });

  it("还没有殖民地时显示空状态", async () => {
    installIpc({ colonies: () => ({ colonies: [], slots_left: 5 }) });
    colonyGame(wildOverview);
    render(<ColoniesPanel />);
    expect(await screen.findByText(/你还没有殖民地/)).toBeInTheDocument();
    expect(screen.getByText("还可建立 5 处殖民地（上限 5 处）")).toBeInTheDocument();
  });
});

describe("港口窗口：殖民点与殖民地", () => {
  it("殖民点显示自然条件、资源、可建的生产建筑与建立条件，没有设施分页", async () => {
    installIpc();
    colonyGame(wildOverview);
    render(<PortPanel />);
    const panel = screen.getByTestId("port-panel");
    expect(within(panel).getByRole("heading", { name: "银雾河口 未开拓之地" })).toBeInTheDocument();
    const site = await screen.findByTestId("site-details");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(within(site).getByText(siteView.lore)).toBeInTheDocument();
    expect(within(site).getByText("地形：森林")).toBeInTheDocument();
    expect(within(site).getByText("肥力 60")).toBeInTheDocument();
    expect(within(site).getByText("险恶 30")).toBeInTheDocument();
    expect(within(site).getByText("丰度 70")).toBeInTheDocument();
    expect(within(site).getByText("农庄 → 谷物")).toBeInTheDocument();
    expect(within(site).getByText("产量 42%")).toBeInTheDocument();
    // 建立条件逐项检查
    expect(within(site).getByText("建立费 6,000 金币（现金 12,345 金币）").closest("li")).toHaveClass("ok");
    expect(within(site).getByText("谷物 60 件（船上 60）").closest("li")).toHaveClass("ok");
    expect(within(site).getByText("舰队 #0：可以建立")).toBeInTheDocument();
    expect(within(site).getByRole("button", { name: "建立殖民地" })).toBeEnabled();
  });

  it("殖民点被势力占领时说明归属，不提供建立按钮", async () => {
    const claimed: SiteView = {
      ...siteView,
      claim: { loc: 3, faction: 1, colony: null, mine: false },
      can_found: false,
      reason: "已被金穗占领",
      fleets_here: [[0, "已被金穗占领"]],
    };
    installIpc({ site: () => claimed });
    colonyGame({ ...wildOverview, site_claims: [claimed.claim!] });
    render(<PortPanel />);
    expect(await screen.findByTestId("site-claim")).toHaveTextContent("此地已被金穗占领，插上了他们的旗帜，不能再建立殖民地。");
    expect(screen.getByRole("heading", { name: "银雾河口 金穗的据点" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立殖民地" })).toBeNull();
  });

  it("舰队不在殖民点、船上缺物资时，逐项标出不满足的条件", async () => {
    installIpc({ site: () => ({ ...siteView, fleets_here: [] }) });
    colonyGame({ ...wildOverview, fleets: [{ ...fleetAtSite, docked: 0, cargo: [] }] });
    render(<PortPanel />);
    const site = await screen.findByTestId("site-details");
    expect(within(site).getByText("谷物 60 件（船上 0）").closest("li")).toHaveClass("bad");
    expect(within(site).getByText("须有你的舰队停泊在此")).toBeInTheDocument();
    expect(within(site).getByRole("button", { name: "建立殖民地" })).toBeDisabled();
  });

  it("你的殖民地：显示殖民地概况与装卸，按钮打开殖民地窗口", async () => {
    installIpc();
    colonyGame();
    const user = userEvent.setup();
    render(<PortPanel />);
    const here = await screen.findByTestId("colony-here");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(within(here).getByRole("heading", { name: "新晨港 · 你的殖民地" })).toBeInTheDocument();
    expect(await within(here).findByText("人口 120 · 士气 62 · 存粮 36 天")).toBeInTheDocument();
    expect(await within(here).findByTestId("unload-0")).toBeInTheDocument();
    useGame.setState({ tab: "port" });
    await user.click(within(here).getByRole("button", { name: "打开殖民地窗口" }));
    expect(useGame.getState().tab).toBe("colonies");
    expect(useGame.getState().selectedColony).toBe(0);
  });
});

describe("建立殖民地", () => {
  it("街景空地上的按钮 → 对话框 → 命名、殖民者人数 → 提交 FoundColony，成功后切到殖民地窗口", async () => {
    const founded: Overview = { ...colonialOverview, fleets: [{ ...fleetAtSite, crew: 15 }] };
    const calls = installIpc({
      submit: (args) => {
        const cmd = args.command as Record<string, unknown>;
        if ("FoundColony" in cmd) return { outcome: { ColonyFounded: { colony: 7 } }, overview: founded };
        return { outcome: "Done", overview: wildOverview };
      },
    });
    colonyGame(wildOverview);
    useGame.setState({ tab: "reports", stage: "town" });
    const user = userEvent.setup();
    render(
      <>
        <PortScene />
        <PortPanel />
      </>,
    );
    const scene = screen.getByTestId("port-scene");
    expect(within(scene).getByText("银雾河口")).toBeInTheDocument();
    expect(within(scene).getByText("森林 · 无主之地")).toBeInTheDocument();
    // 荒野没有设施热点
    expect(within(scene).queryByRole("group")).toBeNull();
    const btn = within(scene).getByRole("button", { name: "建立殖民地" });
    for (const c of btn.querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");
    await user.click(btn);
    expect(useColonyUi.getState().foundSite).toBe(3);
    expect(useGame.getState().tab).toBe("port");

    const dialog = await screen.findByRole("dialog", { name: "在银雾河口建立殖民地" });
    const name = within(dialog).getByRole("textbox", { name: "殖民地名称" });
    expect(name).toHaveValue(suggestName("silvermist_mouth", 0));
    await user.click(within(dialog).getByRole("button", { name: "换一个名字" }));
    expect(name).toHaveValue(suggestName("silvermist_mouth", 1));
    // 名字为空时不能建立
    await user.clear(name);
    expect(within(dialog).getByRole("button", { name: "立下界碑" })).toBeDisabled();
    await user.type(name, "晨星港");

    // 殖民者：至少 20 人，至多船员 40 − 最低船员 8 = 32 人
    const slider = within(dialog).getByRole("slider", { name: "殖民者人数" });
    expect(slider).toHaveAttribute("min", "20");
    expect(slider).toHaveAttribute("max", "32");
    // 默认取上限：多留人手开荒
    expect(slider).toHaveValue("32");
    fireEvent.change(slider, { target: { value: "25" } });
    expect(within(dialog).getByText("25 人留下开拓，舰队剩 15 名船员（至少 8 人）")).toBeInTheDocument();
    expect(within(dialog).getByText("建立费 6,000 金币（现金 12,345 金币）").closest("li")).toHaveClass("ok");

    await user.click(within(dialog).getByRole("button", { name: "立下界碑" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { FoundColony: { owner: "player", fleet: 0, site: 3, name: "晨星港", settlers: 25 } },
      }),
    );
    await waitFor(() => expect(useGame.getState().tab).toBe("colonies"));
    const g = useGame.getState();
    expect(g.selectedColony).toBe(7);
    expect(g.selectedLoc).toBe(3);
    expect(g.stage).toBe("town");
    expect(g.message).toBe("晨星港 建立了！25 名殖民者开始开垦这片土地。");
    expect(useColonyUi.getState().foundSite).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // 街景换成殖民地
    expect(await within(scene).findByText("殖民地 · 银雾河口")).toBeInTheDocument();
    expect(within(scene).queryByRole("button", { name: "建立殖民地" })).toBeNull();
  });

  it("船员不够时说明缺多少人，不能建立；取消关闭对话框", async () => {
    installIpc();
    colonyGame({ ...wildOverview, fleets: [{ ...fleetAtSite, crew: 25 }] });
    const user = userEvent.setup();
    render(<PortPanel />);
    await user.click(await screen.findByRole("button", { name: "建立殖民地" }));
    const dialog = await screen.findByRole("dialog", { name: "在银雾河口建立殖民地" });
    expect(within(dialog).getByText("船员不足：至少需要 28 人（殖民者 20 + 最低船员 8），舰队现有 25 人。")).toBeInTheDocument();
    expect(within(dialog).getByRole("slider", { name: "殖民者人数" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "立下界碑" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useColonyUi.getState().foundSite).toBeNull();
  });
});

describe("殖民地街景", () => {
  beforeEach(() => {
    installIpc();
    colonyGame();
  });

  it("殖民建筑都是按钮；点击打开殖民地窗口并定位到那座建筑；仓库打开装卸一节；没有市场", async () => {
    const user = userEvent.setup();
    useGame.setState({ tab: "port" });
    const { unmount } = render(<PortScene />);
    const scene = screen.getByTestId("port-scene");
    expect(scene).toHaveAttribute("data-scene", "colony");
    expect(within(scene).getByText("新晨港")).toBeInTheDocument();
    expect(within(scene).getByText("殖民地 · 银雾河口")).toBeInTheDocument();
    expect(within(scene).getByText("人口 120 · 士气 62")).toBeInTheDocument();
    const group = await screen.findByRole("group", { name: "新晨港的建筑" });
    const farm = await within(group).findByRole("button", { name: "农庄（1 级）" });
    expect(farm).toHaveAttribute("title", "农庄（1 级）");
    expect(within(group).queryByRole("button", { name: "交易所" })).toBeNull();
    expect(within(scene).queryByRole("button", { name: "建立殖民地" })).toBeNull();

    await user.click(farm);
    expect(useGame.getState().tab).toBe("colonies");
    expect(useGame.getState().selectedColony).toBe(0);
    expect(useColonyUi.getState().focus).toEqual({ building: 0 });
    unmount();

    // 殖民地窗口里那座建筑的卡片描金边
    render(<ColoniesPanel />);
    expect(await screen.findByTestId("colony-building-0")).toHaveClass("is-focus");
  });

  it("仓库热点打开殖民地窗口的装卸一节", async () => {
    const user = userEvent.setup();
    render(<PortScene />);
    const group = await screen.findByRole("group", { name: "新晨港的建筑" });
    await user.click(within(group).getByRole("button", { name: "仓库" }));
    expect(useGame.getState().tab).toBe("colonies");
    expect(useColonyUi.getState().focus).toEqual({ section: "cargo" });
  });

  it("势力据点画成势力风格的小聚落，名牌写明归属，不可进入也不能建立殖民地", async () => {
    colonyGame({ ...wildOverview, site_claims: [{ loc: 3, faction: 1, colony: null, mine: false }] });
    render(<PortScene />);
    const scene = screen.getByTestId("port-scene");
    expect(scene).toHaveAttribute("data-scene", "colony");
    expect(within(scene).getByText("金穗的据点")).toBeInTheDocument();
    expect(within(scene).queryByRole("group")).toBeNull();
    expect(within(scene).queryByRole("button", { name: "建立殖民地" })).toBeNull();
  });
});
