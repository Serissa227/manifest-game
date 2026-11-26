// 第九批配乐的接线：养成中（Overview.mode === "upbringing"）按养成视图的摘要与事件选曲、不配海浪；
// 养成主画面把摘要交给配乐导演；海上按海区数据的 music 字段选航海曲；经典世界的选曲不变。
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneOf } from "../audio/director";
import { useUbMusic, type UbMusicDigest } from "../audio/upbringing";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import type { CaptainDefsView, LocalWeatherView, Overview, StaticView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const ub = (o: Partial<UbMusicDigest> = {}): UbMusicDigest => ({ stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, ...o });

const upbringing = (pending: Record<string, unknown> | null = null): Overview =>
  ({ ...overview, mode: "upbringing", story: { line: null, pending: pending && { day: 1, fleet: 0, key: "ev", title: "", text: "", speaker: { name: "" }, choices: [], ...pending }, last: null, journal: [] } }) as unknown as Overview;

describe("养成中的选曲", () => {
  it("按阶段放家或学院的曲子，环境声为空（不配海浪与海鸥）；还没有摘要时按家乡期", () => {
    expect(sceneOf(true, statics, upbringing(), null)).toEqual({ track: "ub_home", ambience: { place: "none", sky: null, wind: 0 }, urgent: false });
    expect(sceneOf(true, statics, upbringing(), ub({ stage: "academy" })).track).toBe("ub_academy");
    expect(sceneOf(true, statics, upbringing(), ub({ stage: "academy", festival: true })).track).toBe("ub_festival");
    expect(sceneOf(true, statics, upbringing(), ub({ phase: "graduation" })).track).toBe("ub_graduation");
  });

  it("事件按情绪换曲、立即切换；比赛的小游戏开着时也立即切换", () => {
    expect(sceneOf(true, statics, upbringing({ kind: "upbringing", mood: "tense" }), ub())).toMatchObject({ track: "ub_tense", urgent: true });
    expect(sceneOf(true, statics, upbringing({ kind: "letter" }), ub())).toMatchObject({ track: "ub_letter", urgent: true });
    expect(sceneOf(true, statics, upbringing({ kind: "bond", mood: "tender" }), ub({ stage: "academy" }))).toMatchObject({ track: "ub_heart", urgent: true });
    expect(sceneOf(true, statics, upbringing(), ub({ contestOpen: true }))).toMatchObject({ track: "ub_contest", urgent: true });
  });

  it("还没进入（signedIn 为假）仍是主题曲；出海之后（mode 为 voyage 或旧后端没有 mode）照旧按港口与海区选曲", () => {
    expect(sceneOf(false, statics, upbringing(), ub()).track).toBe("title");
    const docked = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
    expect(sceneOf(true, statics, { ...docked, mode: "voyage" }, ub({ stage: "academy" })).track).toBe("port_mediterranean");
    expect(sceneOf(true, statics, docked, ub()).track).toBe("port_mediterranean");
  });
});

describe("海上按海区数据的 music 字段选曲", () => {
  const atSea = (region: number): Overview => ({
    ...overview,
    fleets: [{ ...overview.fleets[0], docked: null, x: 100, y: 60 }],
    local_weather: { region, region_name: "", sky: "clear", wind_dir: 2, wind_strength: 4, forecast: [] } as unknown as LocalWeatherView,
  });

  it("写了 music 的海区放对应的航海曲；没写的照旧；暴风雨照旧放《怒涛》", () => {
    const s: StaticView = { ...statics, regions: [{ id: 0, name: "伊比利亚外海", music: "iberia" }, { id: 1, name: "东海", music: "china" }, { id: 2, name: "某海" }] };
    expect(sceneOf(true, s, atSea(0)).track).toBe("sea_iberia");
    expect(sceneOf(true, s, atSea(1)).track).toBe("sea_ming");
    // 没写 music：经典的表里海区 2 是北方的冷海
    expect(sceneOf(true, s, atSea(2)).track).toBe("sea_north");
    const storm = { ...atSea(0), local_weather: { ...atSea(0).local_weather!, sky: "storm" } } as Overview;
    expect(sceneOf(true, s, storm).track).toBe("storm");
  });

  it("港口：新文化的城镇风格放自己的港口曲（第三轮），没有专属曲的细名回退到最接近的已有风格", () => {
    const withStyle = (style: string): StaticView => ({ ...statics, factions: statics.factions.map((f, i) => (i === 0 ? { ...f, style } : f)) });
    const docked = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
    expect(sceneOf(true, withStyle("japanese"), docked).track).toBe("port_japan");
    // 地方特色第二阶段起朝鲜有自己的港口曲（原来回退到明）；没有专属曲的细名（波斯）照旧回退
    expect(sceneOf(true, withStyle("korean"), docked).track).toBe("port_korea");
    expect(sceneOf(true, withStyle("indian"), docked).track).toBe("port_india");
    // 地方特色第二阶段：波斯有了自己的港口曲；整合后埃塞俄比亚也有（非洲一支，原来回退到沙漠，见 DECISIONS“测试期望值变更”）
    expect(sceneOf(true, withStyle("persian"), docked).track).toBe("port_persia");
    expect(sceneOf(true, withStyle("ethiopian"), docked).track).toBe("port_ethiopia");
  });

  it("港口：寰宇世界的真实地点与势力（地方特色第二阶段）——配乐导演按势力写的风格名与停泊海区的 music 选曲，不认地点与势力的 key", () => {
    // 配乐的数据接线（2026-10-11）：原来按地点 key、势力 key 认（数据写 desert、ottoman）；现在数据写 persian、maghreb、ottoman_maghreb，
    // 阿拉伯人的港口按停泊的海（music 写 arabic 一类）认（见 DECISIONS“测试期望值变更”）
    const loc = statics.locations[0];
    const at = (place: string, faction: string, style: string, music: string | null = null): StaticView => ({
      ...statics,
      regions: statics.regions.map((r, i) => (i === 0 && music !== null ? { ...r, music } : r)),
      locations: statics.locations.map((l, i) => (i === 0 ? { ...l, key: place, region: 0 } : l)),
      factions: statics.factions.map((f, i) => (i === loc.faction ? { ...f, key: faction, style } : f)),
    });
    const docked = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
    // 奥斯曼治下的吉达、亚丁、巴士拉停在阿拉伯的海上：阿拉伯的港口曲；开罗（不靠海）与伊斯坦布尔照旧是奥斯曼
    for (const place of ["jeddah", "aden", "basra"]) expect(sceneOf(true, at(place, "ottoman", "ottoman", "arabic"), docked).track, place).toBe("port_arabia");
    expect(sceneOf(true, at("cairo", "ottoman", "ottoman"), docked).track).toBe("port_ottoman");
    expect(sceneOf(true, at("istanbul", "ottoman", "ottoman", "levant"), docked).track).toBe("port_ottoman");
    // 按风格名：萨法维与霍尔木兹写 persian → 波斯（霍尔木兹治下的巴林随势力）；摩洛哥写 maghreb、阿尔及尔写 ottoman_maghreb → 马格里布
    expect(sceneOf(true, at("isfahan", "safavid", "persian"), docked).track).toBe("port_persia");
    expect(sceneOf(true, at("hormuz_port", "hormuz", "persian", "arabic"), docked).track).toBe("port_persia");
    expect(sceneOf(true, at("bahrain", "hormuz", "persian", "arabic"), docked).track).toBe("port_persia");
    expect(sceneOf(true, at("sale", "morocco", "maghreb"), docked).track).toBe("port_maghreb");
    expect(sceneOf(true, at("algiers", "algiers", "ottoman_maghreb"), docked).track).toBe("port_maghreb");
    // 不认 key：同一个地点与势力写原来的 desert，就是沙漠的港口曲
    expect(sceneOf(true, at("isfahan", "safavid", "desert"), docked).track).toBe("port_desert");
    // 葡萄牙的丹吉尔：数据写 portuguese，放伊比利亚的《橙花码头》
    expect(sceneOf(true, at("tangier", "portugal", "portuguese"), docked).track).toBe("port_iberia");
    // 经典世界的静态数据原样：照旧
    expect(sceneOf(true, statics, docked).track).toBe("port_mediterranean");
  });
});

describe("养成主画面把摘要交给配乐导演", () => {
  const captain = { points: {}, signs: [], questions: [], attributes: [], groups: [] } as unknown as CaptainDefsView;
  const view = (o: Partial<UpbringingView> = {}): UpbringingView =>
    ({
      stage: "academy",
      stage_name: "学院 · 第二年",
      home: "京都",
      academy: { key: "kyoto", name: "宫中", city: "京都" },
      today: [1555, 7, 7],
      phase: "plan",
      protagonist: { key: "mio", name: "一条澪", age: 14, birthday: [6, 21], portrait: null, outfit: null, season: 1 },
      meters: {
        stamina: { value: 70, max: 100, label: "" },
        fatigue: { value: 10, max: 100, label: "" },
        mood: { value: 60, max: 100, label: "" },
        fame: { value: 10, max: 100, label: "" },
      },
      cash: 0,
      growth: [],
      ratings: [],
      skills: [],
      plan: {
        month: [1555, 7],
        editable: true,
        slots: [0, 1, 2].map((i) => ({
          index: i,
          label: ["上旬", "中旬", "下旬"][i],
          from: [1555, 7, i * 10 + 1] as [number, number, number],
          to: [1555, 7, i * 10 + 10] as [number, number, number],
          lesson: null,
          after: null,
          status: "empty" as const,
        })),
      },
      lessons: [],
      activities: [],
      places: [],
      excursions: [],
      companions: [],
      calendar: [{ date: [1555, 7, 7], days_left: 0, kind: "festival", key: "tanabata", name: "七夕", heart: true, note: null }],
      exams: [],
      path: { choose_on: null, chosen: null, options: [] },
      memories: [],
      letters: [],
      diary: [],
      presets: [],
      last: [],
      ...o,
    }) as UpbringingView;

  beforeEach(() => {
    useUbMusic.setState({ digest: null });
    useGame.setState({ statics: { ...statics, captain }, overview: { ...overview, speed: 0, mode: "upbringing" }, version: 1, error: null, message: null });
  });

  it("取到养成视图后发布摘要（学院期、今天是七夕）；离开时收回", async () => {
    installIpc({ upbringing: () => view() });
    const { unmount } = render(<UpbringingScreen />);
    await screen.findByText("学院 · 第二年");
    await waitFor(() => expect(useUbMusic.getState().digest).toMatchObject({ stage: "academy", festival: true, contestDay: false, contestOpen: false }));
    expect(sceneOf(true, statics, useGame.getState().overview, useUbMusic.getState().digest).track).toBe("ub_festival");
    unmount();
    expect(useUbMusic.getState().digest).toBeNull();
  });

  it("学院期平时放这所学院的短主题（第三轮）：京都的学院 →《宫中的筝》", async () => {
    installIpc({ upbringing: () => view({ calendar: [] }) });
    const { unmount } = render(<UpbringingScreen />);
    await screen.findByText("学院 · 第二年");
    await waitFor(() => expect(useUbMusic.getState().digest).toMatchObject({ stage: "academy", academy: "kyoto", protagonist: "mio", festival: false }));
    expect(sceneOf(true, statics, useGame.getState().overview, useUbMusic.getState().digest).track).toBe("ac_kyoto");
    unmount();
  });
});
