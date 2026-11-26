// 《星路》：远洋的太平洋（波利尼西亚人看星认路的海，马尼拉大帆船往返阿卡普尔科的航线；几个月看不见陆地）。
// 地方特色第二阶段重编：太平洋的乐器领奏（复古合成版的衬底只有很轻的弦乐长音与钢片琴的星）。A 段的吟诵沿用第二轮的原创旋律，B 段新写。
// C 利底亚，慢 4/4（每分钟 54 拍，一小节四秒多），空、阔、安静；和声不用西洋的三和弦，只有空五度（C5、G5、A5）与低处 C–G 的持续音：
// - 引子：远处一声加拉穆特裂缝锣（美拉尼西亚的村子用它报信），普（海螺号）在 G3 一个音上从下面推上来、往下落；
//   全作的起帆动机（G → C → G）由乌克克口弓高八度拨（G4 C5 G5 正是一根 C 弦的第三、四、六泛音，嘴腔一张一收就选得出来），鼻笛接住最后的长音；
// - A：鼻笛（ʻohe hano ihu）念那条只在 C、D、E 几个音上来回的吟诵——像领航人念着星的名字，长音揉开、句尾落下（鼻笛整首只吹 C D E G）；
//   钢片琴偶尔一颗高音是星；帕胡鼓（鲨皮鼓）很稀，两小节一下。再来时乌克克口弓高八度跟着拨（异音），口弓的泛音像星光；
//   第二遍的第一个 A 是守夜：只有口弓拨吟诵、葫芦弓在低处一小节敲一下根音、星，弦乐都歇着（领奏只是拨弦，衬底不能和它一样响）；
// - B：双体独木舟在星下划行：帕胡鼓在第一、三拍轻轻踩（桨入水），卡拉阿乌节奏棒在第二、四拍（桨杆碰船帮），
//   贝伦巴奥图延葫芦弓（马里亚纳的查莫罗人）在低处拨一根弦，口弓问、鼻笛答；第二遍普在上面拉长音（G3，A5 那两小节吹上去五度到 D4 呼应）；
// - 尾声：鼻笛把吟诵收在 C 上，加拉穆特再远远地响两下，普在 G3 上吹最后一声、往下落。
// 普整首只吹 G3 一个音（B 段一处吹上去五度）：海螺号基本只有一个音，旋律都交给鼻笛与口弓。
// 与经典世界的《晨星洋》（D 大调、小提琴组的长旋律与竖琴琶音）不同：这里更空、更少。
import type { TrackDef } from "../score";

export const SEA_PACIFIC: TrackDef = {
  id: "sea_pacific",
  title: { zh: "星路", en: "The Star Path" },
  qpm: 54,
  meter: [4, 4],
  key: "C lydian",
  level: 1.39,
  hall: true,
  space: 1.2,
  voices: {
    flute: { inst: "ohe_hano", gain: 0.62, pan: -0.14, reverb: 0.5 },
    pu: { inst: "pu", gain: 0.42, pan: 0.08, reverb: 0.62 },
    ukeke: { inst: "ukeke", gain: 0.6, pan: 0.26, reverb: 0.5 },
    bow: { inst: "belembaotuyan", gain: 0.36, pan: -0.24, reverb: 0.4 },
    pahu: {
      inst: "perc",
      gain: 0.32,
      pan: 0.04,
      reverb: 0.5,
      pattern: {
        // 两小节一下（与第二轮的群岛大鼓同一个位置）
        a: { kind: "drum", steps: "D" + ".".repeat(9) + "d" + ".".repeat(5), hits: { D: ["pahu_nui", 0.5], d: ["pahu_nui", 0.28] } },
        // 划桨：第一、三拍
        b: { kind: "drum", steps: "D...d...", hits: { D: ["pahu_nui", 0.5], d: ["pahu_nui", 0.36] } },
      },
    },
    kalaau: { inst: "perc", gain: 0.18, pan: 0.3, reverb: 0.46, pattern: { kind: "drum", steps: "..k...k.", hits: { k: ["kalaau", 0.5] } } },
    garamut: {
      inst: "perc",
      gain: 0.3,
      pan: -0.3,
      reverb: 0.7,
      pattern: {
        intro: { kind: "drum", steps: "G.......G.G.....", hits: { G: ["garamut", 0.55] } },
        outro: { kind: "drum", steps: "G.......G.......", hits: { G: ["garamut", 0.5] } },
      },
    },
    // 衬底（合成）：钢片琴的星、弦乐的空五度、低处 C–G 的持续音
    celesta: { inst: "celesta", gain: 0.16, pan: 0.34, reverb: 0.7 },
    pad: { inst: "strings", gain: 0.18, pan: -0.12, reverb: 0.52, pattern: { kind: "pad", low: 55, high: 79, size: 2 } },
    pedal: { inst: "strings", gain: 0.22, pan: 0.06, reverb: 0.4, pattern: { kind: "drone", notes: [36, 43] } },
    low: { inst: "strings", gain: 0.2, pan: 0.06, reverb: 0.4, pattern: { kind: "pad", low: 36, high: 48, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "C5 | C5",
      lines: {
        // 普：只在 G3 一个音上，从下面推上来、收尾往下落
        call: "!bend!!fall!G,6 z2 | z8",
        // 起帆动机（G → C → G）：口弓高八度拨（G4 C5 G5，一根 C 弦的第三、四、六泛音）
        motif: "z6 G,3/2 C/2 | !fall!G8",
        // 鼻笛接住动机最后的长音（G5）
        hold: "z8 | !fall!G8",
      },
    },
    A: {
      bars: 8,
      chords: "C5 | C5 | C5 | G5 | C5 | C5 | G5 | C5",
      lines: {
        // 像吟诵：只在 C、D、E 几个音上来回（第二轮的旋律），长音揉开、句尾落下。
        // 鼻笛只有两三个孔：第三小节原来下到低处的 A，改成在 C、D、E 里打个转，鼻笛整首只吹 C D E G 四个音（不超过五度）
        chant: "C2 D2 !vib!E4 | E2 D2 !fall!C4 | D2 C2 D2 E2 | !vib!D8 | E2 G2 E2 D2 | !vib!E8 | D2 E2 D2 C2 | !fall!C8",
        // 口弓跟着吟诵拨（异音）：长音上照口弓的习惯“长 短短”地再拨几下，不让拨弦的音断掉
        uk: "C2 D2 E2 E E | E2 D2 C2 C C | D2 C2 D2 E2 | D2 D D D2 D2 | E2 G2 E2 D2 | E2 E E E2 E2 | D2 E2 D2 C2 | C2 C C C4",
        // 星（也守着无半音的五个音：原来的 B 换成 A）
        stars: "z8 | z4 g'2 z2 | z8 | z6 d''2 | z8 | z2 a'2 z4 | z8 | z8",
        // 守夜（第二遍的第一个 A）：葫芦弓在低处一小节敲一下根音，偶尔带一下空五度的另一个音
        dr: "C,2 z6 | C,2 z4 G,,2 | C,2 z6 | G,,2 z4 D,2 | C,2 z6 | C,2 z4 G,,2 | G,,2 z4 D,2 | C,4 z4",
      },
    },
    B: {
      bars: 8,
      chords: "C5 | C5 | G5 | G5 | A5 | A5 | G5 | C5",
      lines: {
        // 口弓问（写的是嘴腔选出的泛音；句尾的长音“长 短短”地再拨两下）
        ukm: "e2 g2 a2 a a | g2 e2 d2 d d | z8 | z8 | a2 c'2 a2 a a | g2 e2 d2 d d | z8 | z8",
        // 鼻笛答
        flr: "z8 | z8 | !bend!d4 e2 d2 | !vib!c8 | z8 | z8 | !bend!e4 d2 c2 | !fall!c8",
        // 葫芦弓在低处拨一根弦（按弦换音）
        bow: "C,2 z2 G,,2 z2 | C,2 z2 G,,2 z2 | G,,2 z2 D,2 z2 | G,,2 z2 D,2 z2 | A,,2 z2 E,2 z2 | A,,2 z2 E,2 z2 | G,,2 z2 D,2 z2 | C,4 z4",
        // 普在上面拉长音（第二遍）：G3 一个音；A5 那两小节吹上去五度到 D4 呼应（与《潟湖的鼓声》的 A3 → E4 同一个道理）
        horn: "!bend!G,8- | G,4 z4 | z8 | z8 | !bend!D8- | D4 z4 | !bend!G,8 | !fall!G,4 z4",
      },
    },
    outro: { bars: 2, chords: "C5 | C5", lines: { tag: "E2 D2 C4 | !fall!C8", stars: "z4 g'2 z2 | z8", call: "z8 | !bend!!fall!G,8" } },
  },
  forms: [
    [
      { s: "intro", play: "call:pu motif:ukeke+12 hold:flute+12 garamut.intro pedal", dyn: 0.5, to: 0.56 },
      { s: "A", play: "chant:flute+12 stars:celesta pahu.a pad pedal", dyn: 0.6 },
      { s: "B", play: "ukm:ukeke flr:flute bow:bow pahu.b kalaau pad low", dyn: 0.62, to: 0.68 },
      { s: "A", play: "chant:flute+12 uk:ukeke+12 stars:celesta pahu.a pad pedal", dyn: 0.62 },
      { s: "outro", play: "tag:flute+12 stars:celesta call:pu garamut.outro pedal", dyn: 0.54, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "call:pu motif:ukeke+12 hold:flute+12 pedal", dyn: 0.48, to: 0.54 },
      // 守夜：只有口弓、葫芦弓与星（弦乐都歇着）
      { s: "A", play: "uk:ukeke+12 dr:bow stars:celesta", dyn: 0.58 },
      { s: "A", play: "chant:flute+12 uk:ukeke+12 stars:celesta pahu.a pad pedal", dyn: 0.6 },
      { s: "B", play: "ukm:ukeke flr:flute bow:bow horn:pu pahu.b kalaau pad low", dyn: 0.62, to: 0.68 },
      { s: "outro", play: "tag:flute+12 stars:celesta call:pu garamut.outro pedal", dyn: 0.52, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [30, 50],
};
