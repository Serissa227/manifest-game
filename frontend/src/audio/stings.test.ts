// 时间线的短乐句什么时候奏（audio/stings.ts）：揭晓的三种结果、期限迫近只奏一次、刚打开窗口时不把早就揭晓的事当新的、
// 同一刻只奏优先级最高的一个、事件对话框里历史事件的成败、请求的计数。
import { describe, expect, it } from "vitest";
import type { LeverView, StoryResultView, TimelineEvent, TimelineView } from "../ipc/types";
import { DEADLINE_DAYS, requestSting, storySting, timelineSting, useStingRequests } from "./stings";

const lever = (yours: number): LeverView => ({
  key: "l",
  side: "a",
  kind: "money",
  label: "",
  where: null,
  goods: [],
  progress: { points: yours, max: 10 },
  yours,
  risk: null,
  note: null,
  action: "money",
  enabled: true,
});

const ev = (key: string, o: Partial<TimelineEvent> = {}): TimelineEvent => ({
  key,
  title: key,
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
  ...o,
});

const tl = (...events: TimelineEvent[]): TimelineView => ({ events, deviation: 0, history_on: true });
const resolved = (key: string, historical: boolean, levers: LeverView[] = []): TimelineEvent =>
  ev(key, { status: "resolved", days_left: null, levers, outcome: { key: "o", text: "", historical, history: "" } });
const none = new Set<string>();

describe("历史的天平：揭晓", () => {
  it("结果与史实不同 → 新的世界线；照着史实而你出过力 → 功败；照着史实、你没插手 → 史书照旧", () => {
    expect(timelineSting(tl(ev("a")), tl(resolved("a", false)), none).sting).toBe("history_win");
    expect(timelineSting(tl(ev("a", { levers: [lever(3)] })), tl(resolved("a", true, [lever(3)])), none).sting).toBe("history_loss");
    expect(timelineSting(tl(ev("a", { levers: [lever(0)] })), tl(resolved("a", true, [lever(0)])), none).sting).toBe("history_as_is");
  });

  it("刚打开窗口（没有上一次）时，早就揭晓的事不算；已经揭晓过的事再更新也不算", () => {
    expect(timelineSting(null, tl(resolved("a", false)), none).sting).toBeNull();
    expect(timelineSting(tl(resolved("a", false)), tl(resolved("a", false)), none).sting).toBeNull();
    // 没有结果的揭晓（数据不全）不奏
    expect(timelineSting(tl(ev("a")), tl(ev("a", { status: "resolved" })), none).sting).toBeNull();
  });

  it("同一刻有几件事只奏优先级最高的一个：新的世界线 > 功败 > 史书照旧 > 沙漏", () => {
    const prev = tl(ev("a", { levers: [lever(1)] }), ev("b"), ev("c", { levers: [lever(2)], days_left: 20 }));
    const next = tl(resolved("a", true, [lever(1)]), resolved("b", false), ev("c", { levers: [lever(2)], days_left: 3 }));
    const r = timelineSting(prev, next, none);
    expect(r.sting).toBe("history_win");
    expect(r.warn).toEqual(["c"]);
  });
});

describe("历史的天平：期限迫近", () => {
  it(`你出过力的事件进行中、离揭晓不到 ${DEADLINE_DAYS} 天 → 沙漏；每件事只奏一次（第一次打开窗口时也算）`, () => {
    const near = ev("a", { levers: [lever(2)], days_left: DEADLINE_DAYS });
    const first = timelineSting(null, tl(near), none);
    expect(first).toEqual({ sting: "deadline", warn: ["a"] });
    expect(timelineSting(tl(near), tl({ ...near, days_left: 2 }), new Set(first.warn)).sting).toBeNull();
  });

  it("没出过力、还远、或者还没开始的事件不奏", () => {
    expect(timelineSting(null, tl(ev("a", { days_left: 2 })), none).sting).toBeNull();
    expect(timelineSting(null, tl(ev("a", { levers: [lever(2)], days_left: DEADLINE_DAYS + 1 })), none).sting).toBeNull();
    expect(timelineSting(null, tl(ev("a", { levers: [lever(2)], days_left: 2, status: "future" })), none).sting).toBeNull();
    expect(timelineSting(null, tl(ev("a", { levers: [lever(2)], days_left: null })), none).sting).toBeNull();
  });
});

describe("事件对话框：历史事件的成败", () => {
  const result = (o: Partial<StoryResultView> & { kind?: string } = {}): StoryResultView =>
    ({ day: 10, kind: "history", key: "k", title: "", choice: null, reply: "", success: true, outcomes: [], speaker: { name: "" }, ended: false, ...o }) as unknown as StoryResultView;

  it("新的一条、种类为 history：成功 → 新的世界线，失败 → 功败；没有成败、别的种类、同一条都不奏", () => {
    expect(storySting(null, result())).toBe("history_win");
    expect(storySting(null, result({ success: false }))).toBe("history_loss");
    expect(storySting(null, result({ success: null }))).toBeNull();
    expect(storySting(null, result({ kind: "chapter" }))).toBeNull();
    expect(storySting(result(), result())).toBeNull();
    expect(storySting(result({ day: 9 }), result())).toBe("history_win");
    expect(storySting(result(), null)).toBeNull();
  });
});

describe("请求", () => {
  it("每次请求计数加一（同一个短乐句连着要两次也分得出来）", () => {
    const before = useStingRequests.getState().seq;
    requestSting("deadline");
    requestSting("deadline");
    expect(useStingRequests.getState()).toEqual({ id: "deadline", seq: before + 2 });
  });
});
