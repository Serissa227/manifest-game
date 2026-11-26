// 第九批 P03 前端配套：拖动罗经盘的预测（同一时间一个在路上 + 一个最新的待查意图）、本地意图版本、
// 换局与重连时迟到的航行视图 / 预测回复不采用。不渲染界面，直接调 hooks/useNavigation.ts 的动作，用模拟的 Tauri IPC。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_MS, draftHeading, refreshNav, resetNav, setSail, steerTo, useNavStore } from "../hooks/useNavigation";
import { api } from "../ipc/api";
import { bumpRequestSeq } from "../ipc/sequence";
import type { CoursePreview, NavView, Overview, StaticView } from "../ipc/types";
import { resetChartFog } from "../map/fogStore";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

const manualStatics: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };
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
  current: { dir: 90, speed: 0.8 },
  sail_limit: 67,
  trail: [[1.2, 1.1]],
  forecast: [[1.0, 1.0]],
  stops: [],
  supplies_days: 9,
  morale: 72,
  sight: 6,
  autopilot: null,
  known_dests: [],
  lat_lon: "北纬 38°42′ 西经 9°08′",
};

/** 一个预测请求：带草稿航向的是拖动的预测（手动放行），steers 为空的是当天的航迹（立即回复）。 */
interface Pending {
  heading: number;
  resolve: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const course = (n: number): CoursePreview => ({ points: [[n, 0, 0]], stops: [] });

describe("拖动预测：一个在途 + 一个最新的待查意图", () => {
  let drags: Pending[];
  let nav: NavView;
  let maxInflight: number;
  let inflight: number;

  beforeEach(() => {
    drags = [];
    nav = { ...NAV };
    inflight = 0;
    maxInflight = 0;
    installIpc({
      navigation: () => nav,
      preview_course: (args) => {
        const steers = args.steers as { heading?: number }[];
        if (steers.length === 0) return course(-1);
        const heading = steers[0].heading ?? -1;
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        return new Promise<CoursePreview>((resolve) =>
          drags.push({
            heading,
            resolve: () => {
              inflight--;
              resolve(course(heading));
            },
          }),
        );
      },
      submit: () => ({ outcome: "Done", overview: atSea }),
    });
    startedGame();
    useGame.setState({ statics: manualStatics, overview: atSea });
    resetNav();
    resetChartFog();
  });
  afterEach(() => {
    resetNav();
  });

  /** 等到发出了 n 个拖动预测。 */
  const sent = (n: number) => vi.waitFor(() => expect(drags).toHaveLength(n), { timeout: 3_000 });
  /** 让约好的预测请求有机会发出（一个节流间隔之外再留一点余量）。 */
  const settle = () => sleep(PREVIEW_MS + 80);

  it("在路上的预测期间草稿又变：不再并发新请求；回来的旧草稿先画作过渡，随后只发最新的一次，最后画的是它", async () => {
    await refreshNav();
    expect(useNavStore.getState().nav?.heading).toBe(292);
    draftHeading(100);
    await sent(1);
    expect(drags[0].heading).toBe(100);

    // 在路上的期间草稿连变几次：没有新的请求（同一时间只有一个）
    draftHeading(110);
    draftHeading(115);
    draftHeading(120);
    await settle();
    expect(drags).toHaveLength(1);

    // 旧草稿（100）的回包回来：状态没变，先画出来（拖动中预测线跟着走，不停在原地）
    drags[0].resolve();
    await sent(2);
    expect(useNavStore.getState().preview?.points[0][0]).toBe(100);
    // 中间的草稿（110、115）从来没问过，发的是最新的 120
    expect(drags[1].heading).toBe(120);

    // 最新意图的回包：画出来
    drags[1].resolve();
    await vi.waitFor(() => expect(useNavStore.getState().preview?.points[0][0]).toBe(120));
    await settle();
    expect(drags).toHaveLength(2);
    expect(maxInflight).toBe(1);
  });

  it("意图没有变（草稿不动）：回包照常显示，也不重复问", async () => {
    await refreshNav();
    draftHeading(200);
    await sent(1);
    // 同一个草稿航向再来一次（按键重复）：不是新意图
    draftHeading(200);
    drags[0].resolve();
    await vi.waitFor(() => expect(useNavStore.getState().preview?.points[0][0]).toBe(200));
    await settle();
    expect(drags).toHaveLength(1);
  });

  it("航行相关状态变了（新的一天、位置变了）：旧状态下算的预测不画，还在调整就按新状态重问", async () => {
    await refreshNav();
    draftHeading(100);
    await sent(1);
    // 在路上时航行视图换了新的一天
    nav = { ...NAV, day: 13, minute: 0, pos: { x: 2.5, y: 1.75 } };
    await refreshNav();
    expect(useNavStore.getState().nav?.day).toBe(13);
    drags[0].resolve();
    await sent(2);
    expect(useNavStore.getState().preview).toBeNull();
    expect(drags[1].heading).toBe(100);
    drags[1].resolve();
    await vi.waitFor(() => expect(useNavStore.getState().preview?.points[0][0]).toBe(100));
  });

  it("航行视图重取后内容没变：不算状态变了，在路上的预测照常显示", async () => {
    await refreshNav();
    draftHeading(100);
    await sent(1);
    await refreshNav();
    drags[0].resolve();
    await vi.waitFor(() => expect(useNavStore.getState().preview?.points[0][0]).toBe(100));
    await settle();
    expect(drags).toHaveLength(1);
  });

  it("重连（本地请求序号前进）：在路上的预测不画，航行视图重新取，还在调整的话按最新意图重问", async () => {
    const calls = installIpc({
      navigation: () => nav,
      preview_course: (args) => {
        const steers = args.steers as { heading?: number }[];
        if (steers.length === 0) return course(-1);
        return new Promise<CoursePreview>((resolve) => drags.push({ heading: steers[0].heading ?? -1, resolve: () => resolve(course(steers[0].heading ?? -1)) }));
      },
    });
    await refreshNav();
    const navCalls = () => calls.mock.calls.filter(([c]) => c === "navigation").length;
    const before = navCalls();
    draftHeading(60);
    await sent(1);
    bumpRequestSeq("reconnect");
    await vi.waitFor(() => expect(navCalls()).toBe(before + 1));
    drags[0].resolve();
    await sent(2);
    expect(useNavStore.getState().preview).toBeNull();
    expect(drags[1].heading).toBe(60);
    drags[1].resolve();
    await vi.waitFor(() => expect(useNavStore.getState().preview?.points[0][0]).toBe(60));
  });

  it("松手提交 Steer / 调帆之后：在路上的预测不画，也不再追问", async () => {
    await refreshNav();
    draftHeading(150);
    await sent(1);
    draftHeading(160);
    await steerTo(160);
    drags[0].resolve();
    await settle();
    expect(useNavStore.getState().preview).toBeNull();
    expect(useNavStore.getState().draft).toBeNull();
    expect(drags).toHaveLength(1);

    // 调帆是新的操舵意图：调整中的预测作废并重问
    draftHeading(170);
    await sent(2);
    await setSail("full");
    drags[1].resolve();
    // 旧意图的回包不画；草稿还在，按新的操舵意图再问一次
    await sent(3);
    expect(useNavStore.getState().preview).toBeNull();
    expect(drags[2].heading).toBe(170);
  });
});

describe("换局：迟到的航行视图 / 预测回复不采用", () => {
  let navWaiting: ((v: NavView | null) => void)[];
  let previewWaiting: ((v: CoursePreview) => void)[];

  beforeEach(() => {
    navWaiting = [];
    previewWaiting = [];
    installIpc({
      navigation: () => new Promise<NavView | null>((resolve) => navWaiting.push(resolve)),
      preview_course: () => new Promise<CoursePreview>((resolve) => previewWaiting.push(resolve)),
      new_game: () => overview,
      load_game: () => overview,
    });
    startedGame();
    useGame.setState({ statics: manualStatics, overview: atSea });
    resetNav();
    resetChartFog();
  });
  afterEach(() => {
    resetNav();
  });

  it("新开局时还在路上的 navigation：回来的是上一局的，不放进去", async () => {
    const p = refreshNav();
    await vi.waitFor(() => expect(navWaiting).toHaveLength(1));
    await api.newGame("新晋船主");
    navWaiting[0]({ ...NAV, heading: 11 });
    await p;
    expect(useNavStore.getState().nav).toBeNull();
    expect(previewWaiting).toHaveLength(0);
  });

  it("读档时还在路上的当天航迹：回来的不放进去；读档清掉上一局的航行状态", async () => {
    const p = refreshNav();
    await vi.waitFor(() => expect(navWaiting).toHaveLength(1));
    navWaiting[0]({ ...NAV });
    await vi.waitFor(() => expect(previewWaiting).toHaveLength(1));
    expect(useNavStore.getState().nav?.heading).toBe(292);
    draftHeading(90);
    await api.loadGame("auto");
    // 上一局的航行视图、草稿与预测都清掉了
    expect(useNavStore.getState().nav).toBeNull();
    expect(useNavStore.getState().draft).toBeNull();
    previewWaiting[0](course(5));
    await p;
    expect(useNavStore.getState().course).toBeNull();
  });
});
