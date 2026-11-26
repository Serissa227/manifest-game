// 《霍尔木兹的丝毯》：波斯的港口（霍尔木兹、甘伦（阿巴斯港）、布什尔、锡拉夫……丝毯、绿松石与玫瑰水的码头），也给波斯的内地城市用。
// 寰宇世界里是霍尔木兹王国（霍尔木兹岛与它治下的佐法尔、尤尔法、巴林）与萨法维的伊斯法罕（两个势力的 style 写 persian，见 zones.ts 的 PORT_STYLE_TRACK）。
// 地方特色第二阶段新曲：地方乐器领奏（复古合成版的衬底只有合成的持续音与很轻的拨奏，管弦版里换成很轻的管弦）。
// C 上的查哈尔加调（达斯特加）：C、koron 的 D（降约四分之一音）、E、F、G、koron 的 A、B——D 与 A 都“低一点”，
// 二、三级与六、七级之间各隔约 250 音分，庄重、明亮，是波斯音乐里最“英武”的一个调；6/8 拍，每分钟 104 拍（附点四分音符约 69）。
// 照波斯古典音乐一场演奏的次序写：
// - 前奏曲（皮什达拉马德）：塔尔琴、桑图尔与卡曼恰异音齐奏一条庄重的 6/8 旋律，东巴克鼓打稳稳的“通 · · 巴克 · 巴克”；
// - 阿瓦兹（无固定节拍的“唱”，放慢）：卡曼恰在 C–G 的持续音上像人一样唱（从下面滑上去、塔赫里尔的倚音、深揉），
//   桑图尔在空处“回答”（贾瓦卜：把刚唱的一句用轮奏接过来），不打鼓；第二遍由奈伊笛唱；
// - 四击（查哈尔梅兹拉卜，加快）：桑图尔的旋律音与持续音 G 一下一下地交替（波斯桑图尔最有名的炫技曲式），塔尔琴在上面长音轮拨，东巴克鼓滚指；
// - 伦格（舞曲）：长—短的 6/8 舞步，全体，达夫框鼓的铁环一下下“哗”；第二遍赛塔尔琴领前奏；
// - 回落（福鲁德）：一句落回主音 C 的收束。
// 波斯古典音乐没有和声：底下只有空五度的持续音（C–G）。
import type { TrackDef } from "../score";

export const PORT_PERSIA: TrackDef = {
  id: "port_persia",
  title: { zh: "霍尔木兹的丝毯", en: "The Carpet Bazaar of Hormuz" },
  qpm: 104,
  meter: [6, 8],
  key: "C chahargah",
  voices: {
    santur: { inst: "santur", gain: 0.4, pan: 0.26, reverb: 0.3 },
    tar: { inst: "tar", gain: 0.5, pan: -0.18, reverb: 0.26 },
    setar: { inst: "setar", gain: 0.56, pan: -0.1, reverb: 0.3 },
    kamancheh: { inst: "kamancheh", gain: 0.5, pan: 0.12, reverb: 0.34 },
    nay: { inst: "nay", gain: 0.5, pan: 0.04, reverb: 0.4 },
    tombak: {
      inst: "perc",
      gain: 0.32,
      pan: 0.06,
      reverb: 0.22,
      pattern: {
        pish: { kind: "drum", steps: "T..b.bT..bpb", hits: { T: ["tombak_tom", 0.75], b: ["tombak_bak", 0.55], p: ["tombak_pelang", 0.4] } },
        chahar: { kind: "drum", steps: "TrbTbbTrbTpr", hits: { T: ["tombak_tom", 0.75], b: ["tombak_bak", 0.5], r: ["tombak_riz", 0.4], p: ["tombak_pelang", 0.45] } },
        reng: { kind: "drum", steps: "T.bTb.T.bTbr", hits: { T: ["tombak_tom", 0.78], b: ["tombak_bak", 0.55], r: ["tombak_riz", 0.4] } },
        forud: { kind: "drum", steps: "T.bT.bT.....", hits: { T: ["tombak_tom", 0.8], b: ["tombak_bak", 0.55] } },
      },
    },
    daf: {
      inst: "perc",
      gain: 0.26,
      pan: -0.24,
      reverb: 0.3,
      pattern: {
        reng: { kind: "drum", steps: "D..t..D..tr.", hits: { D: ["daf_dum", 0.7], t: ["daf_tak", 0.5], r: ["daf_ring", 0.35] } },
        forud: { kind: "drum", steps: "D.....D.....", hits: { D: ["daf_dum", 0.75] } },
      },
    },
    // 衬底（合成）：空五度的持续音、每小节一下很轻的拨奏
    dem: { inst: "drone", gain: 0.17, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 48, high: 67, size: 2 } },
    bass: { inst: "pizz", gain: 0.22, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . . . .", ring: 3 } },
  },
  sections: {
    pish: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | C5 | C5 | C5 | C5",
      lines: { pd: "G3 A B c | c2 B A G2 | E3 F G A | G6 | c3 d e d | c2 B A B c | G2 F E D E | C6" },
    },
    avaz: {
      bars: 6,
      chords: "C5 | C5 | C5 | C5 | C5 | G5",
      lines: {
        voc: "!bend!G4 {A}G F | !vib!E6 | z6 | (E F) {A}G A !bend!B2 | !vib!c4 B A | !fall!G6",
        jav: "z6 | z3 G F E | !trem!E3 F E D | z6 | z6 | z3 B A G",
      },
    },
    chahar: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | C5 | C5 | C5 | C5",
      lines: {
        ch: "c G d G e G | f G e G d G | e G d G c G | B G A G B G | c G e G g G | f G e G d G | e G d G B G | c G c G c2",
        hold: "c3 e3 | f3 d3 | e3 c3 | B3 A3 | c3 g3 | f3 d3 | e3 B3 | c6",
      },
    },
    reng: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | C5 | C5 | C5 | C5",
      lines: { rg: "C2 D E2 F | G2 F E2 D | E2 F G2 A | B2 A G3 | c2 B c2 d | e2 d c2 B | A2 G F2 E | D2 E C3" },
    },
    forud: {
      bars: 2,
      chords: "C5 | C5",
      lines: { fd: "G2 F E D C | C3 z3" },
    },
  },
  forms: [
    [
      { s: "pish", play: "pd:tar pd:santur pd:kamancheh tombak.pish dem bass", dyn: 0.68 },
      { s: "avaz", play: "voc:kamancheh jav:santur dem", dyn: 0.62, tempo: 0.85 },
      { s: "chahar", play: "ch:santur hold:tar tombak.chahar dem bass", dyn: 0.72, tempo: 1.1 },
      { s: "reng", play: "rg:tar rg:santur rg:kamancheh tombak.reng daf.reng dem bass", dyn: 0.74 },
      { s: "forud", play: "fd:tar fd:santur fd:kamancheh tombak.forud daf.forud dem", dyn: 0.7, rit: 0.88 },
    ],
    [
      { s: "pish", play: "pd:setar pd:santur pd:nay tombak.pish dem bass", dyn: 0.66 },
      { s: "avaz", play: "voc:nay jav:setar dem", dyn: 0.6, tempo: 0.85 },
      { s: "reng", play: "rg:kamancheh rg:santur rg:tar-12 tombak.reng daf.reng dem bass", dyn: 0.72 },
      { s: "chahar", play: "ch:santur hold:kamancheh tombak.chahar dem bass", dyn: 0.74, tempo: 1.1 },
      { s: "reng", play: "rg:tar rg:santur rg:kamancheh rg:nay tombak.reng daf.reng dem bass", dyn: 0.76 },
      { s: "forud", play: "fd:tar fd:santur fd:kamancheh tombak.forud daf.forud dem", dyn: 0.7, rit: 0.88 },
    ],
  ],
  rest: [10, 18],
  level: 1.02,
};
