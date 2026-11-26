// 《乳香与咖啡的码头》：阿拉伯的港口（吉达、摩卡、亚丁、马斯喀特、巴士拉）与马穆鲁克的埃及（开罗、亚历山大、杜姆亚特）——乳香、咖啡与香料的码头。
// 寰宇世界里这些城多在奥斯曼（汉志、也门、巴士拉）或葡萄牙（马斯喀特）治下，按势力的风格只会放金角湾或伊比利亚的曲子；
// zones.ts 的 PORT_SEA_TRACK 按停泊的海认：红海、亚丁湾、波斯湾、阿拉伯海（music 写 arabic）上奥斯曼、伊比利亚与沙漠风格的港口放这首
// （苏伊士、吉达、摩卡、亚丁、巴士拉、马斯喀特、阿达尔的泽拉）。开罗、亚历山大与霍尔木兹王国的佐法尔、尤尔法、巴林眼下随势力放别的曲子，
// 要等地点自己的文化给到前端（见 docs/DECISIONS.md 2026-10-11 配乐的数据接线）。
// 地方特色第二阶段新曲：地方乐器领奏（复古合成版的衬底用合成的持续音与拨奏低音，管弦版里换成很轻的管弦）。
// C 上的拉斯特木卡姆（C D 降半个半音的 E F G A 降半个半音的 B：中立的三度与七度；下行常经过降 B，即 G 上的纳哈万德），每分钟 104 拍；
// 写成开罗“塔赫特”小乐队（乌德琴、卡农琴、奈伊笛、竖拉提琴、里克鼓、达布卡）的一组“瓦斯拉”（同一个木卡姆里换几种节奏的组曲）：
// - 塔克西姆：卡农琴在 C–G 的持续音上即兴（快速的上下行、长音的轮指），不打鼓；
// - 拉齐玛（叠句）：全体齐奏的一句短而有力的器乐叠句，里克鼓与达布卡打马克苏姆（咚 嗒 · 嗒 咚 · 嗒 ·）；
// - 歌：奈伊笛与低八度的乌德琴“异音齐奏”（各自加花的同一条旋律），像一首穆瓦沙哈；
// - 萨马伊：换成萨马伊·塔基勒（10/8：咚 · · 嗒 · 咚 咚 嗒 · ·）——曲式的拍号是 4/4，这一段的鼓与低音按 10 个八分音符一轮循环，
//   旋律按 10/8 的句法写（每轮的第一拍落长音，跨过 4/4 的小节线用连音线连起来；五小节正好四轮），卡农琴与竖拉提琴领奏；
// - 萨伊迪（第二遍）：上埃及的户外乐队——两支米兹玛尔（一高一低异音齐奏）、塔布勒大鼓打萨伊迪节奏（咚 嗒 · 咚 咚 · 嗒 ·）、众人拍手；
// - 海湾（第二遍）：红海与海湾的码头（吉达、摩卡、亚丁、马斯喀特）——西姆西米亚琴（红海的竖琴）扫着弦领奏、乌德琴低八度跟着，
//   米尔瓦斯小鼓与贾赫拉陶罐打 3 + 3 + 2 的跛足拍子，众人在每一组的末尾拍手（海湾的“萨乌特”与采珠船歌那样）；
// - 收束（加夫拉）：齐奏落回主音，里克鼓整面一摇。
// 和声不用西洋的和弦：只有空五度的持续音（C–G，旋律停在 G 上时换 G–D）。竖拉提琴用波斯的卡曼恰（埃及的“卡曼贾”在小提琴传入以前就是这种竖拉的尖脚提琴）。
import type { TrackDef } from "../score";

export const PORT_ARABIA: TrackDef = {
  id: "port_arabia",
  title: { zh: "乳香与咖啡的码头", en: "Wharf of Frankincense and Coffee" },
  qpm: 104,
  meter: [4, 4],
  key: "C rast",
  voices: {
    ud: { inst: "ud", gain: 0.6, pan: -0.16, reverb: 0.24 },
    kanun: { inst: "kanun", gain: 0.42, pan: 0.28, reverb: 0.26 },
    nay: { inst: "nay", gain: 0.5, pan: 0.1, reverb: 0.36 },
    kamancheh: { inst: "kamancheh", gain: 0.42, pan: 0.2, reverb: 0.3 },
    mizmar: { inst: "mizmar", gain: 0.36, pan: -0.08, reverb: 0.3 },
    mizmar2: { inst: "mizmar", gain: 0.26, pan: 0.12, reverb: 0.3 },
    riq: {
      inst: "perc",
      gain: 0.3,
      pan: -0.26,
      reverb: 0.22,
      pattern: {
        maqsum: { kind: "drum", steps: "DT.TD.T.DTkTD.Tk", hits: { D: ["riq_dum", 0.7], T: ["riq_tak", 0.55], k: ["riq_ka", 0.32] } },
        samai: { kind: "drum", steps: "D.kTkDDTk.", hits: { D: ["riq_dum", 0.7], T: ["riq_tak", 0.55], k: ["riq_ka", 0.3] } },
        saidi: { kind: "drum", steps: ".k.k.k.k.k.kTkSk", hits: { k: ["riq_ka", 0.32], T: ["riq_tak", 0.5], S: ["riq_sak", 0.45] } },
        qafla: { kind: "drum", steps: "DT.TD.T.S.......", hits: { D: ["riq_dum", 0.7], T: ["riq_tak", 0.55], S: ["riq_sak", 0.7] } },
      },
    },
    darb: {
      inst: "perc",
      gain: 0.3,
      pan: 0.08,
      reverb: 0.22,
      pattern: {
        maqsum: { kind: "drum", steps: "DT.TD.T.DT.TD.kT", hits: { D: ["darb_doum", 0.75], T: ["darb_tek", 0.55], k: ["darb_ka", 0.35] } },
        samai: { kind: "drum", steps: "D..T.DDT..", hits: { D: ["darb_doum", 0.75], T: ["darb_tek", 0.55] } },
        qafla: { kind: "drum", steps: "DT.TD.T.D.......", hits: { D: ["darb_doum", 0.8], T: ["darb_tek", 0.55] } },
      },
    },
    simsimiyya: { inst: "simsimiyya", gain: 0.5, pan: 0.2, reverb: 0.26 },
    tabl: { inst: "perc", gain: 0.3, pan: 0.02, reverb: 0.28, pattern: { kind: "drum", steps: "DT.DD.T.DT.DD.TT", hits: { D: ["tabl_dum", 0.75], T: ["tabl_tak", 0.55] } } },
    // 海湾的 3 + 3 + 2：米尔瓦斯打骨架，陶罐压在每小节的第一组与最后一组上，拍手在每一组的末尾
    mirwas: { inst: "perc", gain: 0.3, pan: 0.12, reverb: 0.24, pattern: { kind: "drum", steps: "D..T..T.D..T.TT.", hits: { D: ["mirwas_dum", 0.72], T: ["mirwas_tak", 0.55] } } },
    jahlah: { inst: "perc", gain: 0.3, pan: -0.1, reverb: 0.26, pattern: { kind: "drum", steps: "J.....J.J..t..t.", hits: { J: ["jahlah", 0.72], t: ["jahlah_tak", 0.5] } } },
    claps: {
      inst: "perc",
      gain: 0.24,
      pan: 0.3,
      reverb: 0.3,
      pattern: {
        saidi: { kind: "drum", steps: "..P...P...P..PP.", hits: { P: ["tasfiq", 0.5] } },
        khaliji: { kind: "drum", steps: "..P..L.P..P..L.P", hits: { P: ["tasfiq", 0.5], L: ["tasfiq_low", 0.48] } },
      },
    },
    // 衬底（合成）：空五度的持续音、拨奏的低音落在“咚”上（萨马伊一段按 10/8 循环）
    dem: { inst: "drone", gain: 0.16, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 48, high: 67, size: 2 } },
    bass: {
      inst: "pizz",
      gain: 0.28,
      pan: 0.06,
      reverb: 0.15,
      pattern: {
        maqsum: { kind: "arp", low: 36, steps: "1 . . . 1 . . .", ring: 2 },
        samai: { kind: "arp", low: 36, steps: "1 . . . . 1 1 . . .", ring: 2 },
        saidi: { kind: "arp", low: 36, steps: "1 . . 1 1 . . .", ring: 2 },
        khaliji: { kind: "arp", low: 36, steps: "1 . . 1 . . 1 .", ring: 2 },
      },
    },
  },
  sections: {
    taqsim: {
      bars: 4,
      chords: "C5 | C5 | C5 | C5",
      lines: { tq: "C2 D E F2 {A}G F | E/2F/2G/2A/2 G6 | A/2B/2c/2d/2 c _B A G F E | D2 {E}D C C4" },
    },
    lazima: {
      bars: 4,
      chords: "C5 | C5 | G5 | C5",
      lines: { lz: "G2 A/2G/2F E/2F/2 G E D | E F G F E D C2 | c2 _B A G A _B c | _B A G F E D C2" },
    },
    song: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | G5 | G5 | C5 | C5",
      lines: { sg: "C2 D E F2 E D | E F G {B}A G2 F E | F2 E D E F G A | !vib!G6 z2 | A2 B c {e}d2 c B | c2 _B A G F E F | G2 E D {F}E F D E | C6 z2" },
    },
    // 萨马伊·塔基勒：八轮 10/8（80 个八分音符）写在十小节 4/4 里，第一拍落在每轮开头（0、10、20……）
    samai: {
      bars: 10,
      chords: "C5 | C5 | C5 | C5 | C5 | C5 | C5 | C5 | C5 | C5",
      lines: { sm: "G3 F E F2 G- | G A !accent!G4 E D | C4 !accent!D3 E | F G2 A2 B !accent!c2- | c2 B A G4 | !accent!A3 B c d2 c- | c B !accent!c3 _B A G- | G F2 E !accent!F3 E | D E2 F2 D !accent!C2- | C4 z4" },
    },
    saidi: {
      bars: 8,
      chords: "C5 | C5 | G5 | G5 | C5 | C5 | C5 | C5",
      lines: { sa: "G2 {A}G F E2 D E | F G A G !vib!F4 | G A B c d2 c B | c2 B A !vib!G4 | G2 {A}G F E2 D E | F G A G F E D E | F2 E D E F G E | D2 E D !fall!C4" },
    },
    // 海湾：每小节按 3 + 3 + 2 分组（同一个音扫两下的西姆西米亚音型），前四小节停在 D 上，后四小节落回 C
    khaliji: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | C5 | C5 | C5 | C5",
      lines: { kh: "G G A G F E D E | F2 G A2 G G2 | A A c A G F E F | G3 F E D D2 | c c d c B A G A | B2 c d2 c c2 | A A G F G A G F | E3 F E D C2" },
    },
    qafla: {
      bars: 2,
      chords: "C5 | C5",
      lines: { qf: "G A G F E D C2 | C2 z6" },
    },
  },
  forms: [
    [
      { s: "taqsim", play: "tq:kanun dem", dyn: 0.62 },
      { s: "lazima", play: "lz:ud-12 lz:kanun lz:nay lz:kamancheh riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.72 },
      { s: "song", play: "sg:nay sg:ud-12 riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.66 },
      { s: "samai", play: "sm:kanun sm:kamancheh sm:ud-12 riq.samai darb.samai dem bass.samai", dyn: 0.68 },
      { s: "lazima", play: "lz:ud-12 lz:kanun lz:nay lz:kamancheh riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.74 },
      { s: "qafla", play: "qf:ud-12 qf:kanun qf:nay qf:kamancheh riq.qafla darb.qafla dem", dyn: 0.72, rit: 0.9 },
    ],
    [
      { s: "lazima", play: "lz:ud-12 lz:kanun lz:nay riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.7 },
      { s: "saidi", play: "sa:mizmar sa:mizmar2-12 tabl claps.saidi riq.saidi dem bass.saidi", dyn: 0.74 },
      { s: "song", play: "sg:kamancheh sg:kanun sg:ud-12 riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.66 },
      { s: "khaliji", play: "kh:simsimiyya kh:ud-12 mirwas jahlah claps.khaliji dem bass.khaliji", dyn: 0.74 },
      { s: "lazima", play: "lz:ud-12 lz:kanun lz:nay lz:kamancheh riq.maqsum darb.maqsum dem bass.maqsum", dyn: 0.74 },
      { s: "qafla", play: "qf:ud-12 qf:kanun qf:nay qf:kamancheh riq.qafla darb.qafla dem", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.12,
};
