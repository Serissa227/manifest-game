// 新界面（v2）第二阶段收尾的补缺（完整性复审列出的空档）：载入中与下载失败、全部快捷键（“?”与窗口标题栏上的小键帽）、
// 几处空状态补上的一句说明与“下一步”。也核对旧界面（v1）维持原样：DOM 与原来一样，没有任何 v2 的类，“?”什么都不做。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Window from "../components/Window";
import { Loading, ShortcutHelp, closeShortcutHelp } from "../components/feedback";
import FleetPanel from "../components/panels/FleetPanel";
import Market from "../components/panels/Market";
import PortPanel from "../components/panels/PortPanel";
import PeoplePanel from "../components/people/PeoplePanel";
import { LoadBoundary } from "../components/shell/LoadBoundary";
import { loadable } from "../components/shell/loadable";
import { useShell } from "../components/shell/shellState";
import { setLocale } from "../i18n/locale";
import type { PersonCard } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, port, startedGame } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

beforeEach(() => {
  setLocale("zh-CN");
  startedGame();
  useShell.setState({ windowOpen: false });
});
afterEach(() => {
  cleanup();
  act(() => closeShortcutHelp());
  setUiFor("v1");
});

function Panel() {
  return <p>面板</p>;
}

/** 第一次下载失败、第二次成功的按需面板（与 lazy.test.tsx 同一种错误）。 */
function flakyPanel() {
  let attempt = 0;
  const load = vi.fn(() => {
    attempt++;
    return attempt === 1 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module: /manifest/assets/FleetPanel.js")) : Promise.resolve({ default: Panel });
  });
  return { load, L: loadable(load) };
}

function Host({ view: View, screen: whole = false }: { view: ComponentType; screen?: boolean }) {
  return (
    <LoadBoundary screen={whole}>
      <Suspense fallback={<Loading />}>
        <View />
      </Suspense>
    </LoadBoundary>
  );
}

describe("载入中与下载失败", () => {
  it("v2：载入中是一行说明（读屏念一次）与三道骨架细条，不是空状态的虚线框", () => {
    setUiFor("v2");
    render(<Loading />);
    const box = screen.getByRole("status");
    expect(box).toHaveClass("v2-loading-block");
    expect(box).toHaveTextContent("正在载入……");
    expect(box.querySelectorAll(".v2-skeleton-line")).toHaveLength(3);
    expect(document.querySelector(".empty")).toBeNull();
  });

  it("v1：载入中照旧——缺省是 <p class=\"empty\">，原来是别的写法就画原样", () => {
    const { container: a } = render(<Loading />);
    expect(a.innerHTML).toBe('<p class="empty">正在载入……</p>');
    cleanup();
    const { container: b } = render(<Loading v1={<p className="ts-empty">正在载入……</p>} />);
    expect(b.innerHTML).toBe('<p class="ts-empty">正在载入……</p>');
    expect(v2Classes()).toEqual([]);
  });

  it("v2：代码块没能下载——印章红的就地错误（为什么、怎么办、“重试”），重试重新下载", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const { load, L } = flakyPanel();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Host view={L.Component} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("v2-inline-error");
    expect(alert).toHaveTextContent("这部分界面没能载入");
    expect(alert).toHaveTextContent("游戏进度不受影响");
    expect(screen.getByTestId("load-failed")).not.toHaveClass("is-screen");
    await user.click(within(alert).getByRole("button", { name: "重试" }));
    expect(await screen.findByText("面板")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it("v2：整屏的界面没能下载时，错误放在深色底正中的一张纸卡里", async () => {
    setUiFor("v2");
    const { L } = flakyPanel();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Host view={L.Component} screen />);
    const box = await screen.findByTestId("load-failed");
    expect(box).toHaveClass("v2-load-failed", "is-screen");
    expect(within(box).getByRole("alert")).toHaveTextContent("这部分界面没能载入");
    expect(box.querySelector(".v2-load-failed-card")).not.toBeNull();
    err.mockRestore();
  });

  it("v1：下载失败照旧是一段字与一个“重试”，整屏的也一样，没有 v2 的类", async () => {
    const { L } = flakyPanel();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Host view={L.Component} screen />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("load-failed");
    expect(alert.innerHTML).toBe('<p>这部分界面没能载入（网络不稳？）</p><button type="button" class="btn">重试</button>');
    expect(v2Classes()).toEqual([]);
    err.mockRestore();
  });
});

describe("全部快捷键", () => {
  it("v2：按“?”打开，按用途分组列出现有的键；焦点在“关上”上，Esc 关上后焦点回到原处", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    render(
      <>
        <button type="button">原处</button>
        <ShortcutHelp />
      </>,
    );
    screen.getByRole("button", { name: "原处" }).focus();
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "全部快捷键" });
    for (const group of ["交易所", "窗口与对话框", "手动航行", "新手教程"]) expect(within(dialog).getByRole("region", { name: group })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("选货");
    expect(dialog).toHaveTextContent("关窗口、取消对话框");
    expect(dialog).toHaveTextContent("转舵（按住连续转）");
    expect(within(dialog).getByRole("button", { name: /关上/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "原处" })).toHaveFocus();
  });

  it("v2：在输入框里打“?”只是字符；别的模态对话框开着时也不打开", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="存档名" />
        <ShortcutHelp />
      </>,
    );
    await user.type(screen.getByRole("textbox", { name: "存档名" }), "?");
    expect(screen.getByRole("textbox", { name: "存档名" })).toHaveValue("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="剧情" />
        <ShortcutHelp />
      </>,
    );
    await user.keyboard("?");
    expect(screen.queryByRole("dialog", { name: "全部快捷键" })).toBeNull();
  });

  it("v2：功能窗口标题栏上有“?”小键帽，点它也打开同一张卡", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    render(
      <>
        <Window title="港口" onClose={() => {}}>
          <p>内容</p>
        </Window>
        <ShortcutHelp />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "全部快捷键" }));
    expect(screen.getByRole("dialog", { name: "全部快捷键" })).toBeInTheDocument();
  });

  it("v1：没有小键帽，按“?”什么都不打开", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Window title="港口" onClose={() => {}}>
          <p>内容</p>
        </Window>
        <ShortcutHelp />
      </>,
    );
    expect(screen.queryByRole("button", { name: "全部快捷键" })).toBeNull();
    await user.keyboard("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("空状态的说明与“下一步”", () => {
  it("v2：一支舰队都没有——说明怎么再组一支，“去造船厂”打开所选港口的造船厂", async () => {
    setUiFor("v2");
    installIpc();
    useGame.setState({ overview: { ...overview, fleets: [] }, selectedLoc: 0, facility: "market" });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("你没有舰队");
    expect(empty).toHaveTextContent("在有造船厂的港口买一艘船");
    await user.click(within(empty).getByRole("button", { name: "去造船厂" }));
    const g = useGame.getState();
    expect([g.tab, g.facility, g.selectedLoc]).toEqual(["port", "shipyard", 0]);
    expect(useShell.getState().windowOpen).toBe(true);
  });

  it("v1：没有舰队照旧是一行字", () => {
    installIpc();
    useGame.setState({ overview: { ...overview, fleets: [] } });
    const { container } = render(<FleetPanel />);
    expect(container.innerHTML).toBe('<p class="empty">你没有舰队</p>');
  });

  it("v2：没到过的港口的交易所——说明怎样才看得到，“打开航海图”换到航海图、关上窗口", async () => {
    setUiFor("v2");
    installIpc();
    useGame.setState({ stage: "town" });
    useShell.setState({ windowOpen: true });
    const user = userEvent.setup();
    render(<Market port={{ ...port, known: false }} />);
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("尚未到访");
    expect(empty).toHaveTextContent("行情通报");
    await user.click(within(empty).getByRole("button", { name: "打开航海图" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("v2：银行没有借款是一小块空状态（写“没有借款”与怎么借）；v1 照旧是“无”", async () => {
    setUiFor("v2");
    installIpc({ port: () => ({ ...port, bank: { ...port.bank, loans: [] } }) });
    useGame.setState({ facility: "bank", selectedLoc: 0 });
    render(<PortPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveClass("v2-empty", "is-compact");
    expect(empty).toHaveTextContent("没有借款。");
    cleanup();
    setUiFor("v1");
    render(<PortPanel />);
    const bank = await screen.findByTestId("bank");
    expect(within(bank).getByText("无")).toHaveClass("empty");
    expect(v2Classes()).toEqual([]);
  });

  it("v2：人物名单只看此地、此地没有认识的人——“显示全部的人”取消筛选", async () => {
    setUiFor("v2");
    const ines: PersonCard = {
      key: "ines_costa",
      name: "伊内丝·达·科斯塔",
      portrait: null,
      age: 24,
      kind: "story",
      role: "书记的女儿",
      where: "安特卫普",
      affinity: 20,
      heart: null,
      heart_stage: null,
      bond: null,
      relation: [],
      call_name: "船长",
      can_recruit: false,
      requests: 0,
    };
    installIpc({ persons: (a) => ({ persons: a.loc === null ? [ines] : [] }), gossip: () => ({ items: [], unread: 0 }) });
    useGame.setState({ selectedLoc: 0 });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await screen.findByTestId("person-ines_costa");
    await user.click(screen.getByRole("checkbox", { name: "只看此刻在这里的" }));
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("此刻这里没有认识的人。");
    await user.click(within(empty).getByRole("button", { name: "显示全部的人" }));
    expect(await screen.findByTestId("person-ines_costa")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "只看此刻在这里的" })).not.toBeChecked();
  });
});
