// 巴拉丰（西非曼丁的木琴）：红木的琴键排在架子上，下面吊着大小不一的葫芦，葫芦上蒙着蜘蛛卵囊的薄膜——
// 一敲就“嗞”地嗡，比刚果的马丁巴更亮、更炸，余音更短。两根带橡胶头的槌，右手奏旋律、左手打低音的固定型，
// 快速的颤音（!trem!）与重复音是它的本色。传说曼丁帝国的松迪亚塔时代就有它（“索索·巴拉”）。
import type { RegionalDef } from "./types";

export const BALAFON: RegionalDef = {
  key: "balafon",
  region: "guinea",
  name: { zh: "巴拉丰（曼丁木琴）", en: "Balafon" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 0.42], [3.4, 0.3, 0.09], [7.6, 0.08, 0.03]],
      attack: 0.0012,
      strike: [0.28, 0.0025, 4500],
      tilt: 0.3,
      buzz: { at: 0.25, level: 3, hp: 1000, fade: 0.5 },
      max: 1.2,
    },
    // 校准：按积分响度要 1.75 才与马林巴一样响，但膜的嗡让起音的峰值高得多（与科拉琴齐奏时峰值超过 −3 dBFS），取 1.4
    level: 1.4,
    release: 0.35,
    roll: 14,
  },
  // 右手的旋律在上、左手的固定低音在下，快速的重复音
  demo: { key: "G major", qpm: 112, bars: 4, abc: "G,/2D/2 G/2B/2 d/2d/2 B G/2B/2 d/2e/2 d A | G,/2D/2 G/2B/2 d/2d/2 e g/2e/2 d/2B/2 A G | E,/2B,/2 E/2G/2 A/2A/2 G E/2G/2 A/2B/2 A G | !trem!G4 z4" },
};
