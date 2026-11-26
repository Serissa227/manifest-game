// hide_unknown_ports 的世界与手动航行的界面补缺：委托书上没望见过的交货港只写方向；后端发出的每一种日志都有文字
// （望见新地点、登陆的意外与收队）；手动航行中途自动暂停时顶栏时刻下面写明原因，设置里可以关掉这种暂停。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import HudClock from "../components/HudClock";
import IntelPanel from "../components/panels/IntelPanel";
import SettingsPanel from "../components/panels/SettingsPanel";
import TopBar from "../components/TopBar";
import { ContractCard } from "../components/port/cards";
import { setLocale } from "../i18n/locale";
import { en } from "../i18n/en";
import { zhCN } from "../i18n/zh-CN";
import type { AppSettings, ContractView, Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, settingsView, startedGame, statics } from "./fixtures";

const [LOG_RS] = Object.values(
  import.meta.glob<string>("../../../crates/manifest-core/src/log.rs", { query: "?raw", import: "default", eager: true }),
);

/** manifest_core::log::LogKind 的变体名（界面按 `log.<变体名>` 取文字），外加应用层改名的 StoryIgnored（views.rs 的 log_view_in）。 */
function backendLogKinds(): string[] {
  const text = LOG_RS.replace(/\r\n/g, "\n");
  const body = /pub enum LogKind \{\n([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
  const kinds = [...body.matchAll(/^ {4}([A-Z]\w*)\b/gm)].map((m) => m[1]);
  return [...kinds, "StoryIgnored"];
}

beforeEach(() => {
  setLocale("zh-CN");
  startedGame();
});

describe("委托书：没望见过的交货港", () => {
  const base: ContractView = { id: 4, issuer: 0, good: 1, qty: 20, to: 1, deadline: 40, reward: 900, penalty: 300, status: "open", ai: false };

  it("看得见时写港名；to 为 null 时写后端给的方向", () => {
    const { unmount } = render(<ContractCard contract={base} statics={statics} today={12} />);
    expect(screen.getByTestId("contract-4")).toHaveTextContent("于第 40 天前运抵 柳湾。");
    unmount();
    render(<ContractCard contract={{ ...base, to: null, direction: "东北方" }} statics={statics} today={12} />);
    expect(screen.getByTestId("contract-4")).toHaveTextContent("于第 40 天前运抵 东北方一处还没望见的港口。");
  });
});

describe("情报日志的文字", () => {
  it("后端 LogKind 的每一种在中英文字符串表里都有 log.<种类>", () => {
    const kinds = backendLogKinds();
    expect(kinds).toEqual(expect.arrayContaining(["Arrived", "LocationSighted", "LandingRisk", "LandingFinished", "NavigationStopped"]));
    const zh = zhCN as Record<string, string>;
    expect(kinds.filter((k) => !(`log.${k}` in zh))).toEqual([]);
    expect(kinds.filter((k) => !(`log.${k}` in en))).toEqual([]);
    // 登陆的三种意外也各有文字
    for (const r of ["injury", "disease", "lost"]) {
      expect(zh[`landingRisk.${r}`]).toBeTruthy();
      expect(en[`landingRisk.${r}`]).toBeTruthy();
    }
  });

  it("情报窗口：望见新地点、登陆受伤、登陆收队写成句子，不露出键名", async () => {
    const log = [
      { day: 3, kind: "LocationSighted", args: [["loc", "雾港"]] as [string, string][], mine: false },
      { day: 4, kind: "LandingRisk", args: [["fleet", "0"], ["owner", "player"], ["risk", "injury"]] as [string, string][], mine: true },
      { day: 5, kind: "LandingFinished", args: [["fleet", "0"], ["owner", "player"], ["days", "3"]] as [string, string][], mine: true },
    ];
    installIpc({ intel: () => ({ news: [], events: [], log, chronicles: [], composed: [] }) });
    render(<IntelPanel />);
    const panel = await screen.findByTestId("intel-panel");
    await waitFor(() => expect(panel.querySelectorAll(".pn-logbook li")).toHaveLength(3));
    const book = panel.querySelector(".pn-logbook") as HTMLElement;
    expect(book).toHaveTextContent("望见了 雾港，记上了海图");
    expect(book).toHaveTextContent("你 的舰队 #0 登陆探索：有人摔伤了，折了一两名船员");
    expect(book).toHaveTextContent("你 的舰队 #0 收回登陆队，在岸上探了 3 天");
    expect(book).not.toHaveTextContent("log.");
    expect(book).not.toHaveTextContent("landingRisk.");
  });
});

describe("手动航行中途自动暂停", () => {
  const stopped = (o: Partial<Overview> = {}): Overview => ({
    ...overview,
    speed: 0,
    navigation_stop: { day: 12, minute: 300, fleet: 0, kind: "land", loc: null, text: "前方是陆地或封冻海面，已停船" },
    ...o,
  });

  it("顶栏时刻下面写明原因；不是旗舰队时写明哪一支；没有暂停原因或正在运行时不写", () => {
    const { unmount } = render(<HudClock o={stopped()} />);
    expect(screen.getByTestId("nav-stop-note")).toHaveTextContent("已自动暂停：前方是陆地或封冻海面，已停船");
    unmount();
    const other = stopped({ navigation_stop: { day: 12, minute: 300, fleet: 4, kind: "sight", loc: 9, text: "看见新地点" } });
    const second = render(<HudClock o={other} variant="mini" />);
    expect(screen.getByTestId("nav-stop-note")).toHaveTextContent("舰队 #4 停下，已自动暂停：看见新地点");
    second.unmount();
    const third = render(<HudClock o={overview} />);
    expect(screen.queryByTestId("nav-stop-note")).toBeNull();
    third.unmount();
    render(<HudClock o={stopped({ speed: 2 })} />);
    expect(screen.queryByTestId("nav-stop-note")).toBeNull();
  });

  it("顶栏里挂着（随推送来的概览出现）", () => {
    useGame.setState({ overview: stopped() });
    render(<TopBar />);
    expect(within(screen.getByTestId("hud")).getByTestId("nav-stop-note")).toHaveTextContent("前方是陆地或封冻海面");
  });

  it("设置：“手动航行途中遇事自动暂停”与抵达暂停放在一起，取消勾选后保存为 false；旧后端没有这一项时不显示", async () => {
    const user = userEvent.setup();
    const old = installIpc();
    const { unmount } = render(<SettingsPanel />);
    await screen.findByText(/API 密钥（未设置）/);
    expect(screen.queryByLabelText(/手动航行途中遇事自动暂停/)).toBeNull();
    unmount();
    expect(old).not.toHaveBeenCalledWith("save_settings", expect.anything());

    const calls = installIpc({
      get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, arrival_pause: "flagship", navigation_pause: true } }),
    });
    render(<SettingsPanel />);
    const box = await screen.findByLabelText(/手动航行途中遇事自动暂停/);
    expect(box).toBeChecked();
    // 紧跟在“抵达时自动暂停”后面
    const arrival = screen.getByLabelText("抵达时自动暂停");
    expect(arrival.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.navigation_pause).toBe(false);
    expect(saved.arrival_pause).toBe("flagship");
  });
});
