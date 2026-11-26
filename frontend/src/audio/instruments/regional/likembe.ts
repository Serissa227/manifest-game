// 利肯贝（刚果的拇指琴，sanza 一族）：比东非海岸的小拇指琴大、低，铁片装在木箱上，每根铁片上缠着小铁环、箱上钉着瓶盖一类的响片——
// 嗡嗡沙沙的杂响不是毛病，是这件乐器的灵魂。两只拇指一左一右地交替拨，几个音的短句一圈圈地转，人一边弹一边唱。
// 与斯瓦希里的 kalimba 分开登记：音区更低、铁环更响、带一点铁片本身的“嗡”。
import type { RegionalDef } from "./types";

export const LIKEMBE: RegionalDef = {
  key: "likembe",
  region: "kongo",
  name: { zh: "利肯贝（刚果拇指琴）", en: "Likembe" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 1.9], [5.1, 0.14, 0.22], [6.65, 0.08, 0.15], [11.6, 0.03, 0.05]],
      attack: 0.0015,
      strike: [0.12, 0.003, 4200],
      tilt: 0.3,
      rattle: { level: 0.5, lo: 1800, hi: 7000, gate: 0.05 },
      buzz: { at: 0.5, level: 0.8, hp: 1500, fade: 0.4 },
      max: 2.6,
    },
    level: 0.95,
    release: 0.9,
  },
  // 两只拇指交替：低音与高音一来一回（G 上的五声）
  demo: { key: "G major", qpm: 104, bars: 4, abc: "G, d B, e D B A, d | G, d B, g D B E d | G, d B, e D B A, d | [G,G]4 z4" },
};
