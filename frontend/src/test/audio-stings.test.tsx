// 时间线的短乐句的接线（第三轮配乐）：历史的天平开着时，时间线更新后一件事揭晓、或你出过力的事件期限迫近，就请配乐导演奏一句；
// 刚打开窗口时早就揭晓的事不算；期限只奏一次。
// 时间线由 useView 按“世界的状态变没变”重查（store/views.ts），测试里用“过了一天”（概览的日期变了）让它重查。
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStingRequests } from "../audio/stings";
import HistoryPanel from "../components/history/HistoryPanel";
import type { LeverView, TimelineEvent, TimelineView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

/** 过了 n 天：概览的日期变了，世界的状态算变了，时间线重查。 */
const nextDay = (n: number) => act(() => useGame.setState({ overview: { ...overview, day: overview.day + n } }));

const lever = (yours: number): LeverView => ({
  key: "pay",
  side: "ming",
  kind: "money",
  label: "军饷",
  where: null,
  goods: [],
  progress: { points: yours, max: 10 },
  yours,
  risk: null,
  note: null,
  action: "money",
  enabled: true,
});

const ev = (o: Partial<TimelineEvent>): TimelineEvent => ({
  key: "sarhu",
  title: "萨尔浒",
  summary: "",
  region: null,
  date: [1561, 4, 1],
  window: null,
  days_left: 30,
  status: "active",
  campaign: null,
  sides: [],
  balance: null,
  levers: [lever(2)],
  why_hard: [],
  outcome: null,
  basis: null,
  sources: [],
  ...o,
});

describe("历史的天平 → 时间线的短乐句", () => {
  beforeEach(() => {
    useStingRequests.setState({ id: null, seq: 0 });
    useGame.setState({ statics, overview, version: 1, error: null, message: null, selectedLoc: 0, selectedFleet: overview.fleets[0]?.id ?? null });
  });

  it("打开窗口时早就揭晓的事不奏；更新之后一件事揭晓（与史实不同）→ 新的世界线", async () => {
    let tl: TimelineView = { events: [ev({}), ev({ key: "rhodes", title: "罗得岛", status: "resolved", days_left: null, outcome: { key: "o", text: "守住了", historical: false, history: "" } })], deviation: 0, history_on: true };
    installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    await screen.findByTestId("event-sarhu");
    expect(useStingRequests.getState().seq).toBe(0);
    tl = { ...tl, events: [ev({ status: "resolved", days_left: null, outcome: { key: "o", text: "明军胜", historical: false, history: "史实：后金胜" } }), tl.events[1]] };
    nextDay(1);
    await waitFor(() => expect(useStingRequests.getState()).toEqual({ id: "history_win", seq: 1 }));
  });

  it("你出过力的事件离揭晓不到七天 → 沙漏，只奏一次；之后照着史实揭晓 → 功败", async () => {
    let tl: TimelineView = { events: [ev({ days_left: 5 })], deviation: 0, history_on: true };
    installIpc({ timeline: () => tl });
    render(<HistoryPanel />);
    await waitFor(() => expect(useStingRequests.getState()).toEqual({ id: "deadline", seq: 1 }));
    tl = { ...tl, events: [ev({ days_left: 3 })] };
    nextDay(1);
    // 等这一天的时间线真的到了（倒计时变成 3 天），沙漏不再奏第二次
    await screen.findByText("还剩 3 天");
    expect(useStingRequests.getState()).toEqual({ id: "deadline", seq: 1 });
    tl = { ...tl, events: [ev({ status: "resolved", days_left: null, outcome: { key: "o", text: "后金胜", historical: true, history: "" } })] };
    nextDay(2);
    await waitFor(() => expect(useStingRequests.getState()).toEqual({ id: "history_loss", seq: 2 }));
  });
});
