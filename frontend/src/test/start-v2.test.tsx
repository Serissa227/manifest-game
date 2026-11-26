// 新界面（v2）的开局画面（docs/UI-REDESIGN.md 第 8 节第 1 组）：只在 v2 下做的小 DOM 调整，以及 v1 维持原样。
// - 读档：没有存档时空状态给一个“开始新的航程”（下一步）；删除存档用共用的确认对话框（焦点先在“取消”，Esc / 取消不删）；
// - 启航一步：随机种子从底栏挪进正文（底栏只留导航），带一句说明；开局照样带上种子；第九批的开局同样；
// - 补建身世的“取消”旁写出快捷键 Esc；
// - 开局向导与补建身世的船长卡带一个“详情”键（手机上卡片收成一行，点它展开）；游戏里顶栏的悬停卡没有；
// - v1：上面这些都照旧（种子在底栏、删除在行内问、空状态是原来那一行），DOM 里没有任何 v2 的类。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StartScreen from "../components/StartScreen";
import CaptainRetro from "../components/start/CaptainRetro";
import TopBar from "../components/TopBar";
import { setLocale } from "../i18n/locale";
import type { ScenarioCard, StaticView, WorldCard, WorldCatalog } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { captainProfile, captainStatics, installIpc, overview, startedGame, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

/** 带剧本详情的静态数据（同 start.test.tsx）：没有身世数据，向导是 剧本 → 外貌 → 姓名 → 启航。 */
const richStatics: StaticView = {
  ...statics,
  scenarios: [
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
  ],
};

const saves = [
  {
    slot: "hero",
    day: 30,
    scenario: "新晋船主",
    net_worth: 50000,
    captain: { name: "沈汐", portrait: 5 },
  },
  { slot: "old", day: 12, scenario: "自由沙盒", net_worth: 30000 },
];

function reset(s: StaticView = richStatics) {
  useGame.setState({
    statics: s,
    overview: null,
    version: 0,
    selectedLoc: null,
    selectedFleet: null,
    error: null,
    message: null,
  });
}

/** 步骤条上的当前步。 */
function currentStep(): string {
  const nav = screen.getByRole("navigation", { name: "开局步骤" });
  const cur = within(nav)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "step");
  return (cur?.textContent ?? "").replace(/^\d+/, "");
}

async function goTo(user: UserEvent, label: string) {
  for (let i = 0; i < 12 && currentStep() !== label; i++) await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(currentStep()).toBe(label);
}

beforeEach(() => {
  setLocale("zh-CN");
});
afterEach(() => {
  // 先卸下组件再切回 v1（否则切换会让还挂着的组件在 act 之外更新）
  cleanup();
  setUiFor("v1");
});

describe("v2：读取存档", () => {
  beforeEach(() => setUiFor("v2"));

  it("没有存档：空状态写明原因与补充一句，“开始新的航程”一键回到新的航程", async () => {
    installIpc();
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(screen.getByRole("button", { name: "读取存档" }));
    const empty = screen.getByTestId("empty-state");
    expect(within(empty).getByText("还没有存档")).toBeInTheDocument();
    expect(within(empty).getByText("开一局之后，在游戏里随时可以存档。")).toBeInTheDocument();
    await user.click(within(empty).getByRole("button", { name: "开始新的航程" }));
    expect(screen.getByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新的航程" })).toHaveAttribute("aria-pressed", "true");
  });

  it("删除存档：先弹确认对话框（主按钮写清删哪一个，焦点在“取消”）；Esc 与取消都不删；确认后删掉并提示", async () => {
    let list = [...saves];
    const calls = installIpc({
      list_saves: () => list,
      delete_save: (args) => {
        list = list.filter((s) => s.slot !== args.slot);
        return list;
      },
    });
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（2）" }));

    // 问一句：对话框，不是行内的确认条
    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "删除存档「old」？",
    });
    expect(dialog).toHaveTextContent("删掉之后找不回来。");
    expect(screen.queryByText("删除存档「old」？删掉之后找不回来。")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("delete_save", expect.anything());

    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "取消",
      }),
    );
    expect(calls).not.toHaveBeenCalledWith("delete_save", expect.anything());

    // 确认：删掉，列表只剩 hero，提示条回一句
    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "删除「old」",
      }),
    );
    await waitFor(() => expect(calls).toHaveBeenCalledWith("delete_save", { slot: "old" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "读取存档 old" })).toBeNull());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("button", { name: "读取存档 hero" })).toBeInTheDocument();
    expect(useGame.getState().message).toBe("已删除存档 old");
    expect(useGame.getState().overview).toBeNull();
  });
});

describe("v2：启航一步的随机种子", () => {
  beforeEach(() => setUiFor("v2"));

  it("种子在正文里（底栏只留导航），带一句说明；开局照样带上种子", async () => {
    const calls = installIpc();
    reset();
    const user = userEvent.setup();
    const { container } = render(<StartScreen roll={0} />);
    await goTo(user, "启航");
    const seed = screen.getByLabelText("随机种子（可留空）");
    const footer = container.querySelector(".ts-launch") as HTMLElement;
    expect(footer).not.toContainElement(seed);
    expect(seed.closest(".ts-body")).not.toBeNull();
    expect(seed).toHaveAccessibleDescription("填同一个数字，开出来的世界就一样（适合和朋友比同一局）；留空则每局不同。");
    // 底栏：上一步、开始新游戏
    expect(
      within(footer)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["上一步", "开始新游戏"]);
    await user.type(seed, "4a2");
    expect(seed).toHaveValue("42");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("new_game", {
        scenario: "newcomer",
        seed: 42,
      }),
    );
  });

  it("第九批的开局（名册）同样：种子在启航一步的正文里，开局请求带上它", async () => {
    const hero: ScenarioCard["protagonists"][number] = {
      key: "mio",
      name: "一条澪",
      name_en: null,
      gender: "f",
      born: [1540, 6, 21],
      home: "土佐中村",
      region: "日本·土佐",
      tagline: "一句话",
      style: "公家的姬君",
      playstyle: "护航",
      tags: [],
      difficulty: 3,
      strengths: [],
      start_ship: "小早",
      known: [],
      academy: { key: "kyoto", name: "宫中", city: "京都" },
      keepsake: "桧扇",
      portraits: [{ from_age: 12, asset: "t16-mio-12" }],
      bonds: [],
    };
    const scenario: ScenarioCard = {
      key: "plus_ultra",
      name: "更远之处",
      description: "",
      start_date: [1553, 1, 1],
      control_date: [1553, 1, 1],
      upbringing: false,
      protagonists: [hero],
      templates: [],
      goal: { kind: "story", target: 0, years: null },
      options: { history_toggle: false, skip_upbringing: false },
    };
    const terra16: WorldCard = {
      key: "terra16",
      name: "寰宇",
      tagline: "",
      description: "",
      map_key: "earth",
      era: "公元",
      start_year: 1553,
      currency: "金币",
      modules: [],
      scenarios: [scenario],
    };
    const classic: WorldCard = {
      ...terra16,
      key: "classic",
      name: "维斯塔海",
      scenarios: [],
    };
    const catalog: WorldCatalog = {
      current: "terra16",
      worlds: [classic, terra16],
    };
    const calls = installIpc({
      world_catalog: () => catalog,
      select_world: () => statics,
      new_world_game: () => overview,
    });
    reset(statics);
    const user = userEvent.setup();
    const { container } = render(<StartScreen roll={3} />);
    // 经典 + 寰宇：新开局不列经典，直接切到寰宇；只有一个剧本：主角 → 启航
    await screen.findByTestId("hero-detail");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    const seed = screen.getByLabelText("随机种子（可留空）");
    expect(container.querySelector(".ts-launch")).not.toContainElement(seed);
    expect(seed.closest(".ws-confirm")).not.toBeNull();
    await user.type(seed, "9");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("new_world_game", {
        request: expect.objectContaining({ seed: 9, protagonist: "mio" }),
      }),
    );
  });
});

describe("v2：补建身世", () => {
  it("“取消”旁写出快捷键 Esc（小键帽），按 Esc 照旧关掉；旧界面没有小键帽", async () => {
    installIpc({ static_data: () => captainStatics });
    startedGame();
    useGame.setState({ statics: captainStatics, overview: { ...overview, captain: { name: "沈汐", portrait: 5 } } });
    setUiFor("v2");
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<CaptainRetro onClose={onClose} />);
    const cancel = screen.getByRole("button", { name: /^取消/ });
    expect(cancel.querySelector("kbd.v2-kbd")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    act(() => setUiFor("v1"));
    render(<CaptainRetro onClose={onClose} />);
    expect(screen.getByRole("button", { name: "取消" }).querySelector("kbd")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("v1 维持原样", () => {
  it("种子在底栏、删除在行内问、没有存档是原来那一行；DOM 里没有任何 v2 的类", async () => {
    installIpc({ list_saves: () => saves });
    reset();
    const user = userEvent.setup();
    const { container } = render(<StartScreen roll={0} />);
    await goTo(user, "启航");
    const seed = screen.getByLabelText("随机种子（可留空）");
    expect(container.querySelector(".ts-launch")).toContainElement(seed);
    expect(seed).not.toHaveAttribute("aria-describedby");
    expect(container.querySelector(".ts-seed-block")).toBeNull();
    // 第一步的“上一步”照旧在（只是不可用）：v2 只用样式把它藏起来
    expect(v2Classes()).toEqual([]);

    await user.click(await screen.findByRole("button", { name: "读取存档（2）" }));
    await user.click(screen.getByRole("button", { name: "删除存档 old" }));
    expect(screen.getByText("删除存档「old」？删掉之后找不回来。")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it('没有存档：照旧是 <p class="ts-empty">，没有按钮', async () => {
    installIpc();
    reset();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(screen.getByRole("button", { name: "读取存档" }));
    const p = screen.getByText("还没有存档");
    expect(p.tagName).toBe("P");
    expect(p).toHaveClass("ts-empty");
    expect(screen.queryByRole("button", { name: "开始新的航程" })).toBeNull();
  });
});

describe("v2：船长卡在手机上可以收起", () => {
  it("开局向导：船长卡带“详情”键（aria-expanded 与卡片的 is-open 一起切换，点它不提交、不换步）；旧界面没有这个键，类名照旧", async () => {
    installIpc({ static_data: () => captainStatics });
    reset(captainStatics);
    setUiFor("v2");
    const user = userEvent.setup();
    const { unmount } = render(<StartScreen roll={0} />);
    await goTo(user, "外貌");
    const card = screen.getByTestId("captain-card");
    const toggle = within(card).getByRole("button", { name: "船长卡详情" });
    expect(toggle).toHaveTextContent("详情");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).toHaveClass("cw-card", "v2-card-fold");
    expect(card).not.toHaveClass("is-open");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveClass("is-open");
    expect(currentStep()).toBe("外貌");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toHaveClass("is-open");
    unmount();

    act(() => setUiFor("v1"));
    render(<StartScreen roll={0} />);
    await goTo(user, "外貌");
    const old = screen.getByTestId("captain-card");
    expect(old.className).toBe("cw-card");
    expect(within(old).queryByRole("button")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it("补建身世的船长卡同样带“详情”键；游戏里顶栏头像的悬停卡不收（没有这个键）", async () => {
    installIpc({ static_data: () => captainStatics });
    startedGame();
    useGame.setState({ statics: captainStatics, overview: { ...overview, captain: { name: "沈汐", portrait: 5 } } });
    setUiFor("v2");
    const user = userEvent.setup();
    const { unmount } = render(<CaptainRetro onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "补建身世" });
    const toggle = within(dialog).getByRole("button", { name: "船长卡详情" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.closest(".cw-card")).toHaveClass("is-open");
    unmount();

    useGame.setState({ overview: { ...overview, captain: { name: "沈汐", portrait: 5 }, profile: captainProfile } });
    render(<TopBar />);
    await user.click(await screen.findByRole("button", { name: "查看船长卡" }));
    const pop = screen.getByTestId("hud-profile");
    expect(within(pop).queryByRole("button", { name: "船长卡详情" })).toBeNull();
    expect(pop.querySelector(".cw-card")?.className).toBe("cw-card");
  });
});
