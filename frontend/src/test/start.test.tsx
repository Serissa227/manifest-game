// 标题画面与开局向导（没有身世数据时：剧本 → 外貌 → 姓名 → 启航）：剧本卡片、外貌选择、姓名、开局（new_game → set_captain）、
// 读档入口、标题场景的像素画。有身世数据时的生日、身世与属性见 captain.test.tsx。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import StartScreen from "../components/StartScreen";
import {
  CAPTAIN_LOOK_IDS,
  CAPTAIN_NAME_MAX,
  captainName,
  cleanName,
  isFemaleLook,
  lookFromRoll,
  lookNumber,
  rollLook,
  stripControls,
  wrapLook,
  type ScenarioInfo,
} from "../components/start/captain";
import {
  TITLE_H,
  TITLE_MIN_W,
  drawScenarioVignette,
  drawTitleScene,
  drawWindowFrame,
} from "../components/start/titleArt";
import type { StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, statics } from "./fixtures";

/** 带剧本详情（起始港、资金、船队、目标）的静态数据，与后端 ScenarioView 的新字段一致。 */
const richScenarios: ScenarioInfo[] = [
    {
      key: "newcomer",
      name: "新晋船主",
      description: "一艘小船，一点本钱。",
      start: 0,
      cash: 15000,
      ships: [0],
      crew: 14,
      mates: 1,
      goal: { kind: "net_worth", target: 300000, years: 10 },
    },
    {
      key: "sandbox",
      name: "自由沙盒",
      description: "没有目标，也没有期限。",
      start: 1,
      cash: 30000,
      ships: [0],
      crew: 25,
      mates: 0,
      goal: { kind: "sandbox", target: 0, years: null },
    },
];
const richStatics: StaticView = { ...statics, scenarios: richScenarios };

function reset(s: StaticView = statics) {
  useGame.setState({ statics: s, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null, message: null });
}

function portraitLabel(): string {
  return screen.getByRole("img", { name: /船长 .* 的头像/ }).getAttribute("aria-label") ?? "";
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("船长姓名") as HTMLInputElement;
}

/** 步骤条上的当前步。 */
function currentStep(): string {
  const nav = screen.getByRole("navigation", { name: "开局步骤" });
  const cur = within(nav)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "step");
  return (cur?.textContent ?? "").replace(/^\d+/, "");
}

/** 点“下一步”走到某一步（途中各步都已完成）。 */
async function goTo(user: UserEvent, label: string) {
  for (let i = 0; i < 12 && currentStep() !== label; i++) await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(currentStep()).toBe(label);
}

async function back(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "上一步" }));
}

describe("标题画面", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    reset();
  });

  it("有游戏标题、主菜单与开局向导：先选剧本，再到外貌（24 种）、姓名与启航", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    expect(screen.getByRole("heading", { level: 1, name: "Manifest · 船货清单" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主菜单" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /新晋船主/ })).toBeChecked();
    expect(screen.getByRole("img", { name: /黄昏的港湾/ })).toBeInTheDocument();
    // 没有身世数据：四步；第一步不能再往前
    const steps = within(screen.getByRole("navigation", { name: "开局步骤" })).getAllByRole("button");
    expect(steps.map((b) => b.textContent)).toEqual(["1剧本", "2外貌", "3姓名", "4启航"]);
    expect(currentStep()).toBe("剧本");
    expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "开始新游戏" })).toBeNull();

    await goTo(user, "外貌");
    expect(screen.getByRole("heading", { name: "你的船长" })).toBeInTheDocument();
    // 24 种外貌，默认选中第 1 种（roll = 0）；船长卡上是大头像
    const looks = within(screen.getByRole("radiogroup", { name: "外貌" })).getAllByRole("radio");
    expect(looks).toHaveLength(24);
    expect(screen.getByRole("radio", { name: "外貌 1" })).toBeChecked();
    expect(within(screen.getByRole("complementary", { name: "船长卡" })).getByRole("img", { name: /外貌 1）/ })).toBeInTheDocument();

    await goTo(user, "姓名");
    // 默认给一个随机的原创名字
    expect(nameInput().value).toBe(captainName(0, isFemaleLook(0)));
    expect(nameInput().value.length).toBeGreaterThan(0);
    expect(nameInput()).toHaveAttribute("maxLength", String(CAPTAIN_NAME_MAX));
    await goTo(user, "启航");
    expect(screen.getByRole("button", { name: "开始新游戏" })).toBeEnabled();
    expect(screen.getByTestId("cw-summary")).toHaveTextContent("新晋船主 · 从澄港启航");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("list_saves", {}));
  });

  it("选择外貌、输入姓名后开局：依次调用 new_game、set_captain，行情情报缺省随船传递", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "外貌");
    await user.click(screen.getByRole("radio", { name: "外貌 4" }));
    expect(portraitLabel()).toContain("外貌 4");
    await goTo(user, "姓名");
    await user.clear(nameInput());
    await user.type(nameInput(), "  林远舟 ");
    await goTo(user, "启航");
    // 启航一步选行情情报（docs/ECONOMY.md 第 7 节）：缺省随船传递（推荐），写明两种的区别
    const info = screen.getByTestId("start-info");
    expect(within(info).getByRole("radio", { name: /随船传递（推荐）/ })).toBeChecked();
    expect(within(info).getByRole("radio", { name: /实时（经典）/ })).not.toBeChecked();
    expect(info).toHaveTextContent("商会也只知道自己船队带回来的行情");
    await user.type(screen.getByLabelText("随机种子（可留空）"), "7a7");
    expect(screen.getByLabelText("随机种子（可留空）")).toHaveValue("77");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));

    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_captain", { captain: { name: "林远舟", portrait: 3 } }));
    expect(calls).toHaveBeenCalledWith("new_game", { scenario: "newcomer", seed: 77 });
    expect(calls).toHaveBeenCalledWith("submit", { command: { SetInfoMode: { owner: "player", mode: "carried" } } });
    // 依次：新游戏、行情情报（这一局的第一条命令）、主角的名字与外貌；没有身世数据：不提交 CreateCaptain
    const names = calls.mock.calls.map((c) => c[0]).filter((n) => ["new_game", "submit", "set_captain"].includes(n));
    expect(names).toEqual(["new_game", "submit", "set_captain"]);
    expect(useGame.getState().overview?.captain).toEqual({ name: "林远舟", portrait: 3 });
  });

  it("行情情报选实时（经典）时不提交任何命令（与旧版相同）", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "启航");
    await user.click(within(screen.getByTestId("start-info")).getByRole("radio", { name: /实时（经典）/ }));
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_captain", expect.anything()));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
    expect(calls.mock.calls.map((c) => c[0])).not.toContain("submit");
  });

  it("App 开局流程带上默认船长", async () => {
    const user = userEvent.setup();
    reset();
    useGame.setState({ statics: null });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    await goTo(user, "外貌");
    // 界面上的“外貌 n”是第 n 种，编号是 CAPTAIN_LOOK_IDS[n - 1]（第 13–24 种的编号就是 13–24）
    const look = CAPTAIN_LOOK_IDS[Number(/外貌 (\d+)/.exec(portraitLabel())?.[1]) - 1];
    await goTo(user, "姓名");
    const name = nameInput().value;
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_captain", { captain: { name, portrait: look } }));
    expect(calls).toHaveBeenCalledWith("new_game", { scenario: "newcomer", seed: null });
    expect(await screen.findByTestId("cash")).toBeInTheDocument();
  });

  it("随机与 ◀ ▶ 改变头像预览；随机姓名换一个名字", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "外貌");
    expect(portraitLabel()).toContain("外貌 1");
    await user.click(screen.getByRole("button", { name: "随机外貌" }));
    const afterRandom = portraitLabel();
    expect(afterRandom).not.toContain("外貌 1）");
    expect(afterRandom).toContain(`外貌 ${lookNumber(rollLook(1, 0))}`);
    expect(screen.getByRole("radio", { name: `外貌 ${lookNumber(rollLook(1, 0))}` })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "外貌 1" }));
    await user.click(screen.getByRole("button", { name: "上一个外貌" }));
    expect(portraitLabel()).toContain("外貌 24");
    await user.click(screen.getByRole("button", { name: "下一个外貌" }));
    await user.click(screen.getByRole("button", { name: "下一个外貌" }));
    expect(portraitLabel()).toContain("外貌 2");

    await goTo(user, "姓名");
    const before = nameInput().value;
    await user.click(screen.getByRole("button", { name: "随机姓名" }));
    expect(nameInput().value).not.toBe(before);
    expect(nameInput().value.length).toBeGreaterThan(0);
    // 船长卡的名牌随名字更新
    expect(within(screen.getByRole("complementary", { name: "船长卡" })).getByText(`${nameInput().value} 船长`)).toBeInTheDocument();
  });

  it("未手动改过的随机姓名随外貌的性别更换；手动输入后不再变", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    const male = captainName(0, false);
    expect(isFemaleLook(0)).toBe(false);
    await goTo(user, "姓名");
    expect(nameInput().value).toBe(male);
    const female = [...Array(12).keys()].find((i) => isFemaleLook(i)) ?? 1;
    await back(user);
    expect(currentStep()).toBe("外貌");
    await user.click(screen.getByRole("radio", { name: `外貌 ${female + 1}` }));
    await goTo(user, "姓名");
    expect(nameInput().value).toBe(captainName(0, true));
    await user.clear(nameInput());
    await user.type(nameInput(), "顾川");
    await back(user);
    await user.click(screen.getByRole("radio", { name: "外貌 1" }));
    await goTo(user, "姓名");
    expect(nameInput().value).toBe("顾川");
  });

  it("姓名为空时不能往下走、不能开局，并提示起名；随机后恢复", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "姓名");
    await user.clear(nameInput());
    await user.type(nameInput(), "   ");
    const go = screen.getByRole("button", { name: "下一步" });
    expect(go).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("请给船长起个名字");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    // 步骤条上也去不了“启航”；在姓名框里按回车不会往下走，更不会开局
    expect(within(screen.getByRole("navigation", { name: "开局步骤" })).getByRole("button", { name: /启航/ })).toBeDisabled();
    await user.type(nameInput(), "{Enter}");
    expect(currentStep()).toBe("姓名");
    expect(calls).not.toHaveBeenCalledWith("new_game", expect.anything());

    await user.click(screen.getByRole("button", { name: "随机姓名" }));
    expect(cleanName(nameInput().value)).not.toBe("");
    expect(go).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("姓名清理：去掉控制字符与首尾空白，最多 12 个字", () => {
    expect(stripControls("林\u0007远\n舟​")).toBe("林远舟");
    expect(cleanName("  沈 汐  ")).toBe("沈 汐");
    expect(cleanName("一二三四五六七八九十甲乙丙丁")).toBe("一二三四五六七八九十甲乙");
    expect(cleanName(" \t ")).toBe("");
    expect(wrapLook(-1)).toBe(24);
    expect(wrapLook(12)).toBe(0);
    for (let r = 0; r < 30; r++) for (const cur of [0, 5, 11]) expect(rollLook(r, cur)).not.toBe(cur);
  });

  it("剧本卡片显示起始港、资金、船队与目标；可以换剧本", async () => {
    const user = userEvent.setup();
    reset(richStatics);
    render(<StartScreen roll={2} />);
    const newcomer = screen.getByRole("radio", { name: /新晋船主/ }).closest("label") as HTMLElement;
    expect(within(newcomer).getByText("澄港")).toBeInTheDocument();
    expect(within(newcomer).getByText("15,000 金币")).toBeInTheDocument();
    expect(within(newcomer).getByText("单桅帆船 · 船员 14 人 · 航海士 1 名")).toBeInTheDocument();
    expect(within(newcomer).getByText("净资产达到 300,000 金币（限期 10 年）")).toBeInTheDocument();
    expect(within(newcomer).getByText("已选定")).toBeInTheDocument();
    const sandbox = screen.getByRole("radio", { name: /自由沙盒/ }).closest("label") as HTMLElement;
    expect(within(sandbox).getByText("自由经营，没有胜利目标")).toBeInTheDocument();
    expect(within(sandbox).getByText("柳湾")).toBeInTheDocument();

    const name = captainName(2, isFemaleLook(lookFromRoll(2)));
    expect(screen.getByText(`${name} 船长将从澄港启航。`)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /自由沙盒/ }));
    expect(screen.getByRole("radio", { name: /自由沙盒/ })).toBeChecked();
    expect(screen.getByText(`${name} 船长将从柳湾启航。`)).toBeInTheDocument();
    await goTo(user, "启航");
    expect(screen.getByTestId("cw-summary")).toHaveTextContent("自由沙盒 · 从柳湾启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("new_game", { scenario: "sandbox", seed: null }));
  });
});

describe("24 种外貌（英雄扩充）", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    reset();
  });

  it("缩略图依次是外貌 1–24；◀ ▶ 跨过空缺的 12 号：外貌 12（编号 11）的下一种是外貌 13（编号 13）", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await goTo(user, "外貌");
    const radios = within(screen.getByRole("radiogroup", { name: "外貌" })).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(Array.from({ length: 24 }, (_, i) => `外貌 ${i + 1}`));
    expect(screen.getByText("1 / 24")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "外貌 12" }));
    await user.click(screen.getByRole("button", { name: "下一个外貌" }));
    expect(portraitLabel()).toContain("外貌 13");
    expect(screen.getByRole("radio", { name: "外貌 13" })).toBeChecked();
    expect(screen.getByText("13 / 24")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上一个外貌" }));
    expect(portraitLabel()).toContain("外貌 12");
    // 最后一种的下一种回到第一种
    await user.click(screen.getByRole("radio", { name: "外貌 24" }));
    await user.click(screen.getByRole("button", { name: "下一个外貌" }));
    expect(portraitLabel()).toContain("外貌 1）");
  });

  it("选第 13–24 种开局：set_captain 收到的外貌编号就是 13–24；随机姓名随外貌的性别", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    // 外貌 14 是编号 14 的男船长；外貌 13 是编号 13 的女船长（编号为奇数的是女性）
    await goTo(user, "外貌");
    await user.click(screen.getByRole("radio", { name: "外貌 13" }));
    await goTo(user, "姓名");
    expect(nameInput().value).toBe(captainName(0, true));
    await back(user);
    await user.click(screen.getByRole("radio", { name: "外貌 24" }));
    await goTo(user, "姓名");
    expect(nameInput().value).toBe(captainName(0, false));
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_captain", { captain: { name: captainName(0, false), portrait: 24 } }));
  });

  it("随机外貌：永远不是当前这种、从不给空缺的 12 号，其余 23 种都抽得到；默认外貌 24 种机会均等", () => {
    for (const cur of CAPTAIN_LOOK_IDS) {
      const seen = new Set<number>();
      for (let r = 0; r < 400; r++) seen.add(rollLook(r, cur));
      expect(seen.has(cur)).toBe(false);
      expect(seen.has(12)).toBe(false);
      expect(seen.size).toBe(23);
    }
    expect(CAPTAIN_LOOK_IDS.map((i) => lookNumber(i))).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect([wrapLook(13), wrapLook(24), wrapLook(25), wrapLook(37)]).toEqual([13, 24, 0, 0]);
  });

  it("开局默认外貌按随机数在 24 种里取（roll 13 是外貌 14，即编号 14）", async () => {
    const user = userEvent.setup();
    render(<StartScreen roll={13} />);
    await goTo(user, "外貌");
    expect(portraitLabel()).toContain("外貌 14");
    expect(screen.getByRole("radio", { name: "外貌 14" })).toBeChecked();
    await goTo(user, "姓名");
    expect(nameInput().value).toBe(captainName(13, false));
  });
});

describe("读档入口", () => {
  it("存档列表显示船长与剧本，点击后读档", async () => {
    const calls = installIpc({
      list_saves: () => [
        { slot: "hero", day: 30, scenario: "新晋船主", net_worth: 50000, captain: { name: "沈汐", portrait: 5 } },
        { slot: "old", day: 12, scenario: "自由沙盒", net_worth: 30000 },
        // 按主角开局的局：船长为空，列表用 hero 写主角名
        { slot: "mio", day: 1460, scenario: "潮之扇·1553", net_worth: 8240, captain: null, hero: "一条澪" },
      ],
    });
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    const menu = await screen.findByRole("button", { name: "读取存档（3）" });
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "读取存档" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "选择开局剧本" })).toBeNull();
    expect(screen.getByText("沈汐 船长")).toBeInTheDocument();
    expect(screen.getByText("无名船长")).toBeInTheDocument();
    expect(screen.getByText("一条澪 船长")).toBeInTheDocument();
    expect(screen.getByText("新晋船主 · 1502年2月1日 · 净资产 50,000 金币")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "读取存档 hero" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("load_game", { slot: "hero" }));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());

    // 回到“新的航程”
    await user.click(screen.getByRole("button", { name: "新的航程" }));
    expect(screen.getByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
  });

  it("删除存档：先在这一行里问一句，取消不删；确认后删掉并换上新列表", async () => {
    let saves = [
      { slot: "hero", day: 30, scenario: "新晋船主", net_worth: 50000, captain: { name: "沈汐", portrait: 5 } },
      { slot: "old", day: 12, scenario: "自由沙盒", net_worth: 30000 },
    ];
    const calls = installIpc({
      list_saves: () => saves,
      delete_save: (args) => {
        saves = saves.filter((s) => s.slot !== args.slot);
        return saves;
      },
    });
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（2）" }));

    // 问一句，焦点在“取消”上；取消不删
    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    expect(screen.getByText("删除存档「old」？删掉之后找不回来。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(calls).not.toHaveBeenCalledWith("delete_save", expect.anything());
    expect(screen.queryByText("删除存档「old」？删掉之后找不回来。")).toBeNull();

    // 确认后删除：列表只剩 hero，并提示已删除
    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("delete_save", { slot: "old" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "读取存档 old" })).toBeNull());
    expect(screen.getByRole("button", { name: "读取存档 hero" })).toBeInTheDocument();
    expect(useGame.getState().message).toBe("已删除存档 old");
    expect(useGame.getState().overview).toBeNull();
  });

  it("没有存档时显示提示", async () => {
    installIpc();
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(screen.getByRole("button", { name: "读取存档" }));
    expect(screen.getByText("还没有存档")).toBeInTheDocument();
  });
});

describe("标题场景的像素画", () => {
  it("尺寸正确、同一帧画面相同、不同帧会动", () => {
    const a = drawTitleScene(320, 0);
    expect([a.w, a.h]).toEqual([320, TITLE_H]);
    expect(Array.from(drawTitleScene(320, 0).data)).toEqual(Array.from(a.data));
    const b = drawTitleScene(320, 12);
    expect(Array.from(b.data)).not.toEqual(Array.from(a.data));
    expect(drawTitleScene(100, 0).w).toBe(TITLE_MIN_W);
    // 整幅不透明，色数克制
    expect(a.data.every((v) => (v & 0xff) === 0xff)).toBe(true);
    expect(a.colorCount()).toBeLessThan(160);
  });

  it("窗框与剧本小景", () => {
    const frame = drawWindowFrame();
    expect([frame.w, frame.h]).toEqual([24, 24]);
    const v = drawScenarioVignette({ style: "eastern", ship: { type: 0, sail: "lateen" }, flag: "#c8373a", variant: 0 });
    expect([v.w, v.h]).toEqual([148, 100]);
    expect(v.data.every((c) => (c & 0xff) === 0xff)).toBe(true);
  });
});

describe("新大陆开拓者：殖民地剧本与纪年", () => {
  /** 殖民地目标的剧本：两艘船、带人口门槛与限期；起始港属于带 style 字段的势力。 */
  const colonist: ScenarioInfo = {
    key: "colonist",
    name: "新大陆开拓者",
    description: "航海历 1502 年，你带着一船移民在新大陆靠岸。",
    start: 0,
    cash: 40000,
    ships: [0, 0],
    crew: 150,
    mates: 1,
    goal: { kind: "colonies", target: 3, population: 400, years: 15 },
  };
  const colonistStatics: StaticView = {
    ...statics,
    factions: statics.factions.map((f, i) => (i === 0 ? { ...f, style: "frontier" } : f)),
    scenarios: [...richScenarios, colonist],
  };

  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    reset(colonistStatics);
  });

  it("剧本卡片的殖民目标写明数量与人口门槛，显示金币、纪年与限期日期", async () => {
    render(<StartScreen roll={0} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("list_saves", {}));
    const card = screen.getByRole("radio", { name: /新大陆开拓者/ }).closest("label") as HTMLElement;
    expect(within(card).getByText("拥有 3 个人口 ≥ 400 的殖民地（限期 15 年）")).toBeInTheDocument();
    expect(within(card).getByText("截至 1517年1月1日")).toBeInTheDocument();
    expect(within(card).getByText("40,000 金币")).toBeInTheDocument();
    expect(within(card).getByText("单桅帆船、单桅帆船 · 船员 150 人 · 航海士 1 名")).toBeInTheDocument();
    expect(within(card).getByText("航海历 1502 年启航")).toBeInTheDocument();
    // 原有剧本的目标文字不变，另附限期的纪年日期
    const newcomer = screen.getByRole("radio", { name: /新晋船主/ }).closest("label") as HTMLElement;
    expect(within(newcomer).getByText("净资产达到 300,000 金币（限期 10 年）")).toBeInTheDocument();
    expect(within(newcomer).getByText("截至 1512年1月1日")).toBeInTheDocument();
    // 标题下的纪年与编年背景
    expect(screen.getByText("航海历 1502 年")).toBeInTheDocument();
    expect(screen.getByText("巨人之门已开四十年，新大陆的海岸线仍未画完。")).toBeInTheDocument();
  });

  it("殖民地目标缺少人口门槛时退回通用文案；没有纪年数据时不显示纪年", async () => {
    const bare = { ...colonist, goal: { kind: "colonies" as const, target: 2, years: null } };
    const { world: _world, ...noWorld } = { ...statics, scenarios: [bare] };
    void _world;
    reset(noWorld as StaticView);
    render(<StartScreen roll={0} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("list_saves", {}));
    const card = screen.getByRole("radio", { name: /新大陆开拓者/ }).closest("label") as HTMLElement;
    expect(within(card).getByText("经营 2 座兴旺的殖民地")).toBeInTheDocument();
    expect(within(card).queryByText(/启航$/)).toBeNull();
    expect(screen.queryByText("巨人之门已开四十年，新大陆的海岸线仍未画完。")).toBeNull();
  });
});
