// 寰宇的生物、传说之船与秘境街景插画（art/lore.ts，清单由 tools/scenes/build_lore.py 生成）：
// 清单里有的才显示——生物遭遇的故事窗口顶上一整幅大图，秘闻页传说之船与已知秘境的卡片顶上一张中图；
// 清单里没有的 key（故事 2.0 自己的情绪插画键、还没画的生物）不出图；还不知道的秘境不显示题图，免得泄底。
// 一个 key 可以有几版（不同时段与天况）：按打开时的时辰与当地天气挑最贴切的一版，没画出的雨雪雾叠一层天气；
// 港口窗口标题下的城市插画（port_<港口 key>）、历史事件卡片的题图（event_<事件 key>）、传说之船的 CG 画廊。
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loreArt, loreOverlay, loreSrc, pickLore } from "../art/lore";
import HistoryPanel from "../components/history/HistoryPanel";
import SecretsPanel from "../components/history/SecretsPanel";
import PortPanel from "../components/panels/PortPanel";
import StoryDialog from "../components/story/StoryDialog";
import { useStoryUi } from "../components/story/storyKit";
import { setLocale } from "../i18n/locale";
import type { LegendShipsView, Overview, RealmsView, StoryEventView, StoryView, TimelineEvent } from "../ipc/types";
import { useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { captainStatics, installIpc, overview, startedGame } from "./fixtures";

vi.mock("../art/loreArt", () => ({
  LORE_ART: {
    creature_sea_serpent: [["creature_sea_serpent", "dusk", "clear"]],
    creature_ys: [
      ["creature_ys", "dusk", "clear"],
      ["creature_ys--day-rain", "day", "rain"],
      ["creature_ys--night-fog", "night", "fog"],
    ],
    ship_michael: [["ship_michael", "dusk", "clear"]],
    ship_dutchman: [
      ["ship_dutchman", "dusk", "clear"],
      ["ship_dutchman--dawn-fog", "dawn", "fog"],
      ["ship_dutchman--night-storm", "night", "storm"],
    ],
    realm_atlantis: [["realm_atlantis", "dusk", "clear"]],
    realm_brendan: [["realm_brendan", "dusk", "clear"]],
    realm_chenggang: [["realm_chenggang", "dusk", "clear"]],
    port_lancheng: [
      ["port_lancheng--day-clear", "day", "clear"],
      ["port_lancheng--night-rain", "night", "rain"],
    ],
    event_sarhu: [["event_sarhu--day-cloudy", "day", "cloudy"]],
  },
}));

/** 生物遭遇（照 creatures_view.rs 的 JSON 形状）：插画键是 creature_<生物 key>。 */
const serpent: StoryEventView = {
  day: 40,
  fleet: 0,
  kind: "encounter",
  key: "enc-1",
  title: "大海蛇",
  text: "卑尔根外海，一道黑色的脊背从浪里拱了起来。",
  speaker: { kind: "none", name: "" },
  choices: [{ key: "flee", text: "转舵避开。", cost: 0, requires: [] }],
  night: false,
  art: "creature_sea_serpent",
};

function withStory(story: Partial<StoryView>): Overview {
  return { ...overview, captain: { name: "澪", portrait: 3 }, story: { line: null, pending: null, last: null, journal: [], ...story } };
}

beforeEach(() => {
  setLocale("zh-CN");
  useClockStore.setState({ day: 40, minute: 8 * 60 });
});
afterEach(() => useStoryUi.setState({ dismissed: "", panel: false, sideCast: null }));

const weather = (sky: "clear" | "rain" | "snow" | "fog" | "storm") => ({ region: 0, region_name: "近海", region_name_en: "", sky, wind_dir: 0, wind_strength: 3, forecast: [] });

describe("插画清单", () => {
  it("清单里有的给出大图与中图的地址，没有的为 null", () => {
    expect(loreArt("creature_sea_serpent", "large")).toMatch(/scenes\/creature_sea_serpent\.webp/);
    expect(loreArt("ship_michael", "medium")).toMatch(/scenes\/ship_michael-m\.webp/);
    expect(loreArt("creature_kraken", "large")).toBeNull();
    expect(loreArt("tide_pool", "large")).toBeNull();
    expect(loreArt(undefined, "large")).toBeNull();
  });

  it("按时段与天况挑版本：时段比天况要紧，同样贴切的几版按种子轮换；什么都不给时用最早的一版", () => {
    expect(pickLore("creature_ys")?.[0]).toBe("creature_ys");
    expect(pickLore("creature_ys", { phase: "night", sky: "clear" })?.[0]).toBe("creature_ys--night-fog");
    expect(pickLore("creature_ys", { phase: "day", sky: "clear" })?.[0]).toBe("creature_ys--day-rain");
    expect(pickLore("creature_ys", { phase: "dusk", sky: "clear" })?.[0]).toBe("creature_ys");
    expect(pickLore("ship_dutchman", { phase: "dawn", sky: "fog" })?.[0]).toBe("ship_dutchman--dawn-fog");
    // 只给天况、谁都不贴切：两版同分，按种子轮换
    const tied = new Set([0, 1, 2, 3].map((seed) => pickLore("port_lancheng", { sky: "snow", seed })?.[0]));
    expect(tied).toEqual(new Set(["port_lancheng--day-clear", "port_lancheng--night-rain"]));
    expect(pickLore("creature_kraken", { phase: "night" })).toBeNull();
  });

  it("港口只有大图；当地的雨雪雾没画出来时才叠天气", () => {
    expect(loreSrc("port_lancheng--day-clear", "large")).toMatch(/scenes\/port_lancheng--day-clear\.webp/);
    expect(loreSrc("port_lancheng--day-clear", "medium")).toBeNull();
    const rain = ["x--day-rain", "day", "rain"] as const;
    const storm = ["x--night-storm", "night", "storm"] as const;
    expect(loreOverlay(rain, "rain")).toBeNull();
    expect(loreOverlay(storm, "rain")).toBeNull();
    expect(loreOverlay(rain, "snow")).toBe("snow");
    expect(loreOverlay(rain, "fog")).toBe("fog");
    expect(loreOverlay(rain, "clear")).toBeNull();
    expect(loreOverlay(rain, undefined)).toBeNull();
  });
});

describe("生物遭遇的故事窗口", () => {
  it("有插画时正文上方显示一整幅大图；没有这张图的插画键不出图", () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: withStory({ pending: serpent }) });
    const { unmount } = render(<StoryDialog />);
    const art = within(screen.getByTestId("story-dialog")).getByTestId("story-art");
    expect(art).toHaveAttribute("src", expect.stringMatching(/scenes\/creature_sea_serpent\.webp/));
    unmount();
    useGame.setState({ overview: withStory({ pending: { ...serpent, key: "enc-2", art: "creature_kraken" } }) });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("story-art")).toBeNull();
  });

  it("夜里的遭遇用夜里的一版；白天按当地天气挑，没画出的雪叠一层", () => {
    installIpc();
    const ys = { ...serpent, key: "enc-ys", title: "伊斯", art: "creature_ys" };
    useGame.setState({ statics: captainStatics, overview: withStory({ pending: { ...ys, night: true } }) });
    const first = render(<StoryDialog />);
    expect(screen.getByTestId("story-art")).toHaveAttribute("data-variant", "creature_ys--night-fog");
    first.unmount();
    useGame.setState({ overview: { ...withStory({ pending: { ...ys, key: "enc-ys2" } }), local_weather: weather("rain") } });
    const second = render(<StoryDialog />);
    const art = screen.getByTestId("story-art");
    expect(art).toHaveAttribute("data-variant", "creature_ys--day-rain");
    expect(art.parentElement).not.toHaveAttribute("data-wx");
    second.unmount();
    useGame.setState({ overview: { ...withStory({ pending: { ...ys, key: "enc-ys3" } }), local_weather: weather("snow") } });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-art").parentElement).toHaveAttribute("data-wx", "snow");
  });
});

describe("养成事件的插画", () => {
  it("插画 key 是活动场景或回忆插画时，故事窗口显示那一张，按世界日历的当月挑季节版", () => {
    installIpc();
    const ev = { ...serpent, key: "ub-1", kind: "upbringing" as StoryEventView["kind"], title: "回忆", art: "kemari_jp" };
    useGame.setState({ statics: captainStatics, overview: { ...withStory({ pending: ev }), world_date: [1554, 1, 10] } });
    const first = render(<StoryDialog />);
    expect(screen.getByTestId("story-art")).toHaveAttribute("src", expect.stringMatching(/scenes\/kemari_jp--winter\.webp$/));
    first.unmount();
    useGame.setState({ overview: { ...withStory({ pending: { ...ev, key: "ub-2", art: "mem-c9-mio-03" } }), world_date: [1554, 1, 10] } });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-art")).toHaveAttribute("src", expect.stringMatching(/scenes\/mem-c9-mio-03\.webp$/));
  });
});

describe("秘闻页的题图", () => {
  it("传说之船有图时卡片顶上显示中图", async () => {
    const user = userEvent.setup();
    const ships: LegendShipsView = {
      ships: [
        { key: "michael", name: "大迈克尔号", hull: "卡拉克", traits: [], state: "blueprint", lore: "", acquire: null, basis: null, sources: [], can_commission: false, blocked_reason: "这里没有船坞" },
        { key: "naglfar", name: "纳吉尔法", hull: "长船", traits: [], state: "rumor", lore: "", acquire: null, basis: null, sources: [], can_commission: false },
      ],
    };
    installIpc({ legend_ships: () => ships });
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    const michael = await screen.findByTestId("ship-michael");
    expect(within(michael).getByTestId("lore-ship_michael")).toHaveAttribute("src", expect.stringMatching(/scenes\/ship_michael-m\.webp/));
    expect(screen.getByTestId("ship-naglfar").querySelector("img")).toBeNull();
    // 只有一版的船不出“看 CG”
    expect(within(michael).queryByTestId("gallery-ship_michael")).toBeNull();
  });

  it("传说之船的 CG 画廊：知道下落以后可以看全部的版本，← → 翻页，Esc 关闭；只是传闻时没有", async () => {
    const user = userEvent.setup();
    const ship = (state: LegendShipsView["ships"][number]["state"]): LegendShipsView["ships"][number] => ({
      key: "dutchman",
      name: "飞翔的荷兰人",
      hull: "瑙船",
      traits: [],
      state,
      lore: "",
      acquire: null,
      basis: null,
      sources: [],
      can_commission: false,
    });
    let ships: LegendShipsView = { ships: [ship("rumor")] };
    installIpc({ legend_ships: () => ships });
    const { unmount } = render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    expect(await screen.findByTestId("lore-ship_dutchman")).toBeInTheDocument();
    expect(screen.queryByTestId("gallery-ship_dutchman")).toBeNull();
    unmount();
    ships = { ships: [ship("known")] };
    render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "传说之船" }));
    await user.click(await screen.findByRole("button", { name: "看 CG（3）" }));
    const dialog = screen.getByRole("dialog", { name: "飞翔的荷兰人 · CG" });
    const image = within(dialog).getByTestId("lore-gallery-image");
    expect(image).toHaveAttribute("data-variant", "ship_dutchman");
    expect(image).toHaveAttribute("src", expect.stringMatching(/scenes\/ship_dutchman\.webp/));
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByTestId("lore-gallery-image")).toHaveAttribute("data-variant", "ship_dutchman--dawn-fog");
    expect(within(dialog).getByText("黎明 · 雾")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "夜晚 · 暴风雨" }));
    expect(within(dialog).getByTestId("lore-gallery-image")).toHaveAttribute("data-variant", "ship_dutchman--night-storm");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("lore-gallery")).toBeNull();
  });

  it("已知的秘境显示题图，还不知道的不显示（免得泄底）", async () => {
    const user = userEvent.setup();
    const realm = (key: string, state: RealmsView["realms"][number]["state"]): RealmsView["realms"][number] => ({
      key,
      name: key === "atlantis" ? "亚特兰蒂斯" : "圣布伦丹岛",
      state,
      hint: null,
      key_items: [],
      key_any: [],
      rules: [],
    });
    installIpc({ realms: () => ({ realms: [realm("atlantis", "heard"), realm("brendan", "unknown")] }) });
    const { container } = render(<SecretsPanel />);
    await user.click(screen.getByRole("tab", { name: "秘境" }));
    expect(await screen.findByTestId("lore-realm_atlantis")).toHaveAttribute("src", expect.stringMatching(/scenes\/realm_atlantis-m\.webp/));
    expect(container.querySelector('[data-testid="lore-realm_brendan"]')).toBeNull();
  });
});

describe("秘境港口的街景", () => {
  it("港口窗口标题下按 realm_<港口 key> 显示街景；没有图的港口不显示", async () => {
    installIpc();
    startedGame();
    const { unmount } = render(<PortPanel />);
    expect(await screen.findByTestId("port-lore-art")).toHaveAttribute("src", expect.stringMatching(/scenes\/realm_chenggang\.webp/));
    unmount();
    useGame.setState({ selectedLoc: 1 });
    render(<PortPanel />);
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("port-lore-art")).toBeNull();
  });

  it("其余港口按 port_<港口 key> 显示城市插画：白天、夜里各用各的一版", async () => {
    installIpc();
    startedGame();
    useGame.setState({ selectedLoc: 2 });
    const day = render(<PortPanel />);
    expect(await screen.findByTestId("port-lore-art")).toHaveAttribute("data-variant", "port_lancheng--day-clear");
    day.unmount();
    useClockStore.setState({ minute: 22 * 60 });
    render(<PortPanel />);
    expect(await screen.findByTestId("port-lore-art")).toHaveAttribute("data-variant", "port_lancheng--night-rain");
  });
});

describe("历史事件的题图", () => {
  it("有插画的事件卡片顶上显示中图，没有的不显示", async () => {
    const ev = (key: string, title: string): TimelineEvent => ({
      key,
      title,
      summary: "",
      region: null,
      date: [1561, 4, 1],
      window: null,
      days_left: 30,
      status: "active",
      campaign: null,
      sides: [],
      balance: null,
      levers: [],
      why_hard: [],
      outcome: null,
      basis: null,
      sources: [],
    });
    installIpc({ timeline: () => ({ events: [ev("sarhu", "萨尔浒"), ev("rhodes", "罗得岛")], deviation: 0, history_on: true }) });
    render(<HistoryPanel />);
    const sarhu = await screen.findByTestId("event-sarhu");
    expect(within(sarhu).getByTestId("event-art-sarhu")).toHaveAttribute("src", expect.stringMatching(/scenes\/event_sarhu--day-cloudy-m\.webp/));
    expect(within(screen.getByTestId("event-rhodes")).queryByTestId("event-art-rhodes")).toBeNull();
  });
});
