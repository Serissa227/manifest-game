// 奥米奇卡瓦兹特利（阿兹特克的骨刮，omichicahuaztli：“骨头做的响器”）：一根长骨（鹿骨，也有人骨）上刻满一道道横槽，
// 用海螺壳或骨片刮；底下常垫着头骨或葫芦当共鸣腔，祭祀与悼亡的歌舞里用。
// 槽比刮瓜宽、刻得深：刮出来是一下下分得清的“咯—咯—咯”（每秒 30 来下，刮瓜 72 下），骨头硬，每一下短而脆，两下之间几乎没有摩擦声；
// 共鸣腔给每一下都带上一声“空”（刮奏层的 body：820 Hz 的窄带通）。长的一刮顺着整根骨头（omichicahuaztli），短的一刮只刮几道（omichicahuaztli_short）。
import type { RegionalDef } from "./types";

export const OMICHICAHUAZTLI: RegionalDef = {
  region: "mexica",
  name: { zh: "奥米奇卡瓦兹特利骨刮", en: "Omichicahuaztli (bone rasp)" },
  drums: {
    omichicahuaztli: { layers: [{ kind: "rasp", lo: 1400, hi: 6500, rate: 32, dur: 0.44, click: 0.005, level: 1, jitter: 0.12, floor: 0.12, body: [820, 7, 1.4] }], vary: 0.02 },
    omichicahuaztli_short: { layers: [{ kind: "rasp", lo: 1500, hi: 7000, rate: 34, dur: 0.13, click: 0.005, level: 0.9, jitter: 0.12, floor: 0.12, body: [820, 7, 1.4] }], vary: 0.02 },
  },
  // 长刮一下（一拍半），后面两下短刮；最后一长刮
  demo: { key: "C major", qpm: 84, bars: 3, drum: [{ steps: "L..s.s..L..s.s..L.......", hits: { L: ["omichicahuaztli", 0.85], s: ["omichicahuaztli_short", 0.6] } }] },
};
