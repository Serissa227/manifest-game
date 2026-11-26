// 新界面第二阶段·航海（docs/UI-REDESIGN.md 第 8 节第 6 组）：只在 v2 下改的 DOM 与行为，以及 v1 维持原样。
// - 出航确认：做不了 / 有风险的原因就地写清（InlineError），粮水不够全程时“补给到建议量”就在那一条里（不再另有一个按钮），
//   无法到达时“起航”用 aria-describedby 指向原因；“起航”“重新选择”旁边是回车、Esc 的小键帽。
// - 地点列表：查找没有结果时给“清除查找”（EmptyState 的下一步）。
// - 航行状态：本次航程的进度条（已航行 / 已航行 + 预计还需），收起与展开时都在。
// - 手动航行：按钮上的“（Tab）”“（空格）”改成小键帽，底部的按键说明改成一组小键帽（KeyHints）；手机上仪表、“今天会停下”
//   与打开的小菜单在同一个纵向容器里（互不遮挡），读数不截断。
// - 出航确认里做不了的原因排在有风险的提醒前面；查找没有结果时空状态紧跟在查找框下面、不留空分组的标题。
// 模拟的 Tauri IPC；PixiJS 渲染器以桩代替（同 voyage.test.tsx、nav.test.tsx）。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import VoyageHud from "../components/VoyageHud";
import { resetChartUi } from "../components/chartUi";
import { resetNav } from "../hooks/useNavigation";
import { beginDeparture, useVoyage, useVoyageStore } from "../hooks/useVoyage";
import type { FleetView, LocView, NavView, Overview, StaticView } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { readFileSync } from "node:fs";
import { installIpc, overview, port, siteLoc, startedGame, statics } from "./fixtures";
import { PHONE, mockViewport, resetViewport } from "./viewport";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

// 航海这一组的新界面样式表（路径放在变量里：写成字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址）
const VOYAGE_CSS = "../styles/ui-v2/voyage.css";

/** 元素里小键帽上显示的字（读屏念的完整键名另在 .v2-sr 里）。 */
const keyCaps = (el: Element) => [...el.querySelectorAll("kbd > [aria-hidden='true']")].map((k) => k.textContent);

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

/** 外壳的最小替身（同 voyage.test.tsx）。 */
function Harness() {
  useVoyage();
  return (
    <>
      <MapView />
      <VoyageHud />
    </>
  );
}

const PREVIEW = { days: 5, path: [[1, 1], [2, 1], [2, 2]] as [number, number][], supplies: 6 };
const docked: FleetView = overview.fleets[0];

function withFleet(patch: Partial<FleetView>, extra: Partial<Overview> = {}): Overview {
  return { ...overview, ...extra, fleets: [{ ...docked, ...patch }] };
}

function setup(ipc: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls = installIpc({
    sail_preview: () => PREVIEW,
    port: (args) => ({ ...port, loc: args.loc as number, known: args.loc !== 1 }),
    ...ipc,
  });
  startedGame();
  useVoyageStore.setState({ picking: false, target: null, plan: null, known: {} });
  create.mockReset();
  create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
  return calls;
}

/** 出港 → 在地点列表里点柳湾 → 出航确认框。 */
async function openConfirm() {
  const user = userEvent.setup();
  render(<Harness />);
  act(() => beginDeparture());
  await user.click(screen.getByRole("button", { name: /柳湾/ }));
  const dialog = await screen.findByRole("dialog", { name: "扬帆出港" });
  return { user, dialog };
}

beforeEach(() => setUiFor("v1"));
afterEach(() => {
  cleanup();
  setUiFor("v1");
  resetNav();
  useVoyageStore.setState({ picking: false, target: null, plan: null });
});

describe("出航确认（新界面）", () => {
  it("粮水不够全程：就地写明原因，“补给到建议量”就在这一条里（按差量提交 Resupply），不再另有一个补给按钮", async () => {
    // 建议各 30、全程 30 天，现有粮 10、水 10（可支撑 10 天）：各补 20，约 60 金币
    const calls = setup({ sail_preview: () => ({ ...PREVIEW, days: 30, supplies: 30 }) });
    setUiFor("v2");
    const { user, dialog } = await openConfirm();
    // V01 起写清这趟几天、够几天、还差多少（旧后端没有缺口字段时按“天数 × 每天各需 − 库存”推算：30 − 10 = 各差 20）
    const reason = await within(dialog).findByText("这趟约 30 天，粮水只够 10 天，还差粮 20、水 20。");
    const note = reason.closest("[data-testid='inline-error']") as HTMLElement;
    expect(note).not.toBeNull();
    // 是风险、不是失败：安静的提醒（不打断读屏），照样可以起航，“起航”的 aria-describedby 指向它，焦点在“起航”上
    expect(note).not.toHaveAttribute("role");
    expect(note).toHaveClass("is-blocked", "v2-voyage-risk");
    const sail = within(dialog).getByRole("button", { name: /^起航/ });
    expect(sail).toBeEnabled();
    expect(note.id).not.toBe("");
    expect(sail).toHaveAttribute("aria-describedby", note.id);
    await waitFor(() => expect(sail).toHaveFocus());
    expect(within(dialog).queryByTestId("departure-resupply")).toBeNull();
    await user.click(within(note).getByRole("button", { name: "补给到建议量（约 60 金币）" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Resupply: { owner: "player", fleet: 0, food: 20, water: 20 } } }),
    );
  });

  it("粮水够全程、只是低于建议量：补给按钮照旧单独一行（没有警告）", async () => {
    setup({ sail_preview: () => ({ ...PREVIEW, supplies: 30 }) });
    setUiFor("v2");
    const { dialog } = await openConfirm();
    expect(await within(dialog).findByTestId("departure-resupply")).toHaveTextContent("补给到建议量（约 60 金币）");
    expect(within(dialog).queryByTestId("inline-error")).toBeNull();
  });

  it("无法到达：原因写在“起航”旁（aria-describedby 指过去）并说怎么办；“起航”“重新选择”带回车、Esc 的小键帽", async () => {
    setup({ sail_preview: () => null });
    setUiFor("v2");
    const { dialog } = await openConfirm();
    const reason = await within(dialog).findByText("无法到达该港口。");
    const note = reason.closest("[data-testid='inline-error']") as HTMLElement;
    expect(note).toHaveClass("is-blocked");
    expect(note).not.toHaveAttribute("role");
    expect(note).toHaveTextContent("点“重新选择”换一个目的地。");
    const sail = within(dialog).getByRole("button", { name: /^起航/ });
    expect(sail).toBeDisabled();
    expect(note.id).not.toBe("");
    expect(sail).toHaveAttribute("aria-describedby", note.id);
    expect(keyCaps(sail)).toEqual(["回车"]);
    const repick = within(dialog).getByRole("button", { name: /^重新选择/ });
    expect(keyCaps(repick)).toEqual(["Esc"]);
    // 下一步是“重新选择”：它当主按钮（手机上整宽贴底），焦点也在它上面
    expect(dialog.querySelector(".chart-dialog-actions")).toHaveClass("v2-voyage-noroute");
    expect(repick).toHaveClass("v2-voyage-repick");
    await waitFor(() => expect(repick).toHaveFocus());
  });

  it("船员不足：原因就地写明，一键补到最低人数的按钮紧跟在下面；内核会拒绝，所以“起航”不可用、指向原因，焦点给“重新选择”", async () => {
    setup();
    useGame.setState({ overview: withFleet({ crew: 5 }) });
    setUiFor("v2");
    const { dialog } = await openConfirm();
    const block = await within(dialog).findByTestId("departure-crew-short");
    const note = within(block).getByTestId("inline-error");
    expect(note).toHaveTextContent("船员不足：至少要 8 人，现在只有 5 人，开不了船。");
    expect(note).not.toHaveAttribute("role");
    expect(within(block).getByTestId("departure-crew-hire")).toBeInTheDocument();
    await within(dialog).findByTestId("departure-days");
    const sail = within(dialog).getByRole("button", { name: /^起航/ });
    expect(sail).toBeDisabled();
    expect(note.id).not.toBe("");
    expect(sail).toHaveAttribute("aria-describedby", note.id);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /^重新选择/ })).toHaveFocus());
  });

  it("船员不足又粮水不够全程：做不了的原因（船员不足）排在有风险的提醒（粮水）前面——矮屏上先看到“起航”为什么不能点；旧界面照旧粮水在前", async () => {
    setup({ sail_preview: () => ({ ...PREVIEW, days: 30, supplies: 30 }) });
    useGame.setState({ overview: withFleet({ crew: 5 }) });
    setUiFor("v2");
    const { dialog } = await openConfirm();
    const risk = (await within(dialog).findByText("这趟约 30 天，粮水只够 10 天，还差粮 20、水 20。")).closest("[data-testid='inline-error']") as HTMLElement;
    const crew = within(dialog).getByTestId("departure-crew-short");
    expect(crew.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // “起航”指向的原因也是做不了的在前
    const sail = within(dialog).getByRole("button", { name: /^起航/ });
    expect(sail.getAttribute("aria-describedby")?.split(" ")).toEqual([within(crew).getByTestId("inline-error").id, risk.id]);

    cleanup();
    useVoyageStore.setState({ picking: false, target: null, plan: null });
    setUiFor("v1");
    const v1 = await openConfirm();
    const shortLine = await within(v1.dialog).findByText("粮水不足以支撑全程，途中可能断粮。");
    const crewV1 = within(v1.dialog).getByTestId("departure-crew-short");
    expect(shortLine.compareDocumentPosition(crewV1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(v2Classes()).toEqual([]);
  });

  it("旧界面：船员不足时“起航”照旧可以点（由内核拒绝），没有 aria-describedby", async () => {
    setup();
    useGame.setState({ overview: withFleet({ crew: 5 }) });
    const { dialog } = await openConfirm();
    await within(dialog).findByTestId("departure-days");
    const sail = within(dialog).getByRole("button", { name: "起航" });
    expect(sail).toBeEnabled();
    expect(sail).not.toHaveAttribute("aria-describedby");
    expect(dialog.querySelector(".chart-dialog-actions")?.className).toBe("chart-dialog-actions");
    expect(v2Classes()).toEqual([]);
  });

  it("旧界面维持原样：原因是原来的 <p class=chart-warn>，补给按钮单独一行，没有小键帽、没有 aria-describedby、没有 v2 的类", async () => {
    setup({ sail_preview: () => ({ ...PREVIEW, days: 30, supplies: 30 }) });
    const { dialog } = await openConfirm();
    const reason = await within(dialog).findByText("粮水不足以支撑全程，途中可能断粮。");
    expect(reason.tagName).toBe("P");
    expect(reason).toHaveClass("chart-warn");
    expect(within(dialog).getByTestId("departure-resupply")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("inline-error")).toBeNull();
    const sail = within(dialog).getByRole("button", { name: "起航" });
    expect(sail).not.toHaveAttribute("aria-describedby");
    expect(dialog.querySelector("kbd")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("选目的地时的地点列表（新界面）", () => {
  it("旗舰队所在的港口不算“能去”（点了只提示“已在此港”）；别的港口能去，内陆城市不能；旧界面照旧所有港口都带 pickable", async () => {
    setup();
    setUiFor("v2");
    render(<Harness />);
    act(() => beginDeparture());
    const here = screen.getByRole("button", { name: /澄港/ });
    expect(here).not.toHaveClass("pickable");
    expect(screen.getByRole("button", { name: /柳湾/ })).toHaveClass("pickable");
    expect(screen.getByRole("button", { name: /兰城/ })).not.toHaveClass("pickable");
    await userEvent.setup().click(here);
    expect(useVoyageStore.getState().target).toBeNull();
    expect(useGame.getState().message).toContain("澄港");

    cleanup();
    setUiFor("v1");
    render(<Harness />);
    act(() => beginDeparture());
    expect(screen.getByRole("button", { name: /澄港/ })).toHaveClass("pickable");
    expect(screen.getByRole("button", { name: /柳湾/ })).toHaveClass("pickable");
  });
});

describe("地点列表的查找（新界面）", () => {
  /** 多于 12 个地点：列表顶上才有查找框。 */
  const extra: LocView[] = Array.from({ length: 10 }, (_, i) => ({
    id: 3 + i,
    key: `extra${i}`,
    name: `外港${i}`,
    kind: "port",
    x: i % 4,
    y: i % 3,
    faction: 0,
    shipyard: false,
    founded: null,
    lore: "",
    site: null,
  }));
  const many: StaticView = { ...statics, locations: [...statics.locations, ...extra] };

  function renderMany() {
    setup({ static_data: () => many });
    useGame.setState({ statics: many });
    create.mockReturnValue(new Promise(() => {}));
    render(<MapView />);
  }

  /** 新界面里地点列表缺省收起（11-10：界面占屏太多、海图看得小）：先点标题展开。 */
  async function openPlaces(user: ReturnType<typeof userEvent.setup>) {
    const toggle = screen.getByRole("button", { name: "收起或展开地点列表" });
    if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  }

  beforeEach(() => resetChartUi());

  it("新界面：靠港时地点与图例缺省收起，只剩两枚标题签，点标题展开并记着；选目的地时地点列表自动展开；旧界面照旧展开", async () => {
    setUiFor("v2");
    renderMany();
    const user = userEvent.setup();
    const places = screen.getByRole("button", { name: "收起或展开地点列表" });
    const legend = screen.getByRole("button", { name: "收起或展开图例" });
    expect(places).toHaveAttribute("aria-expanded", "false");
    expect(legend).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("searchbox", { name: "查找地点" })).toBeNull();
    expect(screen.queryByRole("button", { name: /澄港/ })).toBeNull();
    expect(document.querySelectorAll(".chart-side > .chart-win.collapsed")).toHaveLength(2);
    // 点标题展开；重新挂上（切换舞台回来）还是展开的
    await user.click(places);
    expect(places).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("searchbox", { name: "查找地点" })).toBeInTheDocument();
    cleanup();
    render(<MapView />);
    expect(screen.getByRole("button", { name: "收起或展开地点列表" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "收起或展开图例" })).toHaveAttribute("aria-expanded", "false");

    // 没动过的时候：选目的地（出港）时地点列表自动展开，图例照旧收着
    cleanup();
    resetChartUi();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "收起或展开地点列表" })).toHaveAttribute("aria-expanded", "false");
    act(() => beginDeparture());
    expect(screen.getByRole("button", { name: "收起或展开地点列表" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "收起或展开图例" })).toHaveAttribute("aria-expanded", "false");
    act(() => useVoyageStore.setState({ picking: false, target: null, plan: null }));

    // 旧界面：靠港时两个小窗照旧展开
    cleanup();
    resetChartUi();
    setUiFor("v1");
    render(<MapView />);
    expect(screen.getByRole("button", { name: "收起或展开地点列表" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "收起或展开图例" })).toHaveAttribute("aria-expanded", "true");
  });

  it("没有名字相符的地点：空状态给“清除查找”，点一下清空查找、地点回来", async () => {
    setUiFor("v2");
    renderMany();
    const user = userEvent.setup();
    await openPlaces(user);
    const box = screen.getByRole("searchbox", { name: "查找地点" });
    await user.type(box, "不存在的地方");
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("没有名字相符的地点。");
    expect(screen.queryByRole("button", { name: /澄港/ })).toBeNull();
    await user.click(within(empty).getByRole("button", { name: "清除查找" }));
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: /澄港/ })).toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("没有结果时空状态紧跟在查找框下面，下面不留“未开拓之地”的标题；只是殖民点一个都不相符时也不留它的标题；旧界面照旧", async () => {
    const withSite: StaticView = { ...many, locations: [...many.locations, { ...siteLoc, id: many.locations.length }] };
    setup({ static_data: () => withSite });
    useGame.setState({ statics: withSite });
    create.mockReturnValue(new Promise(() => {}));
    setUiFor("v2");
    render(<MapView />);
    const user = userEvent.setup();
    await openPlaces(user);
    const sitesTitle = () => screen.queryByRole("heading", { name: "未开拓之地" });
    expect(sitesTitle()).toBeInTheDocument();
    const box = screen.getByRole("searchbox", { name: "查找地点" });
    await user.type(box, "不存在的地方");
    const empty = screen.getByTestId("empty-state");
    expect(box.closest(".chart-filter")?.nextElementSibling).toBe(empty);
    expect(sitesTitle()).toBeNull();
    // 港口相符、殖民点一个都不相符：不留殖民点的标题
    await user.clear(box);
    await user.type(box, "澄");
    expect(screen.getByRole("button", { name: /澄港/ })).toBeInTheDocument();
    expect(sitesTitle()).toBeNull();
    await user.clear(box);
    await user.type(box, "银雾");
    expect(sitesTitle()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /银雾河口/ })).toBeInTheDocument();

    cleanup();
    setUiFor("v1");
    render(<MapView />);
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "查找地点" }), "不存在的地方");
    // 旧界面：殖民点的标题照旧在，那一行字照旧在它后面
    const title = screen.getByRole("heading", { name: "未开拓之地" });
    expect(title.compareDocumentPosition(screen.getByText("没有名字相符的地点。")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(v2Classes()).toEqual([]);
  });

  it("旧界面：照旧一行字，没有按钮", async () => {
    renderMany();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "查找地点" }), "不存在的地方");
    const line = screen.getByText("没有名字相符的地点。");
    expect(line.tagName).toBe("P");
    expect(line).toHaveClass("chart-note", "chart-filter-empty");
    expect(screen.queryByRole("button", { name: "清除查找" })).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("航行状态的航程进度（新界面）", () => {
  it("知道还需几天时：进度 = 已航行 / (已航行 + 还需)，展开与收起时都在；旧界面没有", async () => {
    setup();
    setUiFor("v2");
    const user = userEvent.setup();
    render(<Harness />);
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1, days_at_sea: 1 }, { day: 13 })));
    const hud = await screen.findByTestId("voyage-hud");
    // 已航行 1 天、还需 5 天：1 / 6 ≈ 17%
    const bar = await within(hud).findByRole("progressbar", { name: "航程进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "17");
    expect(bar).toHaveAttribute("aria-valuetext", "已航行 1 天，预计还需 5 天");
    // 收起成一行时也在
    await user.click(within(hud).getByRole("button", { name: "收起或展开航行状态" }));
    expect(within(hud).getByTestId("voyage-summary")).toBeInTheDocument();
    expect(within(hud).getAllByRole("progressbar")).toHaveLength(1);

    cleanup();
    setUiFor("v1");
    render(<Harness />);
    const old = await screen.findByTestId("voyage-hud");
    // 航行状态的展开与否在模块里记着（上面收起了）：收起的一行里照样有“还需 5 天”
    await waitFor(() => expect(within(old).getByTestId("voyage-summary")).toHaveTextContent("5 天"));
    expect(within(old).queryByRole("progressbar")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });
});

describe("手动航行的按钮与按键说明（新界面）", () => {
  const manual: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };
  const atSea: Overview = {
    ...overview,
    fleets: [{ ...overview.fleets[0], docked: null, x: 1, y: 1, pos: { x: 1.5, y: 1.25 }, heading: 292 }],
    sighted: [0],
  };
  const NAV: NavView = {
    fleet: 0,
    mode: "manual",
    day: 12,
    minute: 0,
    pos: { x: 1.5, y: 1.25 },
    heading: 292,
    sail: "half",
    speed: 5.26,
    wind: { dir: 0, force: 4, name: "北风 4 级" },
    current: null,
    sail_limit: 67,
    trail: [],
    forecast: [],
    stops: [],
    supplies_days: 9,
    morale: 72,
    sight: 6,
    autopilot: null,
    known_dests: [{ loc: 0, name: "澄港", days: 2 }],
    lat_lon: null,
  };

  function navSetup(nav: NavView = NAV) {
    installIpc({ navigation: () => nav, preview_course: () => ({ points: [], stops: [] }) });
    startedGame();
    useGame.setState({ statics: manual, overview: atSea, stage: "chart" });
    resetNav();
    create.mockReset();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
  }

  it("“世界图”“继续”的快捷键是小键帽；底部的按键说明是一组小键帽；世界图上“回到航行”同样", async () => {
    navSetup();
    setUiFor("v2");
    const user = userEvent.setup();
    render(<MapView />);
    const world = await screen.findByTestId("nav-world");
    expect(world.firstChild?.textContent).toBe("世界图");
    expect(keyCaps(world)).toEqual(["Tab"]);
    const pause = screen.getByTestId("nav-pause");
    // 游戏暂停着：写“继续”，键帽是空格
    expect(pause.firstChild?.textContent).toBe("继续");
    expect(keyCaps(pause)).toEqual(["空格"]);
    const hints = screen.getByRole("list", { name: "快捷键" });
    expect(hints).toHaveClass("nav-keys");
    expect(within(hints).getAllByRole("listitem").map((li) => `${keyCaps(li).join("+")} ${li.querySelector(".v2-keys-label")?.textContent}`)).toEqual([
      "A+D 转舵",
      "W+S 升降帆",
      "空格 暂停 / 继续",
      "Tab 世界图",
    ]);
    await user.click(world);
    const back = await screen.findByTestId("nav-back");
    expect(keyCaps(back)).toEqual(["Tab"]);
    expect(back.firstChild?.textContent).toBe("回到航行");
  });

  it("旧界面：按钮上照旧写“（Tab）”“（空格）”，按键说明是原来的一行字", async () => {
    navSetup();
    render(<MapView />);
    expect(await screen.findByTestId("nav-world")).toHaveTextContent("世界图（Tab）");
    expect(screen.getByTestId("nav-pause")).toHaveTextContent("继续（空格）");
    const keys = screen.getByText("A/D 转舵 · W/S 帆 · 空格暂停 · Tab 世界图");
    expect(keys.tagName).toBe("P");
    expect(keys).toHaveClass("nav-keys");
    expect(document.querySelector("kbd")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it("手机上：仪表、“今天会停下”与打开的小菜单在同一个纵向容器里（停靠小卡紧跟在仪表后面，小菜单在最后），打开它的按钮 aria-controls 指向它；旧界面照旧", async () => {
    mockViewport(PHONE);
    try {
      navSetup({ ...NAV, stops: [{ minute: 780, kind: "sight", loc: 0, text: "望见澄港" }] });
      setUiFor("v2");
      const user = userEvent.setup();
      render(<MapView />);
      const hud = await screen.findByTestId("nav-hud");
      const stack = hud.closest(".v2-nav-stack") as HTMLElement;
      expect(stack).not.toBeNull();
      const stops = screen.getByTestId("nav-stops");
      expect(stack).toContainElement(stops);
      expect(hud.compareDocumentPosition(stops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const open = screen.getByTestId("nav-autopilot-open");
      expect(open).not.toHaveAttribute("aria-controls");
      await user.click(open);
      const menu = screen.getByTestId("nav-autopilot-menu");
      expect(stack.lastElementChild).toBe(menu);
      expect(within(screen.getByTestId("nav-actions")).queryByTestId("nav-autopilot-menu")).toBeNull();
      expect(menu.id).not.toBe("");
      expect(open).toHaveAttribute("aria-controls", menu.id);
      await user.click(screen.getByTestId("nav-landing-open"));
      expect(screen.getByTestId("nav-landing-open")).toHaveAttribute("aria-controls", screen.getByTestId("nav-landing-menu").id);
      expect(open).not.toHaveAttribute("aria-controls");

      cleanup();
      setUiFor("v1");
      render(<MapView />);
      await screen.findByTestId("nav-hud");
      expect(document.querySelector(".v2-nav-stack")).toBeNull();
      await user.click(screen.getByTestId("nav-autopilot-open"));
      const v1Menu = screen.getByTestId("nav-autopilot-menu");
      expect(screen.getByTestId("nav-actions")).toContainElement(v1Menu);
      expect(v1Menu).not.toHaveAttribute("id");
      expect(screen.getByTestId("nav-autopilot-open")).not.toHaveAttribute("aria-controls");
      expect(v2Classes()).toEqual([]);
    } finally {
      resetViewport();
    }
  });

  it("手机上仪表的读数不截断：样式表里仪表的读数没有省略号，手机上的读数可以折行", () => {
    const css = readFileSync(new URL(VOYAGE_CSS, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const hudRules = rules.filter((r) => r.selector.includes(".nav-hud"));
    expect(hudRules.length).toBeGreaterThan(0);
    for (const r of hudRules) expect(r.body, r.selector).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    const wrap = rules.find((r) => r.selector.includes(".v2-nav-stack .nav-hud-item dd"));
    expect(wrap?.body).toMatch(/white-space:\s*normal/);
  });
});
