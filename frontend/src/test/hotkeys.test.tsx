// 操作手感（11-03）：新界面（v2）的全局快捷键（components/shell/hotkeys.ts）——空格暂停 / 继续、Esc 关掉最上层、回车按主按钮、M 切换街景 / 航海图；
// 主界面与养成画面里的接法、全部快捷键卡片里的新分组、剧情对话框的方向键、养成补选完自动跳到下一格；旧界面（v1）什么都不挂。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import DepartDialog from "../components/nav/DepartDialog";
import { useNavStore } from "../hooks/useNavigation";
import { ShortcutHelp, closeShortcutHelp } from "../components/feedback";
import { useGlobalHotkeys, type GlobalHotkeys } from "../components/shell/hotkeys";
import { useShell } from "../components/shell/shellState";
import StoryDialog from "../components/story/StoryDialog";
import { useStoryUi } from "../components/story/storyKit";
import { TutorialSection } from "../components/tutorial/TutorialSection";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { setLocale } from "../i18n/locale";
import type { ActivityView, CaptainDefsView, Overview, StaticView, StoryView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { captainStatics, installIpc, overview, startedGame, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 把焦点放回页面空白处（body）。 */
function blurAll() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  cleanup();
  act(() => closeShortcutHelp());
  useStoryUi.setState({ dismissed: "", panel: false });
  setUiFor("v1");
});

/** 只挂快捷键的小画面：一个普通按钮、一个输入框、一个“功能窗口”，可选一个对话框与主按钮。 */
function Harness({ keys, enabled = true, dialog = false, primary = 0 }: { keys: GlobalHotkeys; enabled?: boolean; dialog?: boolean; primary?: number }) {
  useGlobalHotkeys(enabled, keys);
  return (
    <>
      <button type="button">外面的按钮</button>
      <input aria-label="存档名" />
      <section data-testid="game-window">
        <button type="button">窗口里的按钮</button>
      </section>
      {Array.from({ length: primary }, (_, i) => (
        <button key={i} type="button" data-hotkey="primary" onClick={() => keys.toggleStage?.()}>
          主按钮{i}
        </button>
      ))}
      {dialog && (
        <div role="dialog" aria-modal="true" aria-label="剧情" onKeyDown={(e) => e.key === "Escape" && keys.closeWindow?.()}>
          <p>对话</p>
        </div>
      )}
    </>
  );
}

describe("全局快捷键：空格", () => {
  it("焦点在页面空白处或在按钮上都暂停 / 继续，而且不顺手按下那个按钮", async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    const clicked = vi.fn();
    render(
      <>
        <Harness keys={{ pause }} />
        <button type="button" onClick={clicked}>
          命令栏
        </button>
      </>,
    );
    blurAll();
    await user.keyboard(" ");
    expect(pause).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "命令栏" }).focus();
    await user.keyboard(" ");
    expect(pause).toHaveBeenCalledTimes(2);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("在输入框里打字、对话框开着、手动航行占着空格、别的处理已经用掉这个键时都不管", async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    const { rerender } = render(<Harness keys={{ pause }} />);
    await user.type(screen.getByRole("textbox", { name: "存档名" }), "a b");
    expect(screen.getByRole("textbox", { name: "存档名" })).toHaveValue("a b");
    expect(pause).not.toHaveBeenCalled();

    rerender(<Harness keys={{ pause }} dialog />);
    blurAll();
    await user.keyboard(" ");
    expect(pause).not.toHaveBeenCalled();

    rerender(<Harness keys={{ pause, spaceTaken: () => true }} />);
    blurAll();
    await user.keyboard(" ");
    expect(pause).not.toHaveBeenCalled();

    // 交易所的列表这类自己处理空格（看明细）的：preventDefault 了就不再暂停
    cleanup();
    render(
      <div onKeyDown={(e) => e.preventDefault()}>
        <Harness keys={{ pause }} />
      </div>,
    );
    screen.getByRole("button", { name: "窗口里的按钮" }).focus();
    await user.keyboard(" ");
    expect(pause).not.toHaveBeenCalled();
  });

  it("pause 为 null（养成画面在排日程）时空格照常是浏览器的按键", async () => {
    const user = userEvent.setup();
    const clicked = vi.fn();
    render(
      <>
        <Harness keys={{ pause: null }} />
        <button type="button" onClick={clicked}>
          命令栏
        </button>
      </>,
    );
    screen.getByRole("button", { name: "命令栏" }).focus();
    await user.keyboard(" ");
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});

describe("全局快捷键：Esc", () => {
  it("焦点在外面（命令栏、空白处）时关掉功能窗口；焦点在窗口里时归窗口自己", async () => {
    const user = userEvent.setup();
    const closeWindow = vi.fn();
    render(<Harness keys={{ closeWindow }} />);
    screen.getByRole("button", { name: "外面的按钮" }).focus();
    await user.keyboard("{Escape}");
    expect(closeWindow).toHaveBeenCalledTimes(1);
    blurAll();
    await user.keyboard("{Escape}");
    expect(closeWindow).toHaveBeenCalledTimes(2);
    screen.getByRole("button", { name: "窗口里的按钮" }).focus();
    await user.keyboard("{Escape}");
    expect(closeWindow).toHaveBeenCalledTimes(2);
  });

  it("有对话框开着、焦点却在外面：Esc 交给最上层的对话框（等于在它里面按 Esc），不去关下面的窗口", async () => {
    const user = userEvent.setup();
    const inDialog = vi.fn();
    const closeWindow = vi.fn();
    render(
      <>
        <Harness keys={{ closeWindow }} />
        <div role="dialog" aria-modal="true" aria-label="下面的" onKeyDown={() => inDialog("下面的")} />
        <div role="alertdialog" aria-modal="true" aria-label="确认" onKeyDown={(e) => inDialog(`确认:${e.key}`)} />
      </>,
    );
    blurAll();
    await user.keyboard("{Escape}");
    expect(inDialog).toHaveBeenCalledTimes(1);
    expect(inDialog).toHaveBeenCalledWith("确认:Escape");
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("新手教程进行中、或者别的处理（收起船长卡、天气预报）已经用掉这个 Esc 时不再关窗口", async () => {
    const user = userEvent.setup();
    const closeWindow = vi.fn();
    const { rerender } = render(
      <>
        <Harness keys={{ closeWindow }} />
        <div data-testid="tutorial" />
      </>,
    );
    blurAll();
    await user.keyboard("{Escape}");
    expect(closeWindow).not.toHaveBeenCalled();
    rerender(
      <div onKeyDown={(e) => e.preventDefault()}>
        <Harness keys={{ closeWindow }} />
      </div>,
    );
    screen.getByRole("button", { name: "外面的按钮" }).focus();
    await user.keyboard("{Escape}");
    expect(closeWindow).not.toHaveBeenCalled();
  });
});

describe("全局快捷键：回车与 M", () => {
  it("回车：焦点不在按钮上时按下唯一的主按钮；焦点在别的按钮上时照常按那个按钮；有两个主按钮时不猜", async () => {
    const user = userEvent.setup();
    const toggleStage = vi.fn();
    const { rerender } = render(<Harness keys={{ toggleStage }} primary={1} />);
    blurAll();
    await user.keyboard("{Enter}");
    expect(toggleStage).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "外面的按钮" }).focus();
    await user.keyboard("{Enter}");
    expect(toggleStage).toHaveBeenCalledTimes(1);
    rerender(<Harness keys={{ toggleStage }} primary={2} />);
    blurAll();
    await user.keyboard("{Enter}");
    expect(toggleStage).toHaveBeenCalledTimes(1);
  });

  it("回车：有对话框开着时只在对话框里找主按钮（下面界面的主按钮不算）", async () => {
    const user = userEvent.setup();
    const toggleStage = vi.fn();
    render(<Harness keys={{ toggleStage }} primary={1} dialog />);
    blurAll();
    await user.keyboard("{Enter}");
    expect(toggleStage).not.toHaveBeenCalled();
  });

  it("M：切换街景 / 航海图；在输入框里打字时只是字符", async () => {
    const user = userEvent.setup();
    const toggleStage = vi.fn();
    render(<Harness keys={{ toggleStage }} />);
    blurAll();
    await user.keyboard("m");
    expect(toggleStage).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole("textbox", { name: "存档名" }), "m");
    expect(toggleStage).toHaveBeenCalledTimes(1);
  });

  it("没有启用（旧界面）时什么都不挂", async () => {
    const user = userEvent.setup();
    const keys = { pause: vi.fn(), closeWindow: vi.fn(), toggleStage: vi.fn() };
    render(<Harness keys={keys} enabled={false} primary={1} />);
    blurAll();
    await user.keyboard(" {Escape}{Enter}m");
    expect(keys.pause).not.toHaveBeenCalled();
    expect(keys.closeWindow).not.toHaveBeenCalled();
    expect(keys.toggleStage).not.toHaveBeenCalled();
  });
});

describe("主界面里的全局快捷键（新界面）", () => {
  beforeEach(() => {
    setUiFor("v2");
    startedGame();
    useShell.setState({ windowOpen: true });
  });

  it("空格按最近的倍速继续；焦点在命令栏上按 Esc 关掉功能窗口；M 切到航海图再切回街景", async () => {
    const user = userEvent.setup();
    const calls = installIpc();
    useGame.setState({ overview: { ...overview, speed: 0 }, runSpeed: 4 });
    render(<App />);
    await screen.findByTestId("game-window");
    blurAll();
    await user.keyboard(" ");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));

    const tab = document.getElementById("cmd-tab-port");
    expect(tab).not.toBeNull();
    tab!.focus();
    await user.keyboard("{Escape}");
    expect(useShell.getState().windowOpen).toBe(false);
    expect(screen.queryByTestId("game-window")).toBeNull();

    blurAll();
    await user.keyboard("m");
    expect(useGame.getState().stage).toBe("chart");
    await user.keyboard("m");
    expect(useGame.getState().stage).toBe("town");
  });

  it("在海上时 M 不切到街景（街景不可用）", async () => {
    const user = userEvent.setup();
    installIpc();
    const atSea = { ...overview.fleets[0], docked: null, dest: 1, days_at_sea: 3 };
    useGame.setState({ overview: { ...overview, fleets: [atSea] }, stage: "chart" });
    render(<App />);
    await screen.findByTestId("hud");
    blurAll();
    await user.keyboard("m");
    expect(useGame.getState().stage).toBe("chart");
  });

  it("全部快捷键的卡片列出新加的键：时间与画面、回车按主按钮、剧情对话", async () => {
    const user = userEvent.setup();
    render(<ShortcutHelp />);
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "全部快捷键" });
    for (const group of ["时间与画面", "窗口与对话框", "剧情对话", "交易所", "手动航行", "新手教程"]) {
      expect(within(dialog).getByRole("region", { name: group })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole("region", { name: "养成" })).toBeNull();
    expect(dialog).toHaveTextContent("切换港口街景 / 航海图");
    expect(dialog).toHaveTextContent("按主按钮（继续、开始这个月、启航……）");
    expect(dialog).toHaveTextContent("在选项之间移动");
  });

  it("设置的“新手教程”一节里有“全部快捷键”，点它打开同一张卡（旧界面没有）", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <>
        <TutorialSection />
        <ShortcutHelp />
      </>,
    );
    const section = screen.getByTestId("settings-tutorial");
    expect(section).toHaveTextContent("空格暂停 / 继续、Esc 关掉最上层");
    await user.click(within(section).getByRole("button", { name: /全部快捷键/ }));
    expect(screen.getByRole("dialog", { name: "全部快捷键" })).toBeInTheDocument();
    act(() => closeShortcutHelp());
    unmount();
    setUiFor("v1");
    render(<TutorialSection />);
    expect(within(screen.getByTestId("settings-tutorial")).queryByRole("button", { name: /全部快捷键/ })).toBeNull();
  });

  it("养成画面里的卡片换成与它有关的几组（没有交易所与手动航行）", async () => {
    const user = userEvent.setup();
    render(<ShortcutHelp context="upbringing" />);
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "全部快捷键" });
    for (const group of ["时间与画面", "窗口与对话框", "剧情对话", "养成", "新手教程"]) {
      expect(within(dialog).getByRole("region", { name: group })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole("region", { name: "交易所" })).toBeNull();
    expect(within(dialog).queryByRole("region", { name: "手动航行" })).toBeNull();
    expect(dialog).toHaveTextContent("开始这个月（三旬都排好以后）");
  });
});

// ───────── 剧情对话框 ─────────

const threeChoices: StoryView = {
  line: { key: "rossella", name: "盐与潮", done: 1, total: 7, hint: "" },
  pending: {
    day: 30,
    fleet: 0,
    kind: "chapter",
    key: "first_bill",
    chapter: 2,
    total: 7,
    story: "盐与潮",
    title: "红蜡封的信",
    text: "信差递来一封信。",
    speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "佩德雷拉老爷" },
    choices: [
      { text: "马上付清利息。", cost: 0 },
      { text: "先付一半。", cost: 2000, blocked: "cash" },
      { text: "写信求他再宽限些日子。", cost: 0 },
      { text: "把信塞进抽屉。", cost: 0 },
    ],
  },
  last: null,
  journal: [],
};

/** 剧情对话框 + 主界面的全局快捷键（只挂 Esc 与回车用到的部分）。 */
function StoryHost() {
  useGlobalHotkeys(true, {});
  return <StoryDialog />;
}

describe("剧情对话框的键盘", () => {
  beforeEach(() => {
    useGame.setState({ statics: captainStatics, overview: { ...overview, story: threeChoices } as Overview });
  });

  it("新界面：↑ ↓ 在能选的选项之间移动焦点（跳过不能选的、到头绕回），Home / End 到两头；回车选定", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc();
    render(<StoryDialog />);
    const c = (i: number) => screen.getByTestId(`story-choice-${i}`);
    expect(c(0)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(c(2)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(c(3)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(c(0)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(c(3)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(c(0)).toHaveFocus();
    await user.keyboard("{End}");
    expect(c(3)).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    await waitFor(() => expect(calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, a]) => a.command)).toEqual([{ StoryAnswer: { owner: "player", choice: 2 } }]));
  });

  it("新界面：点了对话框的空白处（焦点掉到页面上）再按 Esc，照样是“稍后再说”", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    installIpc();
    render(<StoryHost />);
    expect(screen.getByTestId("story-dialog")).toBeInTheDocument();
    blurAll();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("story-dialog")).toBeNull();
    expect(useStoryUi.getState().dismissed).not.toBe("");
  });

  it("旧界面：方向键不移动焦点（维持原样）", async () => {
    const user = userEvent.setup();
    installIpc();
    render(<StoryDialog />);
    expect(screen.getByTestId("story-choice-0")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("story-choice-0")).toHaveFocus();
  });
});

// ───────── 养成主画面 ─────────

const ubAct = (o: Partial<ActivityView> & Pick<ActivityView, "key" | "name" | "kind">): ActivityView => ({
  desc: "",
  scene: "dock",
  cost: 0,
  income: [0, 0],
  fatigue: 6,
  mood: 0,
  gains: [],
  skills: [],
  mentor: null,
  companions: [],
  tier: null,
  risk: 0,
  needs: [],
  enabled: true,
  tags: [],
  new: false,
  ...o,
});

function ubView(phase: UpbringingView["phase"] = "plan"): UpbringingView {
  return {
    stage: "home",
    stage_name: "家乡 · 土佐中村",
    home: "土佐中村",
    academy: null,
    today: [1553, 5, 1],
    phase,
    protagonist: { key: "mio", name: "一条澪", age: 12, birthday: [6, 21], portrait: null, outfit: null, season: 0 },
    meters: {
      stamina: { value: 70, max: 100, label: "精神" },
      fatigue: { value: 20, max: 100, label: "还好" },
      mood: { value: 60, max: 100, label: "雀跃" },
      fame: { value: 10, max: 100, label: "无名" },
    },
    cash: 120,
    growth: [{ attr: "seamanship", value: 400, projected: 4 }],
    ratings: [],
    skills: [],
    plan: {
      month: [1553, 5],
      editable: phase === "plan",
      slots: [0, 1, 2].map((i) => ({
        index: i,
        label: ["上旬", "中旬", "下旬"][i],
        from: [1553, 5, i * 10 + 1] as [number, number, number],
        to: [1553, 5, i * 10 + 10] as [number, number, number],
        lesson: null,
        after: null,
        status: "empty" as const,
      })),
    },
    lessons: [],
    activities: [
      ubAct({ key: "dock", name: "码头搬运", kind: "job", gains: [{ attr: "seamanship", range: [6, 10] }], income: [20, 40], fatigue: 10 }),
      ubAct({ key: "outing", name: "约人出去", kind: "date", needs: ["companion", "place"], fatigue: 2, mood: 6 }),
      ubAct({ key: "rest", name: "休息", kind: "rest", fatigue: -20, mood: 4 }),
    ],
    places: [{ key: "market", name: "市集", x: 50, y: 50, kind: "market", open: true, people: [], hint: null }],
    excursions: [],
    companions: [
      { key: "ushio", name: "汐", portrait: null, role: "family", bond: "B", affinity: 60, heart: null, heart_stage: null, romance_open: false, relation: [], call_name: "姬样", birthday: [6, 21], days_to_birthday: 51, likes_known: [], dislikes_known: [], where_now: null, next_hint: null },
    ],
    calendar: [],
    exams: [],
    path: { choose_on: null, chosen: null, options: [] },
    memories: [],
    letters: [],
    diary: [],
    presets: [],
    last: [],
  };
}

const ubCaptain = {
  points: {},
  signs: [],
  questions: [],
  attributes: [{ key: "seamanship", name: "航海", desc: "" }],
} as unknown as CaptainDefsView;
const ubStatics: StaticView = { ...statics, captain: ubCaptain };

const pickCard = async (user: ReturnType<typeof userEvent.setup>, key: string) => user.click(within(screen.getByTestId(`act-${key}`)).getByRole("button"));

describe("养成主画面的手感（新界面）", () => {
  beforeEach(() => {
    setUiFor("v2");
    useGame.setState({ statics: ubStatics, overview: { ...overview, speed: 0, mode: "upbringing" }, version: 1, error: null, message: null, runSpeed: 2 });
  });

  it("补选（去哪里、和谁）补齐了，选中自动跳到下一个空格；排满以后焦点不在按钮上时回车就开始这个月", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ upbringing: () => ubView(), submit: () => ({ outcome: "Done", overview: { ...overview, speed: 0, mode: "upbringing" } }) });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    await pickCard(user, "outing");
    // 要补选：选中还停在上旬
    expect(screen.getByTestId("cell-0:after")).toHaveAttribute("aria-pressed", "true");
    await user.selectOptions(screen.getByLabelText("去哪里"), "market");
    expect(screen.getByTestId("cell-0:after")).toHaveAttribute("aria-pressed", "true");
    await user.selectOptions(screen.getByLabelText("和谁"), "ushio");
    // 补齐了：跳到中旬
    expect(screen.getByTestId("cell-1:after")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("点一张卡，排进中旬")).toBeInTheDocument();
    await pickCard(user, "dock");
    await pickCard(user, "rest");
    const go = screen.getByRole("button", { name: "开始这个月" });
    expect(go).toBeEnabled();
    blurAll();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlanMonth: {
            owner: "player",
            slots: [
              { index: 0, after: { activity: "outing", place: "market", companion: "ushio" } },
              { index: 1, after: { activity: "dock" } },
              { index: 2, after: { activity: "rest" } },
            ],
          },
        },
      }),
    );
  });

  it("排日程时：播放键的悬停提示写明为什么按不了，空格不让时间走；这个月进行中时空格暂停 / 继续", async () => {
    const user = userEvent.setup();
    let phase: UpbringingView["phase"] = "plan";
    const calls = installIpc({ upbringing: () => ubView(phase) });
    const { unmount } = render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const play = screen.getByRole("button", { name: "继续" });
    expect(play).toBeDisabled();
    expect(play).toHaveAttribute("title", "先排好这个月的日程，点“开始这个月”时间才会走");
    blurAll();
    await user.keyboard(" ");
    expect(calls.mock.calls.filter(([c]) => c === "set_speed")).toEqual([]);
    unmount();

    phase = "running";
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(screen.getByRole("button", { name: "继续" })).toHaveAttribute("title", "继续（空格）");
    blurAll();
    await user.keyboard(" ");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 2 }));
  });

  it("自动安排里的“照上月”单独一个键：一次点击就按上个月排好（其余几种照旧在下拉框里）", async () => {
    const user = userEvent.setup();
    const presets = [
      { key: "balanced", name: "均衡" },
      { key: "previous", name: "照上月" },
    ];
    const calls = installIpc({
      upbringing: () => ({ ...ubView(), presets }),
      auto_plan: () => ({ slots: [0, 1, 2].map((i) => ({ index: i, after: { activity: i === 1 ? "rest" : "dock" } })) }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const repeat = screen.getByRole("button", { name: "照上月" });
    expect(repeat).toHaveAttribute("title", "把上个月的日程照搬过来（这个月排不了的话按“均衡”排），排好以后还可以再改");
    // 下拉框照旧在旁边，里面也还有“照上月”
    expect(within(screen.getByLabelText("自动安排")).getByRole("option", { name: "照上月" })).toBeInTheDocument();
    await user.click(repeat);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("auto_plan", { preset: "previous" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始这个月" })).toBeEnabled());
    expect(screen.getByTestId("cell-1:after")).toHaveTextContent("休息");
  });

  it("旧界面：补齐了也不跳格、播放键没有悬停提示（维持原样）", async () => {
    setUiFor("v1");
    const user = userEvent.setup();
    installIpc({ upbringing: () => ({ ...ubView(), presets: [{ key: "previous", name: "照上月" }] }) });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(screen.getByRole("button", { name: "继续" })).not.toHaveAttribute("title");
    expect(screen.queryByRole("button", { name: "照上月" })).toBeNull();
    await pickCard(user, "outing");
    await user.selectOptions(screen.getByLabelText("去哪里"), "market");
    await user.selectOptions(screen.getByLabelText("和谁"), "ushio");
    expect(screen.getByTestId("cell-0:after")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("手动出港的对话框（新界面）", () => {
  beforeEach(() => {
    startedGame();
    useGame.setState({ overview: { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] }, stage: "chart" });
    useNavStore.setState({ departing: true, busy: false });
  });
  afterEach(() => useNavStore.setState({ departing: false }));

  it("Esc 取消出港（回到港口街景）；“启航”是主按钮，焦点不在别的按钮上时回车就按它", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    installIpc();
    render(<DepartDialog source={null} />);
    const dialog = screen.getByTestId("nav-depart");
    expect(within(dialog).getByTestId("nav-depart-go")).toHaveAttribute("data-hotkey", "primary");
    within(dialog).getByRole("button", { name: "启航" }).focus();
    await user.keyboard("{Escape}");
    expect(useNavStore.getState().departing).toBe(false);
    expect(screen.queryByTestId("nav-depart")).toBeNull();
    expect(useGame.getState().stage).toBe("town");
  });

  it("旧界面：Esc 不做什么、没有主按钮的标记（维持原样）", async () => {
    const user = userEvent.setup();
    installIpc();
    render(<DepartDialog source={null} />);
    const dialog = screen.getByTestId("nav-depart");
    expect(within(dialog).getByTestId("nav-depart-go")).not.toHaveAttribute("data-hotkey");
    within(dialog).getByTestId("nav-depart-go").focus();
    await user.keyboard("{Escape}");
    expect(useNavStore.getState().departing).toBe(true);
  });
});
