// 中英双语的界面（EXPANSION.md §12）：双行名字组件、港名牌与人物卡片的双行显示、切换语言后界面变成英文、
// 设置里切换语言会保存设置并重新获取静态数据、首次启动按系统语言、切换语言不提交任何命令。
// 这些用例会把语言切到英文，每个用例结束后切回中文（其余测试默认中文）。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { npcNamePair } from "../art/names";
import { keeperCast, portraitAsset } from "../art/portraitCast";
import { BiName } from "../components/BiName";
import PortScene from "../components/PortScene";
import PortPanel from "../components/panels/PortPanel";
import { keeperPlaces } from "../components/port/greeting";
import SettingsPanel from "../components/panels/SettingsPanel";
import { styleOf } from "../art/buildings";
import { setLocale, useLocale } from "../i18n/locale";
import type { AppSettings, StaticView } from "../ipc/types";
import { openWindow } from "../components/shell/shellState";
import { useGame } from "../store/game";
import { installIpc, mate, port, settingsView, startedGame, statics } from "./fixtures";

/** 带英文正名的静态数据（后端在任何语言下都给 name_en）。 */
const EN_NAMES: Record<string, string> = { chenggang: "Chenggang", liuwan: "Liuwan", lancheng: "Lancheng" };
const bilingual: StaticView = {
  ...statics,
  locations: statics.locations.map((l) => ({ ...l, name_en: EN_NAMES[l.key] ?? null })),
  factions: statics.factions.map((f) => ({ ...f, name_en: f.key === "cuilan" ? "Cuilan" : "Jinsui" })),
  ships: statics.ships.map((s) => ({ ...s, name_en: "Sloop" })),
};
/** 英文界面下后端给的静态数据：name 已是英文。 */
const englishStatics: StaticView = {
  ...bilingual,
  world: { currency: "gold", era: "Mariner's Reckoning", start_year: 1502 },
  locations: bilingual.locations.map((l) => ({ ...l, name: l.name_en ?? l.name })),
  factions: bilingual.factions.map((f) => ({ ...f, name: f.name_en ?? f.name })),
};

const setNavigatorLanguage = (lang: string) => Object.defineProperty(window.navigator, "language", { value: lang, configurable: true });

afterEach(() => {
  // 先卸载界面再切回中文，免得已卸载前的组件在 act 之外更新
  cleanup();
  setLocale("zh-CN");
  setNavigatorLanguage("zh-CN");
});

describe("双行名字组件 BiName", () => {
  it("中文界面：中文名下方一小行英文（对读屏隐藏）；英文缺失或相同时只有一行", () => {
    const { container, rerender } = render(<BiName zh="维拉马雷" en="Villamare" testId="n" />);
    const el = screen.getByTestId("n");
    expect(el).toHaveClass("bi-name", "bi-name-two");
    expect(el.querySelector(".bi-name-main")).toHaveTextContent("维拉马雷");
    const sub = el.querySelector(".bi-name-sub");
    expect(sub).toHaveTextContent("Villamare");
    expect(sub).toHaveAttribute("aria-hidden", "true");
    expect(sub).toHaveAttribute("lang", "en");
    rerender(<BiName zh="新晨港" testId="n" />);
    expect(container.querySelector(".bi-name-sub")).toBeNull();
    expect(screen.getByTestId("n")).not.toHaveClass("bi-name-two");
    rerender(<BiName zh="Marlow" en="Marlow" testId="n" />);
    expect(container.querySelector(".bi-name-sub")).toBeNull();
  });

  it("英文界面：只显示英文；没有英文时显示原名", () => {
    act(() => setLocale("en"));
    const { container, rerender } = render(<BiName as="strong" zh="维拉马雷" en="Villamare" testId="n" />);
    const el = screen.getByTestId("n");
    expect(el.tagName).toBe("STRONG");
    expect(el).toHaveTextContent(/^Villamare$/);
    expect(container.querySelector(".bi-name-sub")).toBeNull();
    rerender(<BiName zh="新晨港" testId="n" />);
    expect(screen.getByTestId("n")).toHaveTextContent(/^新晨港$/);
  });

  it("主行可以是含名字的整句（对话框标题），英文小行仍是原名", () => {
    render(
      <BiName zh="澄港" en="Chenggang" testId="n">
        在澄港建立殖民地
      </BiName>,
    );
    const el = screen.getByTestId("n");
    expect(el.querySelector(".bi-name-main")).toHaveTextContent("在澄港建立殖民地");
    expect(el.querySelector(".bi-name-sub")).toHaveTextContent("Chenggang");
  });

  it("切换语言时已经挂载的名字跟着变（组件订阅语言）", () => {
    render(<BiName zh="维拉马雷" en="Villamare" testId="n" />);
    expect(screen.getByTestId("n").querySelector(".bi-name-sub")).not.toBeNull();
    act(() => setLocale("en"));
    expect(screen.getByTestId("n")).toHaveTextContent(/^Villamare$/);
  });
});

describe("港名牌与人物卡片的双行显示", () => {
  beforeEach(() => {
    installIpc({ static_data: () => bilingual });
    startedGame();
    useGame.setState({ statics: bilingual });
  });

  it("中文界面：港名牌“澄港”下方一小行 Chenggang；英文界面只有英文", async () => {
    const { unmount } = render(<PortScene />);
    const sign = await screen.findByTestId("port-sign-name");
    expect(sign.querySelector(".bi-name-main")).toHaveTextContent("澄港");
    expect(sign.querySelector(".bi-name-sub")).toHaveTextContent("Chenggang");
    unmount();

    act(() => {
      setLocale("en");
      useGame.setState({ statics: englishStatics });
    });
    render(<PortScene />);
    const en = await screen.findByTestId("port-sign-name");
    expect(en).toHaveTextContent(/^Chenggang$/);
    expect(en.querySelector(".bi-name-sub")).toBeNull();
  });

  it("掌柜人物卡：中文音译下方是英文原形；港口窗口标题与航海士卡片同样双行", async () => {
    installIpc({ static_data: () => bilingual, port: () => ({ ...port, mates_here: [{ ...mate, name_en: "Zhou Mingyuan" }] }) });
    render(<PortPanel />);
    // 掌柜按界面的地点列表选肖像，名字按所选肖像的性别起
    const who = keeperCast("chenggang", "market", styleOf("cuilan", null), keeperPlaces(bilingual.locations, bilingual.factions));
    const pair = npcNamePair("chenggang-market", portraitAsset(who.asset)?.meta.gender === "female", styleOf("cuilan", null));
    const name = await screen.findByTestId("keeper-name");
    expect(name.querySelector(".bi-name-main")).toHaveTextContent(pair.zh);
    expect(name.querySelector(".bi-name-sub")).toHaveTextContent(pair.en);
    const title = screen.getByTestId("port-title-name");
    expect(title.querySelector(".bi-name-sub")).toHaveTextContent("Chenggang");

    // 酒馆的航海士人物卡
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "酒馆" }));
    const mateName = await screen.findByTestId("mate-name-1");
    expect(mateName.querySelector(".bi-name-main")).toHaveTextContent("周明远");
    expect(mateName.querySelector(".bi-name-sub")).toHaveTextContent("Zhou Mingyuan");
  });

  it("英文界面：掌柜只显示英文原形，头衔与问候语是英文", async () => {
    act(() => {
      setLocale("en");
      useGame.setState({ statics: englishStatics });
    });
    installIpc({ static_data: () => englishStatics });
    render(<PortPanel />);
    const who = keeperCast("chenggang", "market", styleOf("cuilan", null), keeperPlaces(englishStatics.locations, englishStatics.factions));
    const name = await screen.findByTestId("keeper-name");
    expect(name).toHaveTextContent(new RegExp(`^${who.nameEn}$`));
    const keeper = screen.getByTestId("keeper");
    expect(keeper).toHaveTextContent("Market keeper");
    expect(screen.getByTestId("keeper-greeting").textContent).not.toMatch(/[\u4e00-\u9fff]/);
  });
});

describe("切换语言后界面变成英文", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc({ save_settings: (a) => ({ ...settingsView, settings: a.settings as AppSettings }) });
    startedGame();
    openWindow("settings");
  });

  it("在设置里选 English 并保存：调用 saveSettings（language = en）、重新获取静态数据，顶栏、命令栏、港口、市场与设置都变成英文", async () => {
    const user = userEvent.setup();
    render(<App />);
    // 中文界面
    expect(await screen.findByTestId("settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cash")).toHaveTextContent("12,345 金币");
    const select = screen.getByLabelText("语言 / Language");
    expect(select).toHaveValue("zh-CN");
    expect(within(select).getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "简体中文" })).toBeInTheDocument();

    calls.mockClear();
    await user.selectOptions(select, "en");
    // 选了还没保存：界面不变
    expect(useLocale.getState().locale).toBe("zh-CN");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(useLocale.getState().locale).toBe("en"));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.language).toBe("en");
    // 保存之后按新语言重新获取静态数据与概览
    const names = calls.mock.calls.map((c) => c[0]);
    expect(names.indexOf("save_settings")).toBeLessThan(names.lastIndexOf("static_data"));
    expect(names).toContain("overview");
    // 切换语言不提交任何命令、不推进时间、不改速度
    expect(names.filter((n) => ["submit", "step", "set_speed", "new_game", "load_game"].includes(n))).toEqual([]);

    // 顶栏
    expect(await screen.findByText("Cash")).toBeInTheDocument();
    expect(screen.getByTestId("cash")).toHaveTextContent("12,345 gold");
    expect(screen.getByTestId("date")).toHaveTextContent("13 Jan 1502 (Spring)");
    expect(screen.getByRole("group", { name: "Game speed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
    // 命令栏
    const bar = screen.getByRole("tablist", { name: "Panels" });
    expect(within(bar).getByRole("tab", { name: "Fleet" })).toBeInTheDocument();
    expect(within(bar).getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    // 设置窗口仍然打开，而且是英文
    expect(await screen.findByRole("button", { name: "Save settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Language / 语言")).toBeInTheDocument();
    expect(useGame.getState().message).toBe("Settings saved");

    // 港口窗口与市场
    await user.click(within(bar).getByRole("tab", { name: "Port" }));
    const panel = await screen.findByTestId("port-panel");
    expect(within(panel).getByRole("tab", { name: "Market" })).toBeInTheDocument();
    expect(within(panel).getByRole("tab", { name: "Shipyard" })).toBeInTheDocument();
    expect(await within(panel).findByRole("columnheader", { name: "Goods" })).toBeInTheDocument();
    expect(within(panel).getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
  });

  it("再切回中文：界面回到中文", async () => {
    const user = userEvent.setup();
    // 设置里存的是英文（启动时 init 按设置切到英文）
    installIpc({
      get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, language: "en" } }),
      save_settings: (a) => ({ ...settingsView, settings: a.settings as AppSettings }),
    });
    render(<App />);
    const select = await screen.findByLabelText("Language / 语言");
    await user.selectOptions(select, "zh-CN");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(useLocale.getState().locale).toBe("zh-CN"));
    expect(await screen.findByText("现金")).toBeInTheDocument();
    expect(screen.getByTestId("cash")).toHaveTextContent("12,345 金币");
    expect(useGame.getState().message).toBe("设置已保存");
  });

  it("没改语言时保存设置不切换、不重新获取静态数据", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await screen.findByTestId("settings-panel");
    calls.mockClear();
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.language).toBe("zh-CN");
    expect(calls.mock.calls.map((c) => c[0])).not.toContain("static_data");
    expect(useLocale.getState().locale).toBe("zh-CN");
  });
});

describe("首次启动与标题画面的语言", () => {
  beforeEach(() => {
    useGame.setState({ statics: null, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null });
  });

  it("设置里还没有语言：按系统语言（英文系统 → 英语）", async () => {
    setNavigatorLanguage("en-US");
    installIpc();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose a scenario" })).toBeInTheDocument();
    expect(useLocale.getState().locale).toBe("en");
    // 开局向导的步骤条与按钮是英文；走到“姓名”与“启航”
    const user = userEvent.setup();
    expect(within(screen.getByRole("navigation", { name: "Getting started" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "1Scenario",
      "2Looks",
      "3Name",
      "4Set sail",
    ]);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    // 默认船长名是英文，放得下 12 个字符
    const name = screen.getByLabelText("Captain's name") as HTMLInputElement;
    expect(name.value).toMatch(/^[A-Za-z][A-Za-z .'-]*$/);
    expect(name.value.length).toBeLessThanOrEqual(12);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Start New Game" })).toBeInTheDocument();
  });

  it("设置里有语言时以设置为准（英文系统、设置为中文 → 中文）", async () => {
    setNavigatorLanguage("en-US");
    installIpc({ get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, language: "zh-CN" } }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(useLocale.getState().locale).toBe("zh-CN");
  });

  it("中文系统、设置为英文 → 英文", async () => {
    installIpc({ get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, language: "en" } }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Choose a scenario" })).toBeInTheDocument();
  });

  it("标题画面的语言下拉：选中即保存进设置（其余设置不变）并切换", async () => {
    const calls = installIpc({ save_settings: (a) => ({ ...settingsView, settings: a.settings as AppSettings }) });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "选择开局剧本" });
    await user.selectOptions(screen.getByLabelText("语言 / Language"), "en");
    expect(await screen.findByRole("heading", { name: "Choose a scenario" })).toBeInTheDocument();
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved).toEqual({ ...settingsView.settings, language: "en" });
    expect(screen.getByRole("button", { name: "New Voyage" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Manifest");
  });
});
