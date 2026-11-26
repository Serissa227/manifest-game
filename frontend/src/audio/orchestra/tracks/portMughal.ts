// 《红砂岩的宫廷》管弦版：地方乐器领奏（鲁德拉维纳琴、萨朗吉、拉巴卜、谢赫奈、苏尔、坦布拉，帕卡瓦吉、纳卡拉——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉萨（C）的长音，拨奏在每轮的萨姆与第七拍（空拍 khali）轻轻点一下萨与帕，
// 中提琴与高处的小提琴很轻地拉 C–G 空五度。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MUGHAL as SYNTH } from "../../tracks/portMughal";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_MUGHAL: TrackDef = {
  id: "port_mughal",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["rudra", "sarangi", "rabab", "shehnai", "sur", "tanpura", "pr", "pl", "nd", "nt"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . . . . . . . .", 36, 12)),
    vcp: pulse("o.vc.pizz", 0.14, SEAT.vc, WET.low, bass("1 . . . . . . . . . . . 5 . . . . . . . . . . .", 36, 2)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 55, 67, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 72, 84, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc vcp" }),
  rest: SYNTH.rest,
  level: 1.26,
};
