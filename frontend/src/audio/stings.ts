// 时间线事件的短乐句什么时候奏（纯函数，FRAMEWORK §11，UI-CONTRACT I7）：
// - 历史的天平（HistoryPanel）开着、时间线更新时，比较前后两次：一件事从“未揭晓”变成“已揭晓”——
//   结果与史实不同（historical 为假）→《新的世界线》；结果照着史实、而你为改变它出过力（任何杠杆上有你的份额）→《功败》；
//   照着史实、你没有插手 →《史书照旧》；
// - 你出过力的事件进行中、离揭晓不到 DEADLINE_DAYS 天 →《沙漏》（每件事只奏一次，记在 warned 里；第一次打开窗口时也算）；
// - 事件对话框：故事的结果（Overview.story.last）是一条新的、种类为 history 的结果时，成功 →《新的世界线》、失败 →《功败》（没有成败的新闻不奏）。
// 同一刻有几件事只奏一个：新的世界线 > 功败 > 史书照旧 > 沙漏。真正奏不奏、什么时候奏由配乐导演决定（与出港、入港的短乐句同一套规矩）。
import { create } from "zustand";
import type { StoryResultView, TimelineView } from "../ipc/types";
import type { StingId } from "./tracks/stings";

/** 离揭晓不到这么多天时奏《沙漏》。 */
export const DEADLINE_DAYS = 7;

/** 优先级：同一刻只奏排在前面的一个。 */
export const STING_ORDER: readonly StingId[] = ["history_win", "history_loss", "history_as_is", "deadline"];

/**
 * 时间线前后两次的变化要奏的短乐句。prev 为 null（窗口刚打开）时不算“揭晓”（那些是早就揭晓的），只看期限。
 * warned：已经为期限奏过的事件 key；返回这一次新加进去的。
 */
export function timelineSting(prev: TimelineView | null, next: TimelineView, warned: ReadonlySet<string>): { sting: StingId | null; warn: string[] } {
  const found = new Set<StingId>();
  const warn: string[] = [];
  const before = new Map((prev?.events ?? []).map((e) => [e.key, e]));
  for (const e of next.events) {
    const was = before.get(e.key);
    if (was && was.status !== "resolved" && e.status === "resolved" && e.outcome) {
      const mine = was.levers.some((l) => l.yours > 0) || e.levers.some((l) => l.yours > 0);
      found.add(!e.outcome.historical ? "history_win" : mine ? "history_loss" : "history_as_is");
    }
    if (e.status === "active" && e.days_left !== null && e.days_left <= DEADLINE_DAYS && e.levers.some((l) => l.yours > 0) && !warned.has(e.key)) {
      found.add("deadline");
      warn.push(e.key);
    }
  }
  return { sting: STING_ORDER.find((s) => found.has(s)) ?? null, warn };
}

/** 故事的结果：新的一条、种类为 history、有成败时奏（成功 → 新的世界线，失败 → 功败）。 */
export function storySting(prev: StoryResultView | null | undefined, next: StoryResultView | null | undefined): StingId | null {
  if (!next) return null;
  if (prev && prev.day === next.day && prev.key === next.key) return null;
  if ((next as { kind?: unknown }).kind !== "history" || typeof next.success !== "boolean") return null;
  return next.success ? "history_win" : "history_loss";
}

/** 要奏的短乐句（配乐导演订阅；seq 每次加一，同一个短乐句连着要两次也能分辨）。 */
export const useStingRequests = create<{ id: StingId | null; seq: number }>(() => ({ id: null, seq: 0 }));

/** 请配乐导演奏一个时间线的短乐句（导演按自己的规矩决定奏不奏）。 */
export function requestSting(id: StingId): void {
  useStingRequests.setState((s) => ({ id, seq: s.seq + 1 }));
}
