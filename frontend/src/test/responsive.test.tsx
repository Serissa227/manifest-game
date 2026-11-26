// 网页自适应（决定见 docs/DECISIONS.md“网页自适应”）：
// 视口判断（useViewport）、手机与平板上的紧凑外壳（顶栏收成一行、菜单、倍速、底部导航与“更多”、整页的功能窗口）、
// 抽屉、新手教程在窄屏上的说明框与入口、命令栏放不下时收进“更多”、紧凑数字、海图镜头与街景拖动的计算。
// 视口用 test/viewport.ts 模拟（jsdom 没有 matchMedia，原有的测试一律按桌面）。
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import CommandBar from "../components/CommandBar";
import FleetHoverCard from "../components/FleetHoverCard";
import Sheet from "../components/shell/Sheet";
import { primaryTabs, useShell } from "../components/shell/shellState";
import { STEPS } from "../components/tutorial/steps";
import { useTutorial } from "../components/tutorial/tutorialState";
import { layoutOf, readViewport, useViewport, type Layout } from "../hooks/useViewport";
import { edgesOf, resetPan } from "../hooks/usePanArea";
import { setLocale } from "../i18n";
import { shortNum } from "../i18n/short";
import { nearestLevel, pinchOf, pinchScale, snapScale, stepScale, zoomAt } from "../map/camera";
import type { Overview } from "../ipc/types";
import { useGame, type Tab } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";
import { LAPTOP, PHONE, PHONE_LANDSCAPE, TABLET, mockViewport, queryMatches, resetViewport, type FakeViewport } from "./viewport";

afterEach(() => {
  resetViewport();
  setLocale("zh-CN");
});

/** 读样式表原文（测试环境不处理 CSS，?raw 也拿不到，直接读文件）。 */
const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const compactCss = readText("../styles/compact.css");
const viewportCss = readText("../styles/viewport.css");

describe("视口判断（hooks/useViewport.ts）", () => {
  it("没有 matchMedia 的环境（jsdom）一律按桌面、鼠标：原有的测试不受影响", () => {
    const { result } = renderHook(() => useViewport());
    expect(result.current).toEqual({ layout: "desktop", coarse: false, wide: false, narrow: false });
  });

  it("按宽高分四种布局（矮窗口优先于窄窗口），另有触屏与大屏两个判断", () => {
    const cases: [FakeViewport, Layout][] = [
      [{ width: 360, height: 640 }, "phone"],
      [{ width: 390, height: 844 }, "phone"],
      [{ width: 719, height: 900 }, "phone"],
      [{ width: 844, height: 390 }, "short"],
      [{ width: 640, height: 360 }, "short"],
      [{ width: 1400, height: 480 }, "short"],
      [{ width: 720, height: 900 }, "tablet"],
      [{ width: 768, height: 1024 }, "tablet"],
      [{ width: 1024, height: 768 }, "tablet"],
      [{ width: 1179, height: 800 }, "tablet"],
      [{ width: 1180, height: 800 }, "desktop"],
      [{ width: 1280, height: 720 }, "desktop"],
      [{ width: 1366, height: 768 }, "desktop"],
      [{ width: 1920, height: 1080 }, "desktop"],
      [{ width: 2560, height: 1440 }, "desktop"],
    ];
    for (const [v, layout] of cases) {
      mockViewport(v);
      expect(readViewport().layout, `${v.width}×${v.height}`).toBe(layout);
    }
    mockViewport({ width: 2560, height: 1440 });
    expect(readViewport().wide).toBe(true);
    mockViewport({ width: 1920, height: 999 });
    expect(readViewport().wide).toBe(false);
    mockViewport(PHONE);
    expect(readViewport().coarse).toBe(true);
    mockViewport(LAPTOP);
    expect(readViewport().coarse).toBe(false);
    // 纯函数：矮窗口优先
    expect(layoutOf({ short: true, phone: true, tablet: true })).toBe("short");
    expect(layoutOf({ short: false, phone: true, tablet: true })).toBe("phone");
    expect(layoutOf({ short: false, phone: false, tablet: true })).toBe("tablet");
    expect(layoutOf({ short: false, phone: false, tablet: false })).toBe("desktop");
  });

  it("窗口大小变了用到它的组件跟着重排；内容没变时返回同一个对象", async () => {
    mockViewport(LAPTOP);
    const { result } = renderHook(() => useViewport());
    const first = result.current;
    expect(first.layout).toBe("desktop");
    expect(readViewport()).toBe(first);
    mockViewport(PHONE);
    await waitFor(() => expect(result.current.layout).toBe("phone"));
    expect(result.current.coarse).toBe(true);
    mockViewport(PHONE_LANDSCAPE);
    await waitFor(() => expect(result.current.layout).toBe("short"));
  });

  it("测试用的媒体查询模拟认得宽高、and、逗号与指针类型", () => {
    expect(queryMatches("(max-width: 719px)", PHONE)).toBe(true);
    expect(queryMatches("(min-width: 1800px) and (min-height: 1000px)", { width: 1920, height: 1080 })).toBe(true);
    expect(queryMatches("(min-width: 1800px) and (min-height: 1000px)", { width: 1920, height: 900 })).toBe(false);
    expect(queryMatches("(max-width: 719px), (max-height: 499px)", PHONE_LANDSCAPE)).toBe(true);
    expect(queryMatches("(pointer: coarse)", TABLET)).toBe(true);
    expect(queryMatches("(pointer: coarse)", LAPTOP)).toBe(false);
  });
});

describe("样式表与布局的约定", () => {
  it("断点与 useViewport 一致；手机上功能窗口铺满舞台（整页），竖放的平板上靠右的窗口铺满", () => {
    for (const q of ["(max-height: 499px)", "(max-width: 719px)", "(max-width: 1179px)", "(min-width: 1800px) and (min-height: 1000px)"]) {
      expect(compactCss + viewportCss, q).toContain(q);
    }
    // 手机（竖屏与横屏）的整页窗口
    expect(compactCss).toMatch(/\.app\.game\[data-layout="phone"\] \.gw,\s*\.app\.game\[data-layout="short"\] \.gw \{[^}]*inset: 0;/);
    // 竖放的平板：靠右与居中的窗口左右各留 8 px 铺满
    expect(compactCss).toMatch(/\.app\.game\[data-layout="tablet"\] \.gw-right,[^{]*\{[^}]*left: 8px;[^}]*right: 8px;/);
    // 横屏手机：导航竖在左侧
    expect(compactCss).toMatch(/grid-template-areas:\s*"hud hud"\s*"nav main";/);
    // 触屏：通用按钮至少 40 px，输入框字号不小于 16 px
    expect(viewportCss).toMatch(/@media \(pointer: coarse\) \{\s*@layer shell-theme \{\s*button,\s*\.btn \{\s*min-height: 40px;/);
    expect(viewportCss).toContain("font-size: max(16px, 1em);");
    // 刘海屏安全区与可见视口高度
    expect(viewportCss).toContain("env(safe-area-inset-top, 0px)");
    expect(viewportCss).toContain("--vh100: 100dvh;");
  });

  it("触屏：复选框、单选框连同文字的整行不矮于 40 px（写在触屏的低优先级层里，模块样式仍可覆盖）", () => {
    const start = viewportCss.indexOf("@media (pointer: coarse) {");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = viewportCss.indexOf("@media", start + 1);
    const coarse = viewportCss.slice(start, next < 0 ? undefined : next);
    expect(coarse).toContain("@layer shell-theme {");
    expect(coarse).toMatch(/label:has\(input\[type="checkbox"\]\),\s*label:has\(input\[type="radio"\]\) \{\s*min-height: 40px;\s*\}/);
    // 框本身放大到 22 px
    expect(coarse).toMatch(/input\[type="checkbox"\],\s*input\[type="radio"\] \{\s*width: 22px;\s*height: 22px;\s*\}/);
  });

  it("开局画面左下的语言、音乐：任何尺寸下一行放不下都整体折行，按钮里的字不竖排；触屏的平板上同样放大", () => {
    const firstMedia = viewportCss.indexOf("@media");
    const wrap = viewportCss.search(/\n\.title-controls \{\s*flex-wrap: wrap;\s*\}/);
    const nowrap = viewportCss.search(/\n\.title-controls > \* \{\s*white-space: nowrap;\s*min-height: 32px;\s*\}/);
    // 写在所有 @media 之前（不只手机）
    expect(wrap).toBeGreaterThan(0);
    expect(nowrap).toBeGreaterThan(0);
    expect(wrap).toBeLessThan(firstMedia);
    expect(nowrap).toBeLessThan(firstMedia);
    // 触屏（含平板）：只有图标的音乐开关至少 44 × 40
    const start = viewportCss.indexOf("@media (pointer: coarse) {");
    const coarse = viewportCss.slice(start, viewportCss.indexOf("@media", start + 1));
    expect(coarse).toMatch(/\.title-controls \.music-toggle \{\s*min-width: 44px;\s*min-height: 40px;\s*\}/);
  });

  it("页面不出现横向滚动条：html 横向裁掉（作用在视口上），body 与 .app 用 clip，不变成自己滚动的容器", () => {
    const firstMedia = viewportCss.indexOf("@media");
    const html = viewportCss.search(/\nhtml \{\s*overflow-x: hidden;\s*\}/);
    const clip = viewportCss.search(/\nbody,\s*\.app \{\s*overflow-x: clip;\s*\}/);
    expect(html).toBeGreaterThan(0);
    expect(clip).toBeGreaterThan(0);
    expect(html).toBeLessThan(firstMedia);
    expect(clip).toBeLessThan(firstMedia);
    // body 不写 overflow-x: hidden（写了就成了 body 自己上下滚动）
    expect(viewportCss).not.toMatch(/(^|\n)(html,\s*)?body\s*\{[^}]*overflow-x: hidden;/);
  });

  it("index.html 的 viewport 铺满刘海屏（viewport-fit=cover）", () => {
    const html = readText("../../index.html");
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
    expect(html).toContain('<meta name="theme-color"');
  });
});

describe("手机竖屏的游戏外壳", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    useTutorial.setState({ active: false, done: true });
    mockViewport(PHONE);
  });

  it("开局先看港口街景（整页的功能窗口不自动盖上去）；外壳标明手机布局", async () => {
    render(<App />);
    const hud = await screen.findByTestId("hud");
    expect(document.querySelector(".app.game")).toHaveAttribute("data-layout", "phone");
    expect(hud).toHaveAttribute("data-layout", "phone");
    expect(screen.getByTestId("stage-town")).toBeInTheDocument();
    expect(screen.queryByTestId("game-window")).toBeNull();
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("顶栏收成一行：头像、现金（下面一条目标细进度）、时刻与短日期、暂停与倍速、菜单；存读档与其余数字不在顶栏上", async () => {
    render(<App />);
    const hud = await screen.findByTestId("hud");
    expect(hud).toHaveClass("hud-compact");
    expect(within(hud).getByRole("button", { name: "查看船长卡" })).toBeInTheDocument();
    const cash = screen.getByTestId("cash");
    expect(cash).toHaveTextContent("12,345");
    expect(cash).toHaveAttribute("aria-label", "现金 12,345 金币");
    expect(within(hud).getByRole("progressbar", { name: "剧本目标进度" })).toHaveAttribute("aria-valuenow", "6");
    expect(screen.getByTestId("date")).toHaveTextContent("1月13日");
    expect(screen.getByTestId("date")).toHaveAttribute("aria-label", "1502年1月13日（春）");
    expect(screen.getByTestId("clock")).toHaveTextContent("08:00");
    // 收进菜单的东西
    expect(within(hud).queryByLabelText("存档名")).toBeNull();
    expect(within(hud).queryByRole("button", { name: "主菜单" })).toBeNull();
    expect(within(hud).queryByTestId("budget")).toBeNull();
    expect(within(hud).queryByTestId("goal")).toBeNull();
    expect(within(hud).getByRole("button", { name: "菜单" })).toHaveAttribute("aria-haspopup", "dialog");
    // 倍速只有两个键
    const speed = within(hud).getByRole("group", { name: "游戏速度" });
    expect(within(speed).getAllByRole("button")).toHaveLength(2);
    expect(within(speed).getByRole("button", { name: "暂停" })).toHaveAttribute("aria-pressed", "true");
  });

  // 11-03 起只有慢 / 普通 / 快三档（原来是 1× … 32× 六档），当前倍速键写档名
  it("倍速：点当前倍速弹出三档与“下一天”，选一档就收起；运行中点“暂停”停下，再点一下按上一次的倍速继续", async () => {
    let current: Overview = { ...overview, speed: 0 };
    const calls = installIpc({
      set_speed: (args) => {
        current = { ...current, speed: args.speed as number };
        return current;
      },
    });
    const user = userEvent.setup();
    render(<App />);
    const speed = await screen.findByRole("group", { name: "游戏速度" });
    const now = within(speed).getByRole("button", { name: "已暂停，点开选倍速" });
    expect(now).toHaveAttribute("aria-expanded", "false");
    await user.click(now);
    const menu = screen.getByTestId("speed-menu");
    for (const n of ["慢", "普通", "快", "下一天"]) expect(within(menu).getByRole("button", { name: n })).toBeInTheDocument();
    expect(within(menu).getAllByRole("button")).toHaveLength(4);
    await user.click(within(menu).getByRole("button", { name: "普通" }));
    expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 });
    await waitFor(() => expect(within(speed).getByRole("button", { name: "速度：普通，点开换挡" })).toBeInTheDocument());
    expect(screen.queryByTestId("speed-menu")).toBeNull();
    const pause = within(speed).getByRole("button", { name: "暂停" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    const speeds = () => calls.mock.calls.filter(([cmd]) => cmd === "set_speed").map(([, args]) => args.speed);
    await user.click(pause);
    expect(speeds()).toEqual([4, 0]);
    await waitFor(() => expect(pause).toHaveAttribute("aria-pressed", "true"));
    expect(pause).toHaveAttribute("title", "继续（普通）");
    await user.click(pause);
    expect(speeds()).toEqual([4, 0, 4]);
    // 下一天；点外面收起
    await user.click(within(speed).getByRole("button", { name: /速度：普通|已暂停/ }));
    await user.click(within(screen.getByTestId("speed-menu")).getByRole("button", { name: "下一天" }));
    expect(calls).toHaveBeenCalledWith("step", { days: 1 });
    await user.click(within(speed).getByRole("button", { name: /速度：普通|已暂停/ }));
    expect(screen.getByTestId("speed-menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("speed-menu")).toBeNull();
  });

  it("菜单：资产与目标（全部数字与目标全文）、时辰与天气、存档（槽位、存档、读档）、系统（主菜单、音乐）；Esc 收起，焦点回到菜单按钮", async () => {
    const calls = installIpc();
    const user = userEvent.setup();
    render(<App />);
    const button = await screen.findByRole("button", { name: "菜单" });
    await user.click(button);
    const sheet = screen.getByRole("dialog", { name: "船长的账簿" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    for (const text of ["现金", "12,345 金币", "净资产", "20,000 金币", "总资产", "21,000 金币", "本月 AI 预算", "3/60 次", "名声", "殖民地"]) {
      expect(sheet).toHaveTextContent(text);
    }
    expect(sheet).toHaveTextContent("目标：净资产 20,000 / 300,000 金币");
    expect(within(sheet).getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(within(sheet).getByLabelText("存档名")).toHaveValue("save1");
    await user.click(within(sheet).getByRole("button", { name: "存档" }));
    expect(calls).toHaveBeenCalledWith("save_game", { slot: "save1" });
    for (const name of ["读档", "主菜单", "音乐"]) expect(within(sheet).getByRole("button", { name })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "船长的账簿" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("菜单按钮在有待报告的发现时带小红点，菜单里的提示点了打开探险窗口", async () => {
    useGame.setState({ overview: { ...overview, discoveries_unreported: 2 } });
    const user = userEvent.setup();
    render(<App />);
    const button = await screen.findByRole("button", { name: "菜单" });
    expect(button).toHaveClass("has-alert");
    await user.click(button);
    await user.click(within(screen.getByRole("dialog", { name: "船长的账簿" })).getByRole("button", { name: /2 项发现待报告/ }));
    expect(screen.queryByRole("dialog", { name: "船长的账簿" })).toBeNull();
    expect(useGame.getState().tab).toBe("explore");
    expect(useShell.getState().windowOpen).toBe(true);
  });

  it("底部导航：舞台切换一个键、三个常用功能页与“更多”；“更多”里是其余功能页，点了打开整页的窗口，“更多”随之高亮", async () => {
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "命令栏" });
    expect(nav).toHaveAttribute("data-layout", "phone");
    const tabs = within(nav).getByRole("tablist", { name: "功能面板" });
    expect(within(tabs).getAllByRole("tab").map((b) => b.textContent)).toEqual(["港口", "舰队", "行情"]);
    expect(within(nav).getByRole("button", { name: "切换到航海图" })).toBeInTheDocument();
    const more = within(nav).getByRole("button", { name: "更多" });
    await user.click(more);
    const sheet = screen.getByRole("dialog", { name: "全部功能" });
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((n) => n !== "");
    expect(names).toEqual(expect.arrayContaining(["航海士", "期货", "商队", "产业", "报表", "情报", "设置"]));
    expect(names).not.toContain("港口");
    await user.click(within(sheet).getByRole("button", { name: "设置" }));
    expect(screen.queryByRole("dialog", { name: "全部功能" })).toBeNull();
    expect(useGame.getState().tab).toBe("settings");
    expect(screen.getByTestId("game-window")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "更多（当前：设置）" })).toHaveClass("active");
    // 常用功能页：点一下打开，再点一下收起
    await user.click(within(tabs).getByRole("tab", { name: "舰队" }));
    expect(useGame.getState().tab).toBe("fleet");
    expect(within(tabs).getByRole("tab", { name: "舰队" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(tabs).getByRole("tab", { name: "舰队" }));
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("舞台切换：一个键写着要切过去的舞台；切换时收起整页的窗口；在海上时港口街景不可用", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "港口" }));
    expect(useShell.getState().windowOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: "切换到航海图" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
    expect(screen.getByRole("button", { name: "切换到港口街景" })).toBeEnabled();
    act(() => useGame.setState({ overview: { ...overview, fleets: [{ ...overview.fleets[0], docked: null, dest: 1, days_at_sea: 2 }] } }));
    expect(screen.getByRole("button", { name: "切换到港口街景" })).toBeDisabled();
  });

  it("海上：航海图左上的航行状态缺省收起成一行（目的地 · 还需几天），“改变航向”照样在；点“+”展开", async () => {
    const atSea = { ...overview.fleets[0], docked: null, dest: 1, x: 2, y: 1, path: [[2, 1], [2, 2]] as [number, number][], days_at_sea: 1, food: 1, water: 1 };
    useGame.setState({ overview: { ...overview, fleets: [atSea] }, stage: "chart" });
    const user = userEvent.setup();
    render(<App />);
    const hud = await screen.findByTestId("voyage-hud");
    expect(hud).toHaveClass("collapsed");
    expect(within(hud).getByTestId("voyage-summary")).toHaveTextContent("柳湾");
    // 粮水只够 1 天：红标
    expect(within(hud).getByTestId("voyage-summary")).toHaveTextContent("粮水告急");
    expect(within(hud).queryByTestId("voyage-dest")).toBeNull();
    expect(within(hud).getByRole("button", { name: "改变航向" })).toBeInTheDocument();
    const toggle = within(hud).getByRole("button", { name: "收起或展开航行状态" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(within(hud).getByTestId("voyage-dest")).toHaveTextContent("柳湾");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("有进行中的战术海战时，底部导航的常用页是港口、海战、舰队", () => {
    expect(primaryTabs(["port", "battle", "fleet", "mates", "futures", "analysis", "settings"])).toEqual(["port", "battle", "fleet"]);
    expect(primaryTabs(["port", "fleet", "mates", "futures", "analysis", "settings"])).toEqual(["port", "fleet", "analysis"]);
    expect(primaryTabs(["port", "fleet", "mates"])).toEqual(["port", "fleet", "mates"]);
  });

  it("现金很多时顶栏短写（全额在读屏文字里）", async () => {
    useGame.setState({ overview: { ...overview, cash: 1234567 } });
    render(<App />);
    const cash = await screen.findByTestId("cash");
    expect(cash).toHaveTextContent("123万");
    expect(cash).toHaveAttribute("aria-label", "现金 1,234,567 金币");
  });
});

describe("手机横屏与平板", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    useTutorial.setState({ active: false, done: true });
  });

  it("手机横屏：导航竖在左侧（同样的几个键），顶栏是整排的倍速", async () => {
    mockViewport(PHONE_LANDSCAPE);
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "命令栏" });
    expect(document.querySelector(".app.game")).toHaveAttribute("data-layout", "short");
    expect(nav).toHaveAttribute("data-layout", "short");
    expect(within(nav).getByRole("button", { name: "更多" })).toBeInTheDocument();
    const speed = screen.getByRole("group", { name: "游戏速度" });
    for (const name of ["暂停", "慢", "普通", "快", "下一天"]) expect(within(speed).getByRole("button", { name })).toBeInTheDocument();
  });

  it("竖放的平板：顶栏一行（现金、日期、整排倍速、菜单），命令栏还是完整的两个舞台键与各功能页；功能窗口会盖满舞台，开局先收起", async () => {
    mockViewport(TABLET);
    render(<App />);
    const hud = await screen.findByTestId("hud");
    expect(hud).toHaveAttribute("data-layout", "tablet");
    expect(screen.getByTestId("cash")).toHaveTextContent("12,345 金币");
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(within(hud).getByRole("button", { name: "菜单" })).toBeInTheDocument();
    expect(within(hud).queryByLabelText("存档名")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "命令栏" });
    expect(within(nav).getByRole("button", { name: "港口街景" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "航海图" })).toBeInTheDocument();
    expect(within(nav).getByRole("tab", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByTestId("game-window")).toBeNull();
    expect(screen.getByTestId("stage-town")).toBeInTheDocument();
  });

  it("横放的平板（宽 ≥ 1000）：窗口靠右、旁边看得见街景，开局照常打开港口窗口", async () => {
    mockViewport({ width: 1024, height: 768, coarse: true });
    render(<App />);
    expect(await screen.findByTestId("game-window")).toBeInTheDocument();
    expect(document.querySelector(".app.game")).toHaveAttribute("data-layout", "tablet");
  });
});

describe("平板与桌面的命令栏：一行放不下的功能页收进“更多”", () => {
  const tabs: Tab[] = ["port", "fleet", "mates", "futures", "analysis", "caravan", "industry", "reports", "intel", "settings"];
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  /** 模拟按钮区只放得下前 n 个按钮：之后的都折到第二行（offsetTop 更大）。 */
  function fitOnly(n: number) {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        const all = [...(this.parentElement?.querySelectorAll("[data-tab]") ?? [])];
        const i = all.indexOf(this);
        return i >= n ? 60 : 0;
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {}
        observe() {
          this.cb();
        }
        disconnect() {}
        unobserve() {}
      },
    );
    restore = () => {
      if (desc) Object.defineProperty(HTMLElement.prototype, "offsetTop", desc);
      vi.unstubAllGlobals();
    };
  }

  it("排到第二行的按钮藏起来（不能聚焦、对读屏隐藏），出现“更多”；当前页在里面时“更多”高亮，点了打开它", async () => {
    installIpc();
    startedGame();
    fitOnly(6);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CommandBar tabs={tabs} active="intel" open onSelect={onSelect} />);
    const hidden = screen.getAllByRole("tab", { hidden: true }).filter((b) => b.classList.contains("is-overflow"));
    expect(hidden.map((b) => b.dataset.tab)).toEqual(["industry", "reports", "intel", "settings"]);
    for (const b of hidden) {
      expect(b).toHaveAttribute("tabindex", "-1");
      expect(b).toHaveAttribute("aria-hidden", "true");
    }
    const more = screen.getByRole("button", { name: "更多（当前：情报）" });
    expect(more).toHaveClass("active");
    await user.click(more);
    const sheet = screen.getByRole("dialog", { name: "全部功能" });
    expect(within(sheet).getAllByRole("button").map((b) => b.textContent).filter(Boolean)).toEqual(["产业", "报表", "情报", "设置"]);
    expect(within(sheet).getByRole("button", { name: "情报" })).toHaveAttribute("aria-current", "page");
    await user.click(within(sheet).getByRole("button", { name: "报表" }));
    expect(onSelect).toHaveBeenCalledWith("reports");
  });

  it("都放得下时没有“更多”（jsdom 没有 ResizeObserver 时也是这样）", () => {
    installIpc();
    startedGame();
    render(<CommandBar tabs={tabs} active="port" open onSelect={() => {}} />);
    expect(screen.queryByTestId("cmd-more")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(tabs.length);
  });
});

describe("抽屉（Sheet）", () => {
  it("挂在 body 上的模态面板：点遮罩、按 Esc 或“收起”关闭，关闭后焦点回到打开它的按钮", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            打开
          </button>
          {open && (
            <Sheet title="测试抽屉" onClose={() => setOpen(false)} testId="sheet">
              <p>内容</p>
            </Sheet>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "打开" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "测试抽屉" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(opener);
    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("新手教程在平板与手机上", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    useTutorial.setState({ active: false, done: true, step: 0 });
  });

  const step = (id: string) => STEPS.findIndex((s) => s.id === id);

  it("说明框不宽于屏幕（左右各留 12 px），换成紧凑顶栏的说法；目标收在菜单里时圈菜单按钮", async () => {
    mockViewport({ width: 360, height: 640, coarse: true });
    render(<App />);
    await screen.findByTestId("hud");
    act(() => useTutorial.setState({ active: true, step: step("cash") }));
    const bubble = within(screen.getByTestId("tutorial")).getByRole("dialog");
    expect(bubble.style.width).toBe(`${360 - 24}px`);
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("净资产与总资产在右上角的“菜单”里");
    act(() => useTutorial.setState({ step: step("save") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("存档、读档在右上角的“菜单”里");
    expect(STEPS[step("save")].target).toEqual([".saves", ".hud-menu-btn"]);
    expect(STEPS[step("goal")].target).toEqual([".hud-goal", ".hud-menu-btn"]);
  });

  it("“港口”一步在手机上收起整页的窗口，街景才看得见", async () => {
    mockViewport(PHONE);
    render(<App />);
    await screen.findByTestId("hud");
    act(() => useShell.setState({ windowOpen: true }));
    act(() => useTutorial.setState({ active: true, step: step("town") }));
    await waitFor(() => expect(useShell.getState().windowOpen).toBe(false));
    expect(useGame.getState().stage).toBe("town");
  });

  it("矮屏上目标在屏幕外（交易所的“买满”在窗口下面）：先把它滚进视野，说明框不越过屏幕下沿", async () => {
    mockViewport({ width: 844, height: 390, coarse: true });
    const scroll = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      render(<App />);
      await screen.findByTestId("hud");
      act(() => useTutorial.setState({ active: true, step: step("buy") }));
      const target = await screen.findByTestId("mk-buy");
      // 目标整个在屏幕下面
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ left: 80, top: 520, width: 700, height: 120, right: 780, bottom: 640, x: 80, y: 520, toJSON: () => ({}) } as DOMRect);
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" }), { timeout: 2500 });
      const bubble = within(screen.getByTestId("tutorial")).getByRole("dialog");
      await waitFor(() => expect(parseFloat(bubble.style.top)).toBeLessThanOrEqual(390 - 200 - 12));
      expect(parseFloat(bubble.style.top)).toBeGreaterThanOrEqual(12 + 60);
    } finally {
      if (original === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = original;
    }
  });

  it("桌面上说法与目标不变（原有的教程测试另有覆盖）", async () => {
    render(<App />);
    await screen.findByTestId("hud");
    act(() => useTutorial.setState({ active: true, step: step("cash") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这里是现金、净资产与总资产");
    const bubble = within(screen.getByTestId("tutorial")).getByRole("dialog");
    expect(bubble.style.width).toBe("360px");
  });
});

describe("紧凑数字（i18n/short.ts）", () => {
  it("十万以下照常加千分位；再大按语言紧凑记数（三位有效数字）", () => {
    expect(shortNum(12345)).toBe("12,345");
    expect(shortNum(99999.4)).toBe("99,999");
    expect(shortNum(123456)).toBe("12.3万");
    expect(shortNum(1234567)).toBe("123万");
    expect(shortNum(123456789)).toBe("1.23亿");
    expect(shortNum(-250000)).toBe("-25万");
    setLocale("en");
    expect(shortNum(12345)).toBe("12,345");
    expect(shortNum(123456)).toBe("123K");
    expect(shortNum(1234567)).toBe("1.23M");
  });
});

describe("海图镜头（map/camera.ts）", () => {
  const LEVELS = [0.4, 1, 1.5, 2, 3, 4, 6];

  it("缩放时画布上那一点下面的海图位置不动", () => {
    const cam = { s: 2, x: -100, y: -40 };
    const next = zoomAt(cam, 4, 300, 200);
    const world = (c: typeof cam, sx: number, sy: number) => [(sx - c.x) / c.s, (sy - c.y) / c.s];
    expect(world(next, 300, 200)).toEqual(world(cam, 300, 200));
    expect(next.s).toBe(4);
    expect(zoomAt(cam, 0, 1, 1)).toEqual(cam);
  });

  it("双指缩放按两指距离的比例连续缩放，夹在最小与最大倍数之间；松手对齐到最近的档位（按比例）", () => {
    expect(pinchScale(2, 100, 150, 0.4, 6)).toBe(3);
    expect(pinchScale(2, 100, 10, 0.4, 6)).toBe(0.4);
    expect(pinchScale(2, 100, 1000, 0.4, 6)).toBe(6);
    expect(pinchScale(2, 0, 50, 0.4, 6)).toBe(2);
    expect(snapScale(1.7, LEVELS)).toBe(1.5);
    expect(snapScale(1.8, LEVELS)).toBe(2);
    expect(snapScale(2.5, LEVELS)).toBe(3);
    expect(nearestLevel(0.5, LEVELS)).toBe(0);
    expect(pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ d: 50, cx: 15, cy: 20 });
  });

  it("缩放按钮与滚轮：从最近的档位跳一档，到头了停在两端", () => {
    expect(stepScale(2, LEVELS, 1)).toBe(3);
    expect(stepScale(2, LEVELS, -1)).toBe(1.5);
    expect(stepScale(6, LEVELS, 1)).toBe(6);
    expect(stepScale(0.4, LEVELS, -1)).toBe(0.4);
    expect(stepScale(2.9, LEVELS, 1)).toBe(4);
  });
});

describe("海图上别家船队的信息卡", () => {
  it("靠近海图右边与下边时翻到标记的另一侧，不被裁掉（手机上海图窄）", () => {
    const w = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(90);
    const cw = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const ch = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    try {
      const { rerender } = render(
        <div>
          <FleetHoverCard statics={statics} hover={{ index: 0, owner: "海燕商会", x: 300, y: 460 }} />
        </div>,
      );
      const card = screen.getByTestId("fleet-hover-card");
      expect(card.style.left).toBe(`${300 - 14 - 240}px`);
      expect(card.style.top).toBe(`${460 - 12 - 90}px`);
      // 放得下时照旧在标记右下
      rerender(
        <div>
          <FleetHoverCard statics={statics} hover={{ index: 0, owner: "海燕商会", x: 40, y: 60 }} />
        </div>,
      );
      expect(card.style.left).toBe("54px");
      expect(card.style.top).toBe("72px");
    } finally {
      w.mockRestore();
      h.mockRestore();
      cw.mockRestore();
      ch.mockRestore();
    }
  });
});

describe("街景拖动（hooks/usePanArea.ts）", () => {
  it("左右还有没看到的部分时标出来；放得下时两边都没有", () => {
    expect(edgesOf({ scrollLeft: 0, scrollWidth: 800, clientWidth: 390 })).toEqual({ left: false, right: true });
    expect(edgesOf({ scrollLeft: 205, scrollWidth: 800, clientWidth: 390 })).toEqual({ left: true, right: true });
    expect(edgesOf({ scrollLeft: 410, scrollWidth: 800, clientWidth: 390 })).toEqual({ left: true, right: false });
    expect(edgesOf({ scrollLeft: 0, scrollWidth: 1280, clientWidth: 1280 })).toEqual({ left: false, right: false });
  });

  it("回到初始位置：横向居中、纵向贴底（街面与海湾总在视野里）", () => {
    const el = { scrollWidth: 800, clientWidth: 390, scrollHeight: 540, clientHeight: 500, scrollLeft: 0, scrollTop: 0 };
    resetPan(el as unknown as HTMLElement);
    expect(el.scrollLeft).toBe(205);
    expect(el.scrollTop).toBe(40);
  });
});
