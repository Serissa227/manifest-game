// 朗格莱克琴（挪威的 langeleik，瑞典与丹麦的“hummel”同一族：长条的齐特琴，一根旋律弦下面有品，另外六七根空弦一直调在主和弦上）：
// 右手拨片来回扫过所有的弦，左手只在旋律弦上走音——一片明亮的金属扫弦，空弦被带着嗡嗡地响（共鸣弦调在 D 小调的 D、A、d、f、a 上）。
import type { RegionalDef } from "./types";

export const LANGELEIK: RegionalDef = {
  key: "langeleik",
  region: "north_europe",
  name: { zh: "朗格莱克琴（挪威）", en: "Langeleik (Norwegian drone zither)" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.4,
      tilt: 0.45,
      bright: 0.88,
      pick: 0.1,
      damp: 0.08,
      thump: 0.07,
      body: [[240, 1.2, 3], [1200, 1.2, 2], [3300, 1, 3]],
      sympathetic: { notes: [50, 57, 62, 65, 69], level: 0.007, t60: 2 },
      lp: 10000,
      max: 3.5,
      onset: 0.002,
    },
    level: 0.78,
  },
  // 扫弦：持续的空弦和弦上，旋律弦一步一步走
  demo: { key: "D minor", qpm: 100, bars: 3, abc: "[D,A,D]2 [D,A,F]2 [D,A,D]2 [D,A,E]2 | [D,A,F]2 [D,A,G]2 [D,A,A]4 | [D,A,F]2 [D,A,E]2 [D,A,D]4" },
};
