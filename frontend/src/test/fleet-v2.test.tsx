// 新界面（v2）第二阶段·舰队与人（docs/UI-REDESIGN.md 第 8、9 节）：只在 v2 下加的结构与行为——
// 舰队：选舰队是一排按钮、货舱空时“去交易所”、出航旁就地写缺员并一键补到最低人数；
// 航海士：没有航海士时“去酒馆”、解雇先确认（取消不解雇）、招募在行内、人在别处 / 名声不够时就地写原因；
// 行囊：物品行里的一键（装上、读、使用）不用先选中、空的分类“看全部物品”；任务日志的空状态；关系图的图例与键盘；自由对话做不了的原因。
// 第四轮（审查意见）：隐藏的航海士解雇时的后果各写各的；殖民点没有交易所与酒馆；缺员补不到时写明为什么；“购买补给”排在航行条前面；
// 手机上物品与图鉴的详情在底部升起的抽屉里（列表不滚走）；桌面上详情一栏一开始就留着。
// 也核对旧界面（v1）维持原样：这些新结构一个都不出现，解雇照旧直接办。
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CodexPanel from "../components/items/CodexPanel";
import InventoryPanel from "../components/items/InventoryPanel";
import FleetPanel from "../components/panels/FleetPanel";
import MatesPanel from "../components/panels/MatesPanel";
import PeoplePanel from "../components/people/PeoplePanel";
import QuestsPanel from "../components/people/QuestsPanel";
import { useShell } from "../components/shell/shellState";
import { useNavStore } from "../hooks/useNavigation";
import { setLocale } from "../i18n/locale";
import type {
  CodexView,
  FleetView,
  InventoryView,
  ItemLine,
  MateView,
  PersonCard,
  PersonDetail,
  RelationshipsView,
} from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import {
  captainDefs,
  colonialStatics,
  installIpc,
  mate,
  overview,
  startedGame,
  statics,
} from "./fixtures";
import { PHONE, mockViewport, resetViewport } from "./viewport";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () =>
  [...document.querySelectorAll("[class]")]
    .flatMap((el) => [...el.classList])
    .filter((c) => /^v2(-|$)/.test(c));

const base: FleetView = overview.fleets[0];
/** 有航线的预计（出航可用与否只看船员）。 */
const PREVIEW = {
  days: 5,
  path: [
    [1, 1],
    [2, 1],
  ] as [number, number][],
  supplies: 6,
};

beforeEach(() => {
  setLocale("zh-CN");
  startedGame();
  useShell.setState({ windowOpen: false });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
  resetViewport();
});

/** 记下 scrollIntoView 的调用（jsdom 没有这个方法；组件里用 ?. 调）。 */
function spyScrollIntoView() {
  const spy = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: spy,
    configurable: true,
    writable: true,
  });
  return {
    spy,
    restore: () => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    },
  };
}

describe("舰队（v2）", () => {
  it("货舱空：空状态写明在哪儿，“去交易所”打开本港的交易所", async () => {
    setUiFor("v2");
    installIpc();
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, cargo: [] }] },
      tab: "fleet",
      facility: "shipyard",
      selectedLoc: 1,
    });
    const user = userEvent.setup();
    render(<FleetPanel />);
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("货舱空空如也");
    expect(empty).toHaveTextContent("停在澄港：交易所就在码头边。");
    await user.click(within(empty).getByRole("button", { name: "去交易所" }));
    const g = useGame.getState();
    expect([g.tab, g.facility, g.selectedLoc]).toEqual(["port", "market", 0]);
    expect(useShell.getState().windowOpen).toBe(true);
  });

  it("在海上时货舱空只写靠港以后，没有按钮", () => {
    setUiFor("v2");
    installIpc();
    useGame.setState({
      overview: {
        ...overview,
        fleets: [{ ...base, docked: null, dest: 1, cargo: [] }],
      },
    });
    render(<FleetPanel />);
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("靠港以后可以在交易所进货。");
    expect(within(empty).queryByRole("button")).toBeNull();
  });

  it("两支舰队：选舰队是一排按钮，点一下就换；只有一支时不出现", async () => {
    setUiFor("v2");
    installIpc();
    const second: FleetView = { ...base, id: 3 };
    useGame.setState({
      overview: { ...overview, fleets: [base, second] },
      selectedFleet: 0,
    });
    const user = userEvent.setup();
    const { unmount } = render(<FleetPanel />);
    const pick = screen.getByRole("group", { name: "选舰队" });
    expect(
      within(pick).getByRole("button", { name: "舰队 #0" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(pick).getByRole("button", { name: "舰队 #3" }));
    expect(useGame.getState().selectedFleet).toBe(3);
    expect(screen.queryByRole("combobox", { name: "舰队" })).toBeNull();
    unmount();
    useGame.setState({ overview: { ...overview, fleets: [base] } });
    render(<FleetPanel />);
    expect(screen.queryByRole("group", { name: "选舰队" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "舰队" })).toBeNull();
  });

  it("手动航行的世界：“出港”打开出港罗经盘，不提交 SetSail；海上与非旗舰队不可用并写明为什么", async () => {
    setUiFor("v2");
    const calls = installIpc();
    const manualStatics = {
      ...statics,
      world: { ...statics.world, modules: ["navigation_manual"] },
    };
    const second: FleetView = { ...base, id: 3 };
    useGame.setState({
      statics: manualStatics,
      overview: { ...overview, fleets: [base, second] },
      selectedFleet: 0,
      stage: "town",
    });
    useNavStore.setState({ departing: false });
    const user = userEvent.setup();
    const { unmount } = render(<FleetPanel />);
    expect(screen.getByTestId("sail-manual")).toHaveTextContent(
      "出港时在罗经盘上定航向",
    );
    expect(screen.queryByRole("combobox", { name: "目的地" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "出港" }));
    expect(useNavStore.getState().departing).toBe(true);
    expect(useGame.getState().stage).toBe("chart");
    const sails = calls.mock.calls.filter(
      ([cmd, a]) => cmd === "submit" && "SetSail" in (a.command as object),
    );
    expect(sails).toHaveLength(0);
    unmount();
    useNavStore.setState({ departing: false });
    useGame.setState({ selectedFleet: 3 });
    const second_ = render(<FleetPanel />);
    expect(screen.getByTestId("sail-manual")).toHaveTextContent(
      "其他舰队在这里开不出港",
    );
    expect(screen.getByRole("button", { name: "出港" })).toBeDisabled();
    second_.unmount();
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, docked: null, dest: 1 }] },
      selectedFleet: 0,
    });
    render(<FleetPanel />);
    expect(screen.getByTestId("sail-manual")).toHaveTextContent("已经在海上了");
    expect(screen.getByRole("button", { name: "出港" })).toBeDisabled();
  });

  it("船员不够：出航旁就地写原因，一键补到最低人数", async () => {
    setUiFor("v2");
    const calls = installIpc();
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, hire_max: 15 }] },
    });
    const user = userEvent.setup();
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const note = screen.getByTestId("fleet-sail-crew");
    expect(note).toHaveTextContent("船员不够 8 人，开不了船（现有 5 人）。");
    await user.click(
      within(note).getByRole("button", { name: "补到最低人数（+3，30 金币）" }),
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { HireCrew: { owner: "player", fleet: 0, count: 3 } },
      }),
    );
  });

  it("船员不够：“补到最低人数”正在办时不可用，连点两下也只雇一次", async () => {
    setUiFor("v2");
    let release: (v: unknown) => void = () => {};
    const calls = installIpc({
      submit: () => new Promise((r) => (release = r)),
    });
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, hire_max: 15 }] },
    });
    const user = userEvent.setup();
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const hire = within(screen.getByTestId("fleet-sail-crew")).getByRole(
      "button",
      { name: "补到最低人数（+3，30 金币）" },
    );
    const hires = () =>
      calls.mock.calls.filter(
        ([cmd, a]) => cmd === "submit" && "HireCrew" in (a.command as object),
      );
    await user.dblClick(hire);
    expect(hire).toBeDisabled();
    expect(hires()).toHaveLength(1);
    // 回复到了（这里人数没变，按钮还在）：又可以点
    release({ outcome: "Done", overview: useGame.getState().overview });
    await waitFor(() => expect(hire).toBeEnabled());
    expect(hires()).toHaveLength(1);
  });

  it("船员不够：“出航”不可用并指向就地的原因；“船员”一节不再重复同一句原因与同一个“补到最低人数”", async () => {
    setUiFor("v2");
    installIpc({ sail_preview: () => PREVIEW });
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, hire_max: 15 }] },
    });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    // 有航线（不可用只因为船员不够）
    expect(screen.getByTestId("sail-preview")).toHaveTextContent("预计 5 天");
    const note = within(screen.getByTestId("fleet-sail-crew")).getByTestId(
      "inline-error",
    );
    const sail = screen.getByRole("button", { name: "出航" });
    expect(sail).toBeDisabled();
    expect(sail).toHaveAttribute("aria-describedby", note.id);
    const crewSection = screen.getByTestId("fleet-crew");
    expect(within(crewSection).queryByTestId("crew-short")).toBeNull();
    expect(
      within(crewSection).queryByRole("button", { name: /^补到最低人数/ }),
    ).toBeNull();
    // “补满”照旧在“船员”一节（与“补到最低人数”人数不同时）
    expect(
      within(crewSection).getByRole("button", {
        name: "补满船员（+15，150 金币）",
      }),
    ).toBeEnabled();
    expect(
      screen.getAllByRole("button", { name: /^补到最低人数/ }),
    ).toHaveLength(1);
  });

  it("船员够了：“出航”可用、没有指向说明", async () => {
    setUiFor("v2");
    installIpc({ sail_preview: () => PREVIEW });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const sail = screen.getByRole("button", { name: "出航" });
    expect(sail).toBeEnabled();
    expect(sail).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("fleet-sail-crew")).toBeNull();
  });

  it("v1 维持原样：船员不够时“出航”照旧可点（由内核裁决），“船员”一节照旧写缺员并给两个补员按钮", async () => {
    installIpc({ sail_preview: () => PREVIEW });
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, hire_max: 15 }] },
    });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const sail = screen.getByRole("button", { name: "出航" });
    expect(sail).toBeEnabled();
    expect(sail).not.toHaveAttribute("aria-describedby");
    const crewSection = screen.getByTestId("fleet-crew");
    expect(within(crewSection).getByTestId("crew-short")).toHaveTextContent(
      "船员不足：至少要 8 人，现有 5 人。",
    );
    expect(
      within(crewSection).getByRole("button", {
        name: "补到最低人数（+3，30 金币）",
      }),
    ).toHaveClass("btn", "primary");
    expect(
      within(crewSection).getByRole("button", {
        name: "补满船员（+15，150 金币）",
      }),
    ).toHaveClass("btn");
  });

  it("锚泊在殖民点：货舱空时不给“去交易所”、不说交易所在码头边（殖民点没有交易所）", async () => {
    setUiFor("v2");
    installIpc();
    useGame.setState({
      statics: colonialStatics,
      overview: { ...overview, fleets: [{ ...base, docked: 3, cargo: [] }] },
    });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("靠港以后可以在交易所进货。");
    expect(empty).not.toHaveTextContent("交易所就在码头边");
    expect(within(empty).queryByRole("button")).toBeNull();
  });

  it("船员不够又补不到：航行条写明为什么（现金不够、这里只招得到几个）", async () => {
    setUiFor("v2");
    installIpc({ sail_preview: () => PREVIEW });
    // 现金一个人都雇不起：没有补员按钮，写“现金不够”
    useGame.setState({
      overview: {
        ...overview,
        cash: 0,
        fleets: [{ ...base, crew: 5, hire_max: 15 }],
      },
    });
    const { unmount } = render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    let note = screen.getByTestId("fleet-sail-crew");
    expect(note).toHaveTextContent("船员不够 8 人，开不了船（现有 5 人）。");
    expect(note).toHaveTextContent("现金不够招募船员。");
    expect(within(note).queryByRole("button")).toBeNull();
    // 同一句不在“船员”一节里再写一遍
    expect(screen.getAllByText("现金不够招募船员。")).toHaveLength(1);
    unmount();
    // 这里只招得到 2 人：按钮补 2 人，并写明只招得到 2 人
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, hire_max: 2 }] },
    });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    note = screen.getByTestId("fleet-sail-crew");
    expect(note).toHaveTextContent("这里只招得到 2 人。");
    expect(
      within(note).getByRole("button", { name: "补到最低人数（+2，20 金币）" }),
    ).toBeEnabled();
  });

  it("“购买补给”排在航行条前面（航行条是窗口的最后一节）；旧界面照旧在后面", async () => {
    setUiFor("v2");
    installIpc({ sail_preview: () => PREVIEW });
    const { unmount } = render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    const panel = screen.getByTestId("fleet-panel");
    expect(panel.lastElementChild).toHaveClass("pn-sail");
    expect(
      screen
        .getByTestId("supply-desk")
        .compareDocumentPosition(screen.getByTestId("sail-preview")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();
    setUiFor("v1");
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    expect(
      screen
        .getByTestId("sail-preview")
        .compareDocumentPosition(screen.getByTestId("supply-desk")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("v1 维持原样：下拉框选舰队、货舱空是一行字、没有就地的说明，DOM 里没有 v2 的类", async () => {
    installIpc();
    useGame.setState({
      overview: { ...overview, fleets: [{ ...base, crew: 5, cargo: [] }] },
    });
    render(<FleetPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(
        "正在载入",
      ),
    );
    expect(screen.getByRole("combobox", { name: "舰队" })).toBeInTheDocument();
    expect(screen.getByText("货舱空空如也").tagName).toBe("P");
    expect(screen.queryByTestId("empty-state")).toBeNull();
    expect(screen.queryByTestId("fleet-sail-crew")).toBeNull();
    expect(document.querySelector(".pn-sail")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("航海士（v2）", () => {
  const hired: MateView = {
    ...mate,
    id: 0,
    name: "林海燕",
    hired: true,
    role: { kind: "captain", target: 0 },
  };
  const elsewhere: MateView = { ...mate, id: 4, name: "邓明", at: 1 };

  it("解雇先确认：取消不办；确认后解雇，提示条回一句", async () => {
    setUiFor("v2");
    const calls = installIpc({
      mates: () => ({ hired: [hired], available: [] }),
    });
    const user = userEvent.setup();
    render(<MatesPanel />);
    const card = await screen.findByTestId("mate-0");
    await user.click(within(card).getByRole("button", { name: "解雇" }));
    let dialog = screen.getByRole("alertdialog", { name: "解雇林海燕？" });
    expect(dialog).toHaveTextContent("“舰长（舰队 #0）”这个岗位会空出来");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(calls).not.toHaveBeenCalledWith("submit", expect.anything());
    await user.click(within(card).getByRole("button", { name: "解雇" }));
    dialog = screen.getByRole("alertdialog", { name: "解雇林海燕？" });
    await user.click(
      within(dialog).getByRole("button", { name: "解雇林海燕" }),
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { DismissMate: { owner: "player", mate: 0 } },
      }),
    );
    await waitFor(() =>
      expect(useGame.getState().message).toBe("已解雇林海燕。"),
    );
  });

  it("舰队锚泊在殖民点（没有酒馆）：还没有航海士时不给“去酒馆”", async () => {
    setUiFor("v2");
    installIpc({ mates: () => ({ hired: [], available: [elsewhere] }) });
    useGame.setState({
      statics: colonialStatics,
      overview: { ...overview, fleets: [{ ...base, docked: 3 }] },
    });
    render(<MatesPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("靠港以后可以去酒馆招募。");
    expect(within(empty).queryByRole("button")).toBeNull();
  });

  it("v1 维持原样：解雇不问，直接办", async () => {
    const calls = installIpc({
      mates: () => ({ hired: [hired], available: [] }),
    });
    const user = userEvent.setup();
    render(<MatesPanel />);
    const card = await screen.findByTestId("mate-0");
    await user.click(within(card).getByRole("button", { name: "解雇" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { DismissMate: { owner: "player", mate: 0 } },
      }),
    );
  });

  it("还没有航海士：“去酒馆”打开本港的酒馆；人在别处的写明去哪里招，本港的在行内招募", async () => {
    setUiFor("v2");
    const calls = installIpc({
      mates: () => ({ hired: [], available: [mate, elsewhere] }),
    });
    const user = userEvent.setup();
    render(<MatesPanel />);
    const here = await screen.findByTestId("recruit-1");
    await user.click(
      within(here).getByRole("button", { name: "招募（1,500 金币）" }),
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { HireMate: { owner: "player", mate: 1 } },
      }),
    );
    const far = screen.getByTestId("recruit-4");
    expect(within(far).queryByRole("button")).toBeNull();
    expect(far).toHaveTextContent("要到柳湾的酒馆才能招募。");
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("还没有航海士");
    await user.click(within(empty).getByRole("button", { name: "去酒馆" }));
    const g = useGame.getState();
    expect([g.tab, g.facility, g.selectedLoc]).toEqual(["port", "tavern", 0]);
  });

  it("v1 维持原样：名声不够时招募按钮不可用、原因照旧一行字，按钮没有 aria-describedby", async () => {
    installIpc({
      mates: () => ({ hired: [], available: [{ ...mate, level: 5 }] }),
    });
    useGame.setState({ overview: { ...overview, fame: 0 } });
    render(<MatesPanel />);
    const row = await screen.findByTestId("recruit-1");
    const hire = within(row).getByRole("button", { name: /^招募/ });
    expect(hire).toBeDisabled();
    expect(hire).not.toHaveAttribute("aria-describedby");
    expect(row.querySelector(".pn-fame-short")).toHaveTextContent(
      "名声不足：需要 60，现有 45。",
    );
    expect(within(row).queryByTestId("inline-error")).toBeNull();
  });

  it("名声不够：招募按钮不可用，原因就地写在行里并与按钮关联", async () => {
    setUiFor("v2");
    installIpc({
      mates: () => ({ hired: [], available: [{ ...mate, level: 5 }] }),
    });
    useGame.setState({ overview: { ...overview, fame: 0 } });
    render(<MatesPanel />);
    const row = await screen.findByTestId("recruit-1");
    const hire = within(row).getByRole("button", { name: /^招募/ });
    expect(hire).toBeDisabled();
    const note = within(row).getByTestId("inline-error");
    expect(note).toHaveTextContent("名声不足：需要 60，现有 45。");
    expect(hire).toHaveAttribute("aria-describedby", note.id);
  });

  it("名声的要求一行只写一次：不够时只有就地原因（没有红色的“需名声”小签），够了才有小签；行内的“招募”是一键样式的按钮", async () => {
    setUiFor("v2");
    installIpc({
      mates: () => ({
        hired: [],
        available: [
          { ...mate, level: 5 },
          { ...mate, id: 7, level: 4 },
        ],
      }),
    });
    render(<MatesPanel />);
    const short = await screen.findByTestId("recruit-1");
    await waitFor(() =>
      expect(within(short).getByTestId("inline-error")).toHaveTextContent(
        "名声不足：需要 60，现有 45。",
      ),
    );
    expect(within(short).queryByText(/需名声/)).toBeNull();
    const ok = screen.getByTestId("recruit-7");
    expect(within(ok).getByText("需名声 20")).not.toHaveClass("short");
    expect(within(ok).queryByTestId("inline-error")).toBeNull();
    // 按钮仍是 ActionButton（类名不变），一键的样式由 styles/ui-v2/fleet.css 的 .pn-recruit-side .btn.primary 给
    expect(
      within(ok)
        .getByRole("button", { name: /^招募/ })
        .closest(".pn-recruit-side"),
    ).not.toBeNull();
  });
});

describe("行囊（v2）", () => {
  const item = (
    o: Partial<ItemLine> & Pick<ItemLine, "key" | "name" | "kind">,
  ): ItemLine => ({
    rarity: 1,
    qty: 1,
    equipped: 0,
    icon: "",
    desc: "",
    lore: null,
    tags: [],
    price: 100,
    bonus: [],
    effects: [],
    set: null,
    book: null,
    key_item: false,
    can_sell: true,
    can_give: true,
    can_use: false,
    ...o,
  });
  const rapier = item({
    key: "toledo_rapier",
    name: "托莱多细剑",
    kind: "weapon",
    rarity: 2,
  });
  const ring = item({
    key: "fede_ring",
    name: "信手戒",
    kind: "accessory",
    rarity: 3,
    equipped: 1,
  });
  const book = item({
    key: "kokinshu",
    name: "古今和歌集",
    kind: "book",
    book: {
      category: "poetry",
      category_name: "诗与小说",
      lang: null,
      lang_name: null,
      days: 20,
      read: false,
      can_read: "self",
      published: 905,
    },
  });
  const lemon = item({
    key: "lemon_juice",
    name: "柠檬汁",
    kind: "consumable",
    qty: 6,
    can_use: true,
  });
  const inv = (): InventoryView => ({
    items: [rapier, ring, book, lemon],
    wearers: [
      {
        key: "captain",
        name: "一条澪",
        portrait: null,
        slots: [
          { slot: "weapon", item: null },
          { slot: "accessory1", item: "fede_ring" },
        ],
        attrs: [],
      },
    ],
    reading: null,
    bibliography: { read: 0, categories: [], recent: [] },
    sets: [],
    gifts: { count: 0, value: 0, kinds: 0 },
    collection_value: 0,
  });

  beforeEach(() => {
    useGame.setState({ statics: { ...statics, captain: captainDefs } });
  });

  it("物品行里的一键：装上、读、使用都不用先选中；穿着的写“穿戴中”", async () => {
    setUiFor("v2");
    const calls = installIpc({ inventory: () => inv() });
    const user = userEvent.setup();
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    await user.click(
      screen.getByRole("button", { name: "给一条澪装上托莱多细剑" }),
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          Equip: {
            owner: "player",
            wearer: "captain",
            slot: "weapon",
            item: "toledo_rapier",
          },
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "开始读古今和歌集" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { ReadBook: { owner: "player", book: "kokinshu" } },
      }),
    );
    await user.click(screen.getByRole("button", { name: "使用柠檬汁" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { UseItem: { owner: "player", item: "lemon_juice" } },
      }),
    );
    expect(screen.queryByTestId("item-detail")).toBeNull();
    const ringRow = screen
      .getByRole("button", { name: "信手戒" })
      .closest("li") as HTMLElement;
    expect(ringRow).toHaveTextContent("穿戴中");
    expect(within(ringRow).getAllByRole("button")).toHaveLength(1);
  });

  it("一次只读一本：正在读的这本写“正在读”，别的书的“读”不可用、原因写在那一行并与按钮关联", async () => {
    setUiFor("v2");
    const poems = item({
      key: "manyoshu",
      name: "万叶集",
      kind: "book",
      book: {
        category: "poetry",
        category_name: "诗与小说",
        lang: null,
        lang_name: null,
        days: 30,
        read: false,
        can_read: "self",
        published: 759,
      },
    });
    installIpc({
      inventory: () => ({
        ...inv(),
        items: [book, poems],
        reading: {
          book: "kokinshu",
          name: "古今和歌集",
          done_days: 8,
          total_days: 20,
          mode: "self",
        },
      }),
    });
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    const readingRow = screen
      .getByRole("button", { name: "古今和歌集" })
      .closest("li") as HTMLElement;
    expect(readingRow).toHaveTextContent("正在读");
    expect(within(readingRow).getAllByRole("button")).toHaveLength(1);
    const other = screen.getByRole("button", { name: "开始读万叶集" });
    expect(other).toBeDisabled();
    const why = document.getElementById(
      other.getAttribute("aria-describedby") ?? "",
    );
    expect(why).toHaveTextContent("先读完《古今和歌集》");
    expect(other.closest("li")).toContainElement(why);
  });

  it("空的分类：空状态给“看全部物品”", async () => {
    setUiFor("v2");
    installIpc({ inventory: () => inv() });
    const user = userEvent.setup();
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    await user.click(screen.getByRole("tab", { name: "关键物品" }));
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("这一类还没有东西。");
    await user.click(within(empty).getByRole("button", { name: "看全部物品" }));
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "托莱多细剑" }),
    ).toBeInTheDocument();
  });

  it("桌面：详情一栏一开始就留着（一句提示），选中后换成详情", async () => {
    setUiFor("v2");
    installIpc({ inventory: () => inv() });
    const user = userEvent.setup();
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    expect(
      screen
        .getByText("点一件物品，看它的说明与用法。")
        .closest(".it-detail-wrap"),
    ).toHaveClass("is-hint");
    await user.click(screen.getByRole("button", { name: "托莱多细剑" }));
    expect(
      screen.getByTestId("item-detail").closest(".it-detail-wrap"),
    ).not.toHaveClass("is-hint");
    expect(screen.queryByText("点一件物品，看它的说明与用法。")).toBeNull();
    expect(screen.queryByTestId("item-sheet")).toBeNull();
  });

  it("手机：点一件，详情从底部升起（抽屉），列表不滚走；× 收起并取消选中", async () => {
    setUiFor("v2");
    mockViewport(PHONE);
    const scroll = spyScrollIntoView();
    try {
      installIpc({ inventory: () => inv() });
      const user = userEvent.setup();
      render(<InventoryPanel />);
      await screen.findByTestId("inventory");
      // 手机上没有右边一栏，也没有提示
      expect(document.querySelector(".it-detail-wrap")).toBeNull();
      const row = screen.getByRole("button", { name: "托莱多细剑" });
      await user.click(row);
      const sheet = screen.getByRole("dialog", { name: "托莱多细剑" });
      expect(sheet).toHaveClass("it-sheet");
      expect(within(sheet).getByTestId("item-detail")).toBeInTheDocument();
      // 详情里的操作在抽屉里照样能用
      expect(
        within(sheet).getByRole("button", { name: "给一条澪装上" }),
      ).toBeEnabled();
      expect(scroll.spy).not.toHaveBeenCalled();
      expect(row).toHaveAttribute("aria-pressed", "true");
      await user.click(within(sheet).getByRole("button", { name: "收起" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(row).toHaveAttribute("aria-pressed", "false");
    } finally {
      scroll.restore();
    }
  });

  it("v1 维持原样：物品格里没有一键按钮，空的分类是原来的一行字", async () => {
    installIpc({ inventory: () => inv() });
    const user = userEvent.setup();
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    expect(
      screen.queryByRole("button", { name: "给一条澪装上托莱多细剑" }),
    ).toBeNull();
    expect(screen.queryByText("穿戴中")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "关键物品" }));
    expect(screen.getByText("这一类还没有东西。")).toHaveClass("ts-empty");
    expect(v2Classes()).toEqual([]);
  });
});

describe("图鉴（v2）", () => {
  const codex: CodexView = {
    categories: [{ key: "creatures", name: "怪异", got: 1, total: 90 }],
    category: "creatures",
    entries: [
      {
        key: "hafgufa",
        name: "哈夫古法",
        state: "seen",
        icon: null,
        desc: "像岛一样大的鱼。",
        basis: "literature",
        sources: ["《国王之镜》"],
        changed: null,
      },
      {
        key: "kraken",
        name: "克拉肯",
        state: "unknown",
        icon: null,
        desc: null,
        basis: null,
        sources: [],
        changed: null,
      },
    ],
  };

  it("桌面：右边一栏一开始就留着（一句提示），打开一条后换成详情", async () => {
    setUiFor("v2");
    installIpc({ codex: () => codex });
    const user = userEvent.setup();
    render(<CodexPanel />);
    const panel = await screen.findByTestId("codex");
    expect(within(panel).getByText("点一条，看它的说明与出处。")).toHaveClass(
      "cx-hint",
    );
    await user.click(screen.getByRole("button", { name: "哈夫古法" }));
    expect(screen.getByRole("article", { name: "哈夫古法" })).toHaveTextContent(
      "《国王之镜》",
    );
    expect(panel.querySelector(".cx-hint")).toBeNull();
    expect(screen.queryByTestId("codex-sheet")).toBeNull();
  });

  it("手机：打开一条，详情从底部升起（抽屉），格子不滚走；× 收起", async () => {
    setUiFor("v2");
    mockViewport(PHONE);
    const scroll = spyScrollIntoView();
    try {
      installIpc({ codex: () => codex });
      const user = userEvent.setup();
      render(<CodexPanel />);
      const panel = await screen.findByTestId("codex");
      expect(panel.querySelector(".cx-hint")).toBeNull();
      await user.click(screen.getByRole("button", { name: "哈夫古法" }));
      const sheet = screen.getByRole("dialog", { name: "哈夫古法" });
      expect(
        within(sheet).getByRole("article", { name: "哈夫古法" }),
      ).toHaveTextContent("像岛一样大的鱼。");
      expect(panel.querySelector(".cx-detail")).toBeNull();
      expect(scroll.spy).not.toHaveBeenCalled();
      await user.click(within(sheet).getByRole("button", { name: "收起" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "哈夫古法" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    } finally {
      scroll.restore();
    }
  });

  it("v1 维持原样：没有提示、没有抽屉，详情在格子后面", async () => {
    mockViewport(PHONE);
    installIpc({ codex: () => codex });
    const user = userEvent.setup();
    render(<CodexPanel />);
    const panel = await screen.findByTestId("codex");
    expect(panel.querySelector(".cx-hint")).toBeNull();
    await user.click(screen.getByRole("button", { name: "哈夫古法" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel.lastElementChild).toHaveClass("cx-detail");
  });
});

describe("任务日志、关系图与自由对话（v2）", () => {
  it("没有进行中的任务：空状态给下一步（有收起的完成任务时先给“也看看”，否则去人物页）", async () => {
    setUiFor("v2");
    installIpc({
      story_log: () => ({
        tracks: [
          {
            key: "old",
            name: "旧请托",
            kind: "request",
            status: "done",
            chapter: "c9",
            chapter_title: "完",
            objectives: [],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    const { unmount } = render(<QuestsPanel />);
    const empty = await screen.findByTestId("empty-state");
    await user.click(
      within(empty).getByRole("button", { name: "也看看完成与失败的" }),
    );
    expect(screen.getByTestId("track-old")).toBeInTheDocument();
    unmount();
    installIpc({ story_log: () => ({ tracks: [] }) });
    render(<QuestsPanel />);
    await user.click(
      within(await screen.findByTestId("empty-state")).getByRole("button", {
        name: "去见见人",
      }),
    );
    expect(useGame.getState().tab).toBe("people");
  });

  const pc = (
    o: Partial<PersonCard> & Pick<PersonCard, "key" | "name">,
  ): PersonCard => ({
    portrait: null,
    age: 30,
    kind: "story",
    role: "",
    where: null,
    affinity: 20,
    heart: null,
    heart_stage: null,
    bond: null,
    relation: [],
    call_name: "船长",
    can_recruit: false,
    requests: 0,
    ...o,
  });
  const aishling = pc({ key: "aishling", name: "艾希林" });
  const detail = (chat: PersonDetail["chat"]): PersonDetail => ({
    ...aishling,
    here: true,
    bio_pages: [],
    likes_known: [],
    dislikes_known: [],
    birthday: null,
    days_to_birthday: null,
    memories: [],
    topics: [],
    gifts: [],
    chat,
  });

  it("关系图：有图例与提示；人物的圆点可以用键盘打开详情", async () => {
    setUiFor("v2");
    const rel: RelationshipsView = {
      nodes: [
        { key: "mio", name: "一条澪", portrait: null, kind: "protagonist" },
        { key: "aishling", name: "艾希林", portrait: null, kind: "person" },
      ],
      edges: [{ a: "mio", b: "aishling", kind: "friends", label: "朋友" }],
    };
    const calls = installIpc({
      persons: () => ({ persons: [aishling] }),
      relationships: () => rel,
      person: () => detail(null),
    });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await screen.findByTestId("person-aishling");
    await user.click(screen.getByRole("tab", { name: "关系图" }));
    // v2 的图是 group（role="img" 的子元素对读屏是装饰，人物按钮会被吞掉）；按钮在图里
    const graph = await screen.findByRole("group", { name: "人物之间的关系" });
    expect(graph.tagName.toLowerCase()).toBe("svg");
    expect(
      within(graph).getByRole("button", { name: "艾希林" }),
    ).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "线的颜色" });
    expect(legend).toHaveTextContent("恋人 · 在意的人");
    expect(
      screen.getByText("点一个名字，看这个人的详情。"),
    ).toBeInTheDocument();
    const node = screen.getByRole("button", { name: "艾希林" });
    expect(node).toHaveAttribute("tabindex", "0");
    node.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("person", { key: "aishling" }),
    );
  });

  it("关系图里一个人都没有：空状态", async () => {
    setUiFor("v2");
    installIpc({
      persons: () => ({ persons: [aishling] }),
      relationships: () => ({
        nodes: [
          { key: "mio", name: "一条澪", portrait: null, kind: "protagonist" },
        ],
        edges: [],
      }),
    });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await screen.findByTestId("person-aishling");
    await user.click(screen.getByRole("tab", { name: "关系图" }));
    expect(await screen.findByTestId("empty-state")).toHaveTextContent(
      "还没有认识的人。",
    );
  });

  it("自由对话做不了：原因就地写出来并与输入框关联（不只在占位字里）", async () => {
    setUiFor("v2");
    installIpc({
      persons: () => ({ persons: [aishling] }),
      person: () =>
        detail({
          enabled: false,
          blocked_reason: "她在忙着装货",
          left_today: 0,
        }),
    });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    const box = within(d).getByRole("textbox", { name: "自由对话" });
    expect(box).toBeDisabled();
    const note = within(d).getByTestId("inline-error");
    expect(note).toHaveTextContent("她在忙着装货");
    expect(box).toHaveAttribute("aria-describedby", note.id);
    // 原因只写在就地的说明里：占位字照旧是“想对谁说什么”
    expect(box).toHaveAttribute(
      "placeholder",
      "想对 艾希林 说什么？（200 字以内）",
    );
  });

  it("v1 维持原样：聊不了的原因在占位字里，没有就地的说明", async () => {
    installIpc({
      persons: () => ({ persons: [aishling] }),
      person: () =>
        detail({
          enabled: false,
          blocked_reason: "她在忙着装货",
          left_today: 0,
        }),
    });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await user.click(await screen.findByTestId("person-aishling"));
    const d = await screen.findByTestId("person-detail");
    const box = within(d).getByRole("textbox", { name: "自由对话" });
    expect(box).toHaveAttribute("placeholder", "她在忙着装货");
    expect(box).not.toHaveAttribute("aria-describedby");
    expect(within(d).queryByTestId("inline-error")).toBeNull();
  });

  // 关系图：主角在圆心、三个人在圆周上；两条线
  const rel3: RelationshipsView = {
    nodes: [
      { key: "mio", name: "一条澪", portrait: null, kind: "protagonist" },
      { key: "aishling", name: "艾希林", portrait: null, kind: "person" },
      { key: "rosella", name: "罗塞拉", portrait: null, kind: "person" },
      { key: "jan", name: "扬", portrait: null, kind: "person" },
    ],
    edges: [
      { a: "mio", b: "aishling", kind: "friends", label: "朋友" },
      { a: "aishling", b: "rosella", kind: "lovers", label: "恋人" },
    ],
  };
  // v1 的图照旧是 img；v2 是 group（见上面第一条关系图的测试）
  const openGraph = async (role: "img" | "group" = "img") => {
    const calls = installIpc({
      persons: () => ({ persons: [aishling] }),
      relationships: () => rel3,
      person: () => detail(null),
    });
    const user = userEvent.setup();
    render(<PeoplePanel />);
    await screen.findByTestId("person-aishling");
    await user.click(screen.getByRole("tab", { name: "关系图" }));
    return {
      svg: await screen.findByRole(role, { name: "人物之间的关系" }),
      calls,
      user,
    };
  };

  it("关系图（v2）：人物圆点外有透明的点击区，点它打开详情；字号写在 text 上（量不到缩放时按桌面 12 / 13）", async () => {
    setUiFor("v2");
    const { svg, calls, user } = await openGraph("group");
    const hits = svg.querySelectorAll(".pp-node-hit");
    // 三个人物各一圈，主角没有
    expect(hits).toHaveLength(3);
    for (const h of hits)
      expect(Number(h.getAttribute("r"))).toBeGreaterThan(16);
    expect(svg.querySelector(".pp-node--protagonist .pp-node-hit")).toBeNull();
    const edgeText = svg.querySelector(".pp-edge text") as SVGTextElement;
    expect(edgeText.style.fontSize).toBe("12px");
    const nodeText = svg.querySelector(
      ".pp-node--person text",
    ) as SVGTextElement;
    expect(nodeText.style.fontSize).toBe("13px");
    // 点圆点外的点击区（不是圆点本身）也打开这个人的详情
    await user.click(
      svg.querySelector(".pp-node--person .pp-node-hit") as Element,
    );
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("person", { key: "aishling" }),
    );
  });

  it("关系图 v1 维持原样：没有点击区、没有图例；线上的标签在中点上方 4、名字在圆点下 30 / 38，text 上没有 style", async () => {
    const { svg } = await openGraph();
    expect(svg.querySelector(".pp-node-hit")).toBeNull();
    expect(screen.queryByRole("list", { name: "线的颜色" })).toBeNull();
    for (const g of svg.querySelectorAll(".pp-edge")) {
      const line = g.querySelector("line") as SVGLineElement;
      const text = g.querySelector("text") as SVGTextElement;
      const mid = (a: string, b: string) =>
        (Number(line.getAttribute(a)) + Number(line.getAttribute(b))) / 2;
      expect(Number(text.getAttribute("x"))).toBeCloseTo(mid("x1", "x2"), 6);
      expect(Number(text.getAttribute("y"))).toBeCloseTo(
        mid("y1", "y2") - 4,
        6,
      );
      expect(text.getAttribute("style")).toBeNull();
    }
    for (const g of svg.querySelectorAll(".pp-node")) {
      const text = g.querySelector("text") as SVGTextElement;
      expect(text.getAttribute("x")).toBeNull();
      expect(text.getAttribute("y")).toBe(
        g.classList.contains("pp-node--protagonist") ? "38" : "30",
      );
      expect(text.getAttribute("style")).toBeNull();
      expect(g.getAttribute("tabindex")).toBeNull();
    }
    expect(v2Classes()).toEqual([]);
  });
});
