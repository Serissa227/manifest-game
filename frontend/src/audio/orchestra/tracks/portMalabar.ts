// 《豆蔻山下的港》管弦版：地方乐器领奏（萨拉斯瓦蒂维纳琴、纳达斯瓦拉姆、奥图、水碗、伊达卡、坦布拉，姆里丹加姆、甘吉拉、陶罐鼓、
// 塔维尔、小钹、琴达——与合成版共用这些声部），管弦只做衬底：大提琴组在低处拉萨（E）的长音，拨奏在每轮的第一拍与第五拍（拍手的拍）轻轻点一下萨与帕，
// 中提琴与高处的小提琴很轻地拉 E–B 空五度，像坦布拉的光。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MALABAR as SYNTH } from "../../tracks/portMalabar";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_MALABAR: TrackDef = {
  id: "port_malabar",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["veena", "vtala", "nadas", "ottu", "jalt", "edakka", "tanpura", "mr", "ml", "kanj", "ghat", "thav", "talam", "che", "chv"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . . . .", 40, 8)),
    vcp: pulse("o.vc.pizz", 0.14, SEAT.vc, WET.low, bass("1 . . . . . . . 5 . . . . . . .", 40, 2)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 59, 71, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 76, 88, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc vcp" }),
  rest: SYNTH.rest,
  level: 1.37,
};
