// 《豆蔻山下的港》：马拉巴尔与泰米尔海岸的港口（卡利卡特、科钦、奎隆、讷加帕蒂南……背后是种豆蔻与胡椒的西高止山）。
// 地方特色第二阶段：卡纳提克音乐（南印度）的颜色，地方乐器领奏（复古合成版的衬底只有很轻的合成弦乐长音与大提琴组的萨）。
// 拉格：汉萨德瓦尼（萨 = E：E 升F 升G B 升D——没有四级与六级的五声，明亮、吉祥，音乐会的开场曲常用）；
// 塔拉：阿迪塔拉（八拍一轮：四 + 二 + 二，第一、五、七拍拍手），两小节 4/4 是一轮，每分钟 80 拍。
// 写成一首卡纳提克“克里蒂”（kriti）的缩影，gamaka 全写在音上：从低一个全音处推上来（!bend!）、在音上大幅度地摆（kampita，!vib!）。
// 萨与帕是固定音（prakriti），一律平直（最多用倚音从下面滑上来一下）；kampita 只放在会动的三级（升 G）与七级（升 D）上，
// 从记谱音往上摆到上邻音一带（七级摆向萨，三级摆向四级），不往下沉；推弦只放在低一个全音也在拉格里的二级、三级上（升 F 从萨、升 G 从升 F 推上来）：
// - 阿拉帕纳：只有萨拉斯瓦蒂维纳琴与坦布拉，低音区一个音一个音地推、摆，不打鼓；
// - 帕拉维（主句）：维纳琴唱，姆里丹加姆与甘吉拉进来打阿迪塔拉，维纳琴的节拍弦在拍手的拍上扫萨—帕—萨；
//   再一遍是“桑加提”（同一句的变奏，加了十六分音符的花），水碗高八度跟着、陶罐鼓换下甘吉拉；
// - 喀拉拉的琴达乐：两小节圆筒鼓由疏到密、小钹一直敲——庙会的游行到了码头；
// - 阿努帕拉维（高音区的第二句）：纳达斯瓦拉姆领、奥图吹萨与帕、塔维尔与小钹（南印度的“大乐队”）；
// - 斯瓦拉（快的音名唱段）：维纳琴的十六分音符，最后一个“莫拉”（同一句连奏三遍，正好落回下一轮的第一拍）；
// - 塔尼（打击乐的独奏）：姆里丹加姆两小节，甘吉拉、陶罐鼓各一小节一问一答；
// - 科尔瓦伊：全体把一句连奏三遍落在第一拍上；尾声维纳琴扫萨—帕—萨，纳达斯瓦拉姆一声长音。
// 第二遍从喀拉拉庙宇的索帕纳歌开始（伊达卡鼓“唱”阿拉帕纳的那一句），琴达乐引进纳达斯瓦拉姆的帕拉维。
// 南印度音乐没有和声：底下只有坦布拉（或奥图）的萨与帕；和弦一律写空五度 E5，只给持续音与衬底找音。
import type { TrackDef } from "../score";

/** 一小节的 E5（空五度）重复 n 次。 */
const drone = (n: number) => Array.from({ length: n }, () => "E5").join(" | ");

/** n 个点（打击乐的空格）。 */
const rest = (n: number) => ".".repeat(n);

export const PORT_MALABAR: TrackDef = {
  id: "port_malabar",
  title: { zh: "豆蔻山下的港", en: "Harbour Below the Cardamom Hills" },
  qpm: 80,
  meter: [4, 4],
  key: "E major",
  voices: {
    veena: { inst: "saraswati_veena", gain: 0.56, pan: -0.1, reverb: 0.28 },
    // 维纳琴的节拍弦：拍手的拍上扫一下萨—帕—萨
    vtala: { inst: "saraswati_veena", gain: 0.16, pan: -0.18, reverb: 0.3, pattern: { kind: "arp", low: 52, steps: "8 . . . . . . . 5 . . . 8 . . .", ring: 4 } },
    nadas: { inst: "nadaswaram", gain: 0.62, pan: 0.08, reverb: 0.34 },
    ottu: { inst: "ottu", gain: 0.4, pan: 0.12, reverb: 0.36, pattern: { kind: "drone", notes: [52, 59] } },
    jalt: { inst: "jaltarang", gain: 0.3, pan: 0.3, reverb: 0.4 },
    edakka: { inst: "edakka", gain: 0.55, pan: 0.2, reverb: 0.32 },
    tanpura: { inst: "tanpura", gain: 0.36, pan: -0.26, reverb: 0.36, pattern: { kind: "arp", low: 52, steps: "5, . . . 8 . . . 8 . . . 1 . . .", ring: 4 } },
    // 姆里丹加姆：右面（Nam、Din、Chapu、Ki）与左面（Thom、Tha、Gumki）两个声部
    mr: {
      inst: "perc",
      gain: 0.32,
      pan: 0.08,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "n.dkn.c.nkd.nkc.", hits: { n: ["mrd_nam", 0.7], d: ["mrd_din", 0.65], k: ["mrd_ki", 0.5], c: ["mrd_chapu", 0.62] } },
        b: { kind: "drum", steps: "nkdkn.cknkdknkc.", hits: { n: ["mrd_nam", 0.7], d: ["mrd_din", 0.65], k: ["mrd_ki", 0.5], c: ["mrd_chapu", 0.62] } },
        sw: { kind: "drum", steps: "n.dkn.c.nkd.nkc.ndc...ndc...ndc.", hits: { n: ["mrd_nam", 0.68], d: ["mrd_din", 0.62], k: ["mrd_ki", 0.48], c: ["mrd_chapu", 0.64] } },
        tani: { kind: "drum", steps: `nkdkn.c.nkdknkc.${rest(16)}`, hits: { n: ["mrd_nam", 0.78], d: ["mrd_din", 0.7], k: ["mrd_ki", 0.56], c: ["mrd_chapu", 0.72] } },
        kv: { kind: "drum", steps: "nkdc..nkdc..nkdc", hits: { n: ["mrd_nam", 0.7], d: ["mrd_din", 0.64], k: ["mrd_ki", 0.52], c: ["mrd_chapu", 0.66] } },
        end: { kind: "drum", steps: `n${rest(15)}`, hits: { n: ["mrd_nam", 0.56] } },
      },
    },
    ml: {
      inst: "perc",
      gain: 0.3,
      pan: 0.02,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "T.....h.T...G.h.", hits: { T: ["mrd_thom", 0.7], G: ["mrd_gumki", 0.66], h: ["mrd_tha", 0.5] } },
        b: { kind: "drum", steps: "T..h..h.T.h.G.h.", hits: { T: ["mrd_thom", 0.7], G: ["mrd_gumki", 0.66], h: ["mrd_tha", 0.5] } },
        sw: { kind: "drum", steps: "T.....h.T...G.h.T.....T.....T...", hits: { T: ["mrd_thom", 0.68], G: ["mrd_gumki", 0.62], h: ["mrd_tha", 0.48] } },
        tani: { kind: "drum", steps: `T...G...T.h.G.h.${rest(16)}`, hits: { T: ["mrd_thom", 0.76], G: ["mrd_gumki", 0.72], h: ["mrd_tha", 0.54] } },
        kv: { kind: "drum", steps: "T.....T.....T...", hits: { T: ["mrd_thom", 0.7] } },
        end: { kind: "drum", steps: `T${rest(15)}`, hits: { T: ["mrd_thom", 0.58] } },
      },
    },
    kanj: {
      inst: "perc",
      gain: 0.24,
      pan: 0.24,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "B.tk.t.kB.kt.ktk", hits: { B: ["kanj_bass", 0.62], t: ["kanj_ta", 0.5], k: ["kanj_ki", 0.4] } },
        tani: { kind: "drum", steps: `${rest(16)}B.tktkB.${rest(8)}`, hits: { B: ["kanj_bass", 0.74], t: ["kanj_ta", 0.62], k: ["kanj_ki", 0.5] } },
        kv: { kind: "drum", steps: "B.....B.....B...", hits: { B: ["kanj_bass", 0.6] } },
        end: { kind: "drum", steps: `B${rest(15)}`, hits: { B: ["kanj_bass", 0.5] } },
      },
    },
    ghat: {
      inst: "perc",
      gain: 0.26,
      pan: -0.2,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "O.tk.kt.G.tktkt.", hits: { O: ["ghatam_thom", 0.62], G: ["ghatam_gumki", 0.6], t: ["ghatam_ta", 0.55], k: ["ghatam_ki", 0.42] } },
        tani: { kind: "drum", steps: `${rest(24)}O.tktkG.`, hits: { O: ["ghatam_thom", 0.74], G: ["ghatam_gumki", 0.72], t: ["ghatam_ta", 0.66], k: ["ghatam_ki", 0.5] } },
        kv: { kind: "drum", steps: "O.....O.....O...", hits: { O: ["ghatam_thom", 0.6] } },
      },
    },
    // 大乐队：塔维尔与小钹
    thav: {
      inst: "perc",
      gain: 0.4,
      pan: 0.16,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "D.tt.tDt.tk.D.tt", hits: { D: ["thavil_dhom", 0.66], t: ["thavil_ta", 0.62], k: ["thavil_ki", 0.48] } },
        b: { kind: "drum", steps: "D.tttkDt.tktD.tt", hits: { D: ["thavil_dhom", 0.7], t: ["thavil_ta", 0.64], k: ["thavil_ki", 0.5] } },
        end: { kind: "drum", steps: `D${rest(15)}`, hits: { D: ["thavil_dhom", 0.56] } },
      },
    },
    talam: {
      inst: "perc",
      gain: 0.24,
      pan: -0.3,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "C.c.c.c.C.c.C.c.", hits: { C: ["talam", 0.5], c: ["talam_chik", 0.4] } },
        melam: { kind: "drum", steps: "C...C...C.C.C.C.", hits: { C: ["talam", 0.55] } },
        soft: { kind: "drum", steps: `C${rest(7)}C${rest(3)}C${rest(3)}`, hits: { C: ["talam", 0.36] } },
        end: { kind: "drum", steps: `C${rest(15)}`, hits: { C: ["talam", 0.5] } },
      },
    },
    // 喀拉拉的琴达：左面低音、右面木棍（第二层是十六分音符，由疏到密）
    che: { inst: "perc", gain: 0.46, pan: 0.26, reverb: 0.3, pattern: { kind: "drum", steps: "E.......E...E.E.", hits: { E: ["chenda_edam", 0.7] } } },
    chv: { inst: "perc", gain: 0.42, pan: 0.32, reverb: 0.3, pattern: { kind: "drum", steps: "..v...v...v.v.v.v.v.vvvvvvvvvvvv", grid: 0.5, hits: { v: ["chenda_valam", 0.55] } } },
    // 衬底（合成）：很轻的弦乐长音（E–B），大提琴组的低音萨
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 59, high: 76, size: 2 } },
    low: { inst: "celli", gain: 0.13, pan: 0.12, reverb: 0.3, pattern: { kind: "arp", low: 40, steps: "1 . . . . . . .", ring: 8 } },
  },
  sections: {
    // 阿拉帕纳（第二遍是伊达卡的索帕纳歌）：萨 — 推上来的二，摆着的三 · 二 · 萨，从三滑上来的五 · 摆着的七 · 萨，二 推上来的三 · 二 · 平直的萨
    alapana: { bars: 4, chords: drone(4), lines: { call: "E,6 !bend!F,2 | !vib!G,4 F,2 E,2 | {G,}B,2 !vib!D4 E2 | F !bend!G2 F E4" } },
    pallavi: {
      bars: 4,
      chords: drone(4),
      lines: {
        // 主句：五 萨 二 推上来的三 — 二 萨 | 推上来的三 五 摆着的七 — 高萨 | 七 五 三 五 摆着的七 五 | 摆着的三 二 低七 萨——
        pal: "B,2 E F !bend!G2 F E | !bend!G2 B !vib!d3 e2 | d B G B !vib!d2 B2 | !vib!G2 F D E4",
        // 桑加提：同一句加了十六分音符的花
        pal2: "B,2 (E/F/G/B/) !bend!G2 F E | !bend!G2 (B/d/e/f/) !vib!d2 e2 | (f/e/d/B/) d B !vib!d2 B2 | (G/B/G/F/) !vib!G3 D E2",
      },
    },
    melam: { bars: 2, chords: drone(2) },
    // 阿努帕拉维：高萨 高二 推上来的高三 高二 高萨 七 | 高萨 摆着的七 五—— | 三 五 七 高萨 推上来的高二 高萨 | 七 五 三 二 摆着的三
    anupallavi: { bars: 4, chords: drone(4), lines: { anu: "e2 f !bend!g2 f e d | e2 !vib!d2 B4 | G B d e !bend!f2 e2 | d B G F !vib!G4" } },
    // 斯瓦拉：十六分音符的经过句，最后两小节是莫拉（五 七 高萨——三遍，落回第一拍）
    swaram: { bars: 4, chords: drone(4), lines: { sw: "B/d/e/d/ B/G/F/G/ B2 !bend!G F | E/F/G/B/ d/e/f/e/ !vib!d2 B2 | B d e2 z2 B d | e2 z2 B d e2" } },
    tani: { bars: 4, chords: drone(4) },
    // 科尔瓦伊：三 五 七 高萨，连奏三遍（每遍之间空一拍）
    korvai: { bars: 2, chords: drone(2), lines: { kv: "G B d e z2 G B | d e z2 G B d e" } },
    // 尾声：维纳琴扫萨—帕—萨；纳达斯瓦拉姆从七级滑上来，一声平直的高萨
    coda: { bars: 2, chords: drone(2), lines: { cd: "[E,B,E]4 z4 | z8", cdn: "{d}e6 z2 | z8" } },
  },
  forms: [
    [
      { s: "alapana", play: "call:veena tanpura", dyn: 0.58 },
      { s: "pallavi", play: "pal:veena vtala tanpura mr.a ml.a kanj.a low", dyn: 0.64 },
      { s: "pallavi", play: "pal2:veena pal2:jalt+12 vtala tanpura mr.b ml.b ghat.a low pad", dyn: 0.66 },
      { s: "melam", play: "che chv talam.melam ottu tanpura", dyn: 0.62, to: 0.74 },
      { s: "anupallavi", play: "anu:nadas ottu thav.a talam.a pad", dyn: 0.7 },
      { s: "swaram", play: "sw:veena vtala tanpura mr.sw ml.sw kanj.a ghat.a low", dyn: 0.67 },
      { s: "tani", play: "tanpura mr.tani ml.tani kanj.tani ghat.tani low", dyn: 0.86 },
      { s: "korvai", play: "kv:veena vtala tanpura mr.kv ml.kv kanj.kv ghat.kv low", dyn: 0.7 },
      { s: "coda", play: "cd:veena cdn:nadas tanpura ottu mr.end ml.end thav.end talam.end low", dyn: 0.64, rit: 0.9 },
    ],
    [
      { s: "alapana", play: "call:edakka+12 tanpura talam.soft", dyn: 0.6 },
      { s: "melam", play: "che chv talam.melam ottu tanpura", dyn: 0.62, to: 0.74 },
      { s: "pallavi", play: "pal:nadas ottu thav.a talam.a pad", dyn: 0.68 },
      { s: "pallavi", play: "pal2:nadas pal2:jalt+12 ottu thav.b talam.a pad", dyn: 0.7 },
      { s: "anupallavi", play: "anu:veena vtala tanpura mr.a ml.a ghat.a low", dyn: 0.68 },
      { s: "korvai", play: "kv:veena kv:nadas vtala tanpura ottu mr.kv ml.kv kanj.kv ghat.kv low", dyn: 0.7 },
      { s: "coda", play: "cd:veena cdn:nadas tanpura ottu mr.end ml.end thav.end talam.end low", dyn: 0.64, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.38,
};
