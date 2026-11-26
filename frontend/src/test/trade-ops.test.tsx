// 交易操作现代化：交易所以外的几处——仓库页的装卸台（舰队、商队、仓库之间搬货）、商队的“装卸货物”入口、
// 舰队页的“购买补给”、船厂（卖船要确认、卖不了写明原因、每艘船自己的改造、钱不够的买船按钮）、酒馆按人数招募船员的加减。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import CaravanPanel from "../components/panels/CaravanPanel";
import FleetPanel from "../components/panels/FleetPanel";
import PortPanel from "../components/panels/PortPanel";
import { fitMoves, sellShipBlock, type Load } from "../components/panels/trade";
import { useShell } from "../components/shell/shellState";
import { setLocale } from "../i18n/locale";
import type { Overview, PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, port, startedGame, statics } from "./fixtures";

const submits = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, a]) => a.command);

/** 机器很忙时（几个工作树同时跑测试）交互多的用例会慢好几倍：单项给 15 秒，等一连串异步的结果给 4 秒。只是等得久一点，断言一条没少。 */
const HEAVY = 15_000;
const SLOW = { timeout: 4_000 };

/** 港口有 200 容量的仓库（放着木材 60 件）与商队 #3；舰队装着谷物 30 件。 */
const withWarehouse: PortView = {
  ...port,
  caravans_here: [3],
  warehouse: { rented: 200, owned: 0, capacity: 200, used: 60, stock: [{ good: 1, qty: 60, avg_cost: 80 }] },
};
const loaded: Overview = {
  ...overview,
  fleets: [{ ...overview.fleets[0], used: 50, cargo: [{ good: 0, qty: 30, avg_cost: 10 }] }],
  caravans: [{ id: 3, animal: 0, count: 4, guards: 1, at: 0, leg: null, dest: null, capacity: 80, cargo: [], daily_cost: 16 }],
};

describe("仓库页的装卸台", { timeout: HEAVY }, () => {
  beforeEach(() => {
    setLocale("zh-CN");
    startedGame();
    useGame.setState({ overview: loaded, facility: "warehouse" });
  });

  it("两边默认是旗舰队与仓库；每行调要搬的数量，底下合计两边各搬几件，“搬运”逐行提交 Transfer", async () => {
    const calls = installIpc({ port: () => withWarehouse, overview: () => loaded, submit: () => ({ outcome: "Done", overview: loaded }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    const desk = await screen.findByTestId("transfer-desk");
    expect(within(desk).getByRole("combobox", { name: "这边" })).toHaveDisplayValue("舰队 #0");
    expect(within(desk).getByRole("combobox", { name: "那边" })).toHaveDisplayValue("本地仓库");
    // 舰队的谷物搬 10 件去仓库，仓库的丝绸（这里是木材）搬 5 件回船
    const grain = screen.getByTestId("tr-lr-0");
    const qty = within(grain).getByRole("spinbutton", { name: "谷物搬到本地仓库的数量" });
    await user.clear(qty);
    await user.type(qty, "10");
    const silk = screen.getByTestId("tr-rl-1");
    await user.click(within(silk).getByRole("button", { name: /^多搬 1 件/ }));
    await user.keyboard("{Shift>}");
    await user.click(within(silk).getByRole("button", { name: /^多搬 1 件/ }));
    await user.keyboard("{/Shift}");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(11);
    const foot = screen.getByTestId("tr-foot");
    expect(foot).toHaveTextContent("到本地仓库：1 种 10 件");
    expect(foot).toHaveTextContent("到舰队 #0：1 种 11 件");
    // 搬完后的装载写在两边
    expect(within(screen.getByTestId("tr-side-lr")).getByText(/装载 50 \/ 80/)).toHaveTextContent("→ 51");
    await user.click(screen.getByTestId("tr-go"));
    await waitFor(() => expect(useGame.getState().message).toBe("搬了 2 种货物，共 21 件"), SLOW);
    expect(submits(calls)).toEqual([
      { Transfer: { owner: "player", from: { Fleet: 0 }, to: { Warehouse: 0 }, good: 0, qty: 10 } },
      { Transfer: { owner: "player", from: { Warehouse: 0 }, to: { Fleet: 0 }, good: 1, qty: 11 } },
    ]);
    expect(screen.queryByTestId("tr-foot")).toBeNull();
  });

  it("要搬的数量不超过对面的空位；“全部 →”一次搬能放下的全部；换成商队、两边对调", async () => {
    const calls = installIpc({ port: () => withWarehouse, overview: () => loaded, submit: () => ({ outcome: "Done", overview: loaded }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    await screen.findByTestId("transfer-desk");
    // 仓库的木材 60 件搬回船：船上只剩 30 个空位
    const silk = screen.getByTestId("tr-rl-1");
    const qty = within(silk).getByRole("spinbutton");
    await user.clear(qty);
    await user.type(qty, "60");
    expect(qty).toHaveValue(30);
    await user.click(within(silk).getByRole("button", { name: "把丝绸全部搬到舰队 #0" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ Transfer: { owner: "player", from: { Warehouse: 0 }, to: { Fleet: 0 }, good: 1, qty: 30 } }]), SLOW);
    expect(useGame.getState().message).toBe("把丝绸 30 件搬到了舰队 #0");
    // 那边换成商队 #3（空的）
    await user.selectOptions(screen.getByRole("combobox", { name: "那边" }), "商队 #3");
    expect(within(screen.getByTestId("tr-side-rl")).getByText("这里没有货")).toBeInTheDocument();
    // 对调：商队到了这边
    await user.click(screen.getByRole("button", { name: "两边对调" }));
    expect(screen.getByRole("combobox", { name: "这边" })).toHaveDisplayValue("商队 #3");
    expect(screen.getByRole("combobox", { name: "那边" })).toHaveDisplayValue("舰队 #0");
  });

  it("这里只有一处能放货时说明怎么办；仓库的租金、买下的价钱写在按钮旁边", async () => {
    installIpc({ overview: () => overview });
    useGame.setState({ overview });
    render(<PortPanel />);
    expect(await screen.findByTestId("tr-need")).toHaveTextContent("租一间仓库，或让商队来这里");
    // 缺省租 200：每天 200 × 5 ÷ 100 = 10；买 100 单位 2,000
    expect(screen.getByTestId("wh-rent-cost")).toHaveTextContent("每天租金 10 金币");
    expect(screen.getByTestId("wh-buy-cost")).toHaveTextContent("买下要 2,000 金币");
  });

  it("纯函数：每行不超过持有，同一方向合计不超过对面的空位", () => {
    const a: Load = { cargo: [{ good: 0, qty: 30, avg_cost: 1 }, { good: 2, qty: 5, avg_cost: 1 }], used: 35, capacity: 80 };
    const b: Load = { cargo: [{ good: 1, qty: 60, avg_cost: 1 }], used: 60, capacity: 70 };
    expect(fitMoves({ "lr:0": 99, "lr:2": 3, "rl:1": 50 }, a, b)).toEqual({ "lr:0": 10, "rl:1": 45 });
  });
});

describe("商队的装卸入口", { timeout: HEAVY }, () => {
  it("在城里的商队有“装卸货物”：打开所在地港口窗口的仓库页", async () => {
    installIpc();
    startedGame();
    useGame.setState({ overview: loaded, facility: "market", selectedLoc: 1 });
    useShell.setState({ windowOpen: false });
    const user = userEvent.setup();
    render(<CaravanPanel />);
    await user.click(await screen.findByRole("button", { name: "装卸货物" }));
    expect(useGame.getState()).toMatchObject({ selectedLoc: 0, facility: "warehouse", tab: "port" });
    expect(useShell.getState().windowOpen).toBe(true);
  });
});

describe("舰队页的购买补给", { timeout: HEAVY }, () => {
  beforeEach(() => {
    setLocale("zh-CN");
    startedGame();
  });

  it("粮水各一个加减；“够 N 天”按每天的消耗补；写明约花多少、占多少舱位、补完够几天；提交 Resupply", async () => {
    const calls = installIpc();
    const user = userEvent.setup();
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"), SLOW);
    const desk = screen.getByTestId("supply-desk");
    // 粮水各 10、每天 1：够 30 天要各补 20
    await user.click(within(desk).getByRole("button", { name: "够 30 天" }));
    expect(within(desk).getByRole("spinbutton", { name: "要买的粮食" })).toHaveValue(20);
    expect(within(desk).getByRole("spinbutton", { name: "要买的淡水" })).toHaveValue(20);
    // 粮 2、水 1：20 × 2 + 20 × 1 = 60；舱位还剩 60
    expect(screen.getByTestId("sp-note")).toHaveTextContent("约花 60 金币 · 占舱位 40（还剩 60） · 补完约够 30 天");
    await user.click(within(screen.getByTestId("sp-food")).getByRole("button", { name: /^多买 1 份/ }));
    expect(within(desk).getByRole("spinbutton", { name: "要买的粮食" })).toHaveValue(21);
    await user.click(within(desk).getByRole("button", { name: "购买补给（约 62 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Resupply: { owner: "player", fleet: 0, food: 21, water: 20 } } }), SLOW);
    expect(within(desk).getByRole("spinbutton", { name: "要买的粮食" })).toHaveValue(0);
  });

  it("粮水合计不超过舱位；舱位满了写明原因", async () => {
    installIpc();
    useGame.setState({ overview: { ...overview, fleets: [{ ...overview.fleets[0], used: 80 }] } });
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"), SLOW);
    expect(screen.getByTestId("sp-note")).toHaveTextContent("舱位满了");
    expect(screen.getByRole("button", { name: /^购买补给/ })).toBeDisabled();
  });
});

describe("船厂", { timeout: HEAVY }, () => {
  const twoShips: Overview = {
    ...overview,
    fleets: [
      {
        ...overview.fleets[0],
        used: 20,
        capacity: 160,
        crew_max: 40,
        ships: [
          { kind: 0, durability: 50, max_durability: 60, capacity: 80, guns: 2, refits: [0], resale: 2400 },
          { kind: 0, durability: 60, max_durability: 60, capacity: 80, guns: 2, refits: [], resale: 2600 },
        ],
      },
    ],
  };
  beforeEach(() => {
    setLocale("zh-CN");
    startedGame();
    useGame.setState({ facility: "shipyard" });
  });

  it("卖船要确认一次：先点“出售”再点“确定……卖掉？”才提交；取消不提交", async () => {
    const calls = installIpc({ overview: () => twoShips });
    useGame.setState({ overview: twoShips });
    const user = userEvent.setup();
    render(<PortPanel />);
    const ship = await screen.findByTestId("yard-ship-0-1");
    await user.click(within(ship).getByRole("button", { name: "出售 2,600 金币" }));
    expect(submits(calls)).toEqual([]);
    await user.click(within(ship).getByRole("button", { name: "取消" }));
    expect(within(ship).getByRole("button", { name: "出售 2,600 金币" })).toBeInTheDocument();
    await user.click(within(ship).getByRole("button", { name: "出售 2,600 金币" }));
    await user.click(within(ship).getByRole("button", { name: "确定以 2,600 金币卖掉？" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ SellShip: { owner: "player", fleet: 0, ship: 1 } }]), SLOW);
  });

  it("卖不了的船写明原因；改造在每艘船自己的一行里选，做过的改造不再列出；钱不够的买船按钮灰掉并写明差多少", async () => {
    const calls = installIpc({ overview: () => overview });
    const user = userEvent.setup();
    const { unmount } = render(<PortPanel />);
    // 只有一艘船：不能卖
    const only = await screen.findByTestId("yard-ship-0-0");
    expect(within(only).getByRole("button", { name: "出售 2,400 金币" })).toBeDisabled();
    expect(only).toHaveTextContent("舰队只剩这一艘船");
    await user.click(within(only).getByRole("button", { name: "改造" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ RefitShip: { owner: "player", fleet: 0, ship: 0, refit: 0 } }]), SLOW);
    unmount();
    // 已经加固过的船不再列出“加固船体”（唯一的改造）：没有改造的下拉
    installIpc({ overview: () => twoShips });
    useGame.setState({ overview: { ...twoShips, cash: 1000 } });
    render(<PortPanel />);
    const done = await screen.findByTestId("yard-ship-0-0");
    expect(within(done).queryByRole("combobox", { name: "改造" })).toBeNull();
    // 现金 1,000：买不起 4,000 的船
    const offer = screen.getByTestId("ship-offer-0");
    expect(within(offer).getByRole("button", { name: "买入组建新舰队" })).toBeDisabled();
    expect(offer).toHaveTextContent("现金还差 3,000 金币");
  });

  it("纯函数：卖了装不下货、船员太多、独有船型、只剩一艘", () => {
    const f = twoShips.fleets[0];
    expect(sellShipBlock(statics, f, 1)).toBeNull();
    expect(sellShipBlock(statics, { ...f, used: 100 }, 1)).toBe("卖了装不下：先卸掉 20 件货");
    expect(sellShipBlock(statics, { ...f, crew: 30 }, 1)).toBe("卖了船员太多：先解雇 10 人");
    expect(sellShipBlock(statics, { ...f, ships: [f.ships[0]] }, 0)).toBe("舰队只剩这一艘船");
    const unique = { ...statics, ships: [{ ...statics.ships[0], unique: true }] };
    expect(sellShipBlock(unique, f, 0)).toBe("独有的船不卖给船厂");
  });
});

describe("酒馆：按人数招募或解雇", { timeout: HEAVY }, () => {
  it("人数用加减调；招不到那么多人、钱不够或船员不够解雇时按钮灰掉", async () => {
    setLocale("zh-CN");
    startedGame();
    const calls = installIpc({ port: () => ({ ...port, fleets_here: [0] }) });
    useGame.setState({ facility: "tavern", overview: { ...overview, fleets: [{ ...overview.fleets[0], crew: 12, hire_max: 8 }] } });
    const user = userEvent.setup();
    render(<PortPanel />);
    const crew = await screen.findByTestId("tavern-crew");
    const qty = within(crew).getByRole("spinbutton", { name: "招募或解雇的人数" });
    expect(qty).toHaveValue(5);
    await user.click(within(crew).getByRole("button", { name: /^多 1 人/ }));
    expect(qty).toHaveValue(6);
    await user.click(within(crew).getByRole("button", { name: "招募 (60 金币)" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 6 } } }), SLOW);
    // 招得到 8 人：9 人时“招募”灰掉，“解雇”照常
    await user.clear(qty);
    await user.type(qty, "9");
    expect(within(crew).getByRole("button", { name: /^招募 \(/ })).toBeDisabled();
    expect(within(crew).getByRole("button", { name: "解雇" })).toBeEnabled();
  });
});
