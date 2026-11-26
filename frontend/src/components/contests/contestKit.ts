// 比赛的小游戏（FRAMEWORK §7.10，docs/UI-CONTRACT.md I6 追加）的纯逻辑：把 ContestView.params 按种类读成有类型的参数（缺字段时给空的安全值），
// 以及各小游戏在界面上的即时反馈（翻牌配对、节奏的判定、辩论的克制、辨识的进度）。名次一律由后端按种子与输入算，这里不算名次。
import type { ContestView } from "../../ipc/types";

export interface MatchParams {
  cols: number;
  rows: number;
  faces: string[];
  flips: number;
}
export interface PoemParams {
  theme: string;
  lines: { prompt: string; options: string[] }[];
  hints: string[];
}
export interface RhythmParams {
  bpm: number;
  beats: number[];
  window: number;
}
export interface DebateParams {
  topic: string;
  rounds: { opponent: { text: string; kind: string } }[];
  hand: { key: string; text: string; kind: string }[];
  beats: [string, string][];
}
export interface RaceParams {
  legs: { text: string; options: { key: string; text: string; risk: number }[] }[];
}
export interface IdentifyParams {
  samples: { key: string; clues: string[] }[];
  answers: { key: string; name: string }[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function matchParams(c: Pick<ContestView, "params">): MatchParams {
  const p = c.params;
  const faces = arr<string>(p.faces).map(String);
  const cols = Math.max(1, num(p.cols, Math.ceil(Math.sqrt(faces.length || 1))));
  return { cols, rows: Math.max(1, num(p.rows, Math.ceil(faces.length / cols))), faces, flips: Math.max(1, num(p.flips, faces.length)) };
}
export function poemParams(c: Pick<ContestView, "params">): PoemParams {
  const p = c.params;
  return { theme: str(p.theme), lines: arr<{ prompt: string; options: string[] }>(p.lines).map((l) => ({ prompt: str(l?.prompt), options: arr<string>(l?.options).map(String) })), hints: arr<string>(p.hints).map(String) };
}
export function rhythmParams(c: Pick<ContestView, "params">): RhythmParams {
  const p = c.params;
  return { bpm: num(p.bpm, 90), beats: arr<number>(p.beats).filter((x) => Number.isFinite(x)), window: num(p.window, 150) };
}
export function debateParams(c: Pick<ContestView, "params">): DebateParams {
  const p = c.params;
  return {
    topic: str(p.topic),
    rounds: arr<{ opponent: { text: string; kind: string } }>(p.rounds).map((r) => ({ opponent: { text: str(r?.opponent?.text), kind: str(r?.opponent?.kind) } })),
    hand: arr<{ key: string; text: string; kind: string }>(p.hand).map((h) => ({ key: str(h?.key), text: str(h?.text), kind: str(h?.kind) })),
    beats: arr<[string, string]>(p.beats).filter((b) => Array.isArray(b) && b.length === 2).map((b) => [String(b[0]), String(b[1])] as [string, string]),
  };
}
export function raceParams(c: Pick<ContestView, "params">): RaceParams {
  return {
    legs: arr<{ text: string; options: { key: string; text: string; risk: number }[] }>(c.params.legs).map((l) => ({
      text: str(l?.text),
      options: arr<{ key: string; text: string; risk: number }>(l?.options).map((o) => ({ key: str(o?.key), text: str(o?.text), risk: num(o?.risk, 0) })),
    })),
  };
}
export function identifyParams(c: Pick<ContestView, "params">): IdentifyParams {
  return {
    samples: arr<{ key: string; clues: string[] }>(c.params.samples).map((s) => ({ key: str(s?.key), clues: arr<string>(s?.clues).map(String) })),
    answers: arr<{ key: string; name: string }>(c.params.answers).map((a) => ({ key: str(a?.key), name: str(a?.name) })),
  };
}

// ───────────── 配对 ─────────────

export interface MatchState {
  /** 已经配上的格子 */
  matched: boolean[];
  /** 正翻开、还没判定的格子（0–2 个） */
  open: number[];
  /** 用掉的翻牌次数（每次翻两张算一次） */
  used: number;
  /** 输入记录（提交给后端） */
  moves: [number, number][];
}

export function matchStart(p: MatchParams): MatchState {
  return { matched: p.faces.map(() => false), open: [], used: 0, moves: [] };
}

/** 翻开一张：第二张翻开时记一次输入并判定（同面就配上）；已经配上的、正翻开的、次数用完时不动。 */
export function matchFlip(p: MatchParams, s: MatchState, i: number): MatchState {
  if (i < 0 || i >= p.faces.length || s.matched[i] || s.open.includes(i) || s.used >= p.flips) return s;
  if (s.open.length === 2) s = { ...s, open: [] };
  if (s.open.length === 0) return { ...s, open: [i] };
  const a = s.open[0];
  const matched = [...s.matched];
  const same = p.faces[a] === p.faces[i];
  if (same) {
    matched[a] = true;
    matched[i] = true;
  }
  return { matched, open: same ? [] : [a, i], used: s.used + 1, moves: [...s.moves, [a, i]] };
}

export const matchPairs = (s: MatchState): number => s.matched.filter(Boolean).length / 2;
export const matchDone = (p: MatchParams, s: MatchState): boolean => s.used >= p.flips || s.matched.every(Boolean);

// ───────────── 节奏 ─────────────

/** 某次按下与最近的拍点差多少毫秒（没有拍点时为 Infinity）。 */
export function nearestBeat(beats: number[], t: number): { beat: number; diff: number } {
  let best = { beat: -1, diff: Infinity };
  beats.forEach((b, i) => {
    const d = Math.abs(t - b);
    if (d < best.diff) best = { beat: i, diff: d };
  });
  return best;
}

/** 即时的判定文字：窗口的三分之一以内"妙"，窗口以内"好"，其余"偏"。 */
export function rhythmGrade(diff: number, window: number): "perfect" | "good" | "miss" {
  if (diff <= window / 3) return "perfect";
  if (diff <= window) return "good";
  return "miss";
}

// ───────────── 辩论 ─────────────

/** 这一回合（数据给的克制关系）：你的论点压过对方 → 1，被压过 → −1，其余 0。只作即时的提示。 */
export function debateEdge(beats: [string, string][], mine: string, theirs: string): 1 | 0 | -1 {
  if (beats.some(([a, b]) => a === mine && b === theirs)) return 1;
  if (beats.some(([a, b]) => a === theirs && b === mine)) return -1;
  return 0;
}

/** 打准了几拍：照内核（contests/rhythm.rs）的配法——从早到晚，一次按键至多配一个拍点，同一毫秒的重复按键不算。只用来显示，加分以后端为准。 */
export function rhythmHits(beats: number[], window: number, taps: number[]): number {
  let beat = 0;
  let hits = 0;
  taps.forEach((time, i) => {
    if (i > 0 && taps[i - 1] === time) return;
    while (beat < beats.length && beats[beat] + window < time) beat++;
    if (beat < beats.length && Math.abs(beats[beat] - time) <= window) {
      hits++;
      beat++;
    }
  });
  return hits;
}

// ───────────── 通用：逐步选的小游戏 ─────────────

/** 下一步该选哪一步：from 后面第一个还没选的；后面没有就从头找；都选了返回 −1。 */
export function nextOpen<T>(picks: (T | null)[], from: number): number {
  for (let i = from + 1; i < picks.length; i++) if (picks[i] === null) return i;
  for (let i = 0; i <= Math.min(from, picks.length - 1); i++) if (picks[i] === null) return i;
  return -1;
}

/** 按下的是不是选第几项的数字键（1–9，不带 Ctrl / Alt / ⌘）：是就给下标，不是给 null。 */
export function digitKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key)) return null;
  return Number(e.key) - 1;
}

/** 有符号的整数（临场发挥）：+3、0、−2。 */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}
