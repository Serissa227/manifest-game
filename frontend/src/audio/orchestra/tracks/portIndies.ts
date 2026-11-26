// 《总督辖区的广场》管弦版（新大陆沿岸的城镇的第二首，G 大调 6/8）：广场上的乐器领奏
// （肖姆管、奇里米亚、高音竖笛、陶笛、维韦拉琴的扫弦、巴洪管、韦韦特尔鼓、葫芦沙铃、小鼓——与合成版共用这些声部），
// 管弦只做衬底：真的竖琴分解和弦，第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_INDIES as SYNTH } from "../../tracks/portIndies";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_INDIES: TrackDef = {
  id: "port_indies",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.04,
  voices: {
    ...pick(SYNTH.voices, ["shawm", "chir", "recs", "oca", "vstrum", "bajon", "hueh", "son", "tamb"]),
    harpp: pulse("o.harp", 0.2, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 5 . .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . 1 . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { hp: "harpp", pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
