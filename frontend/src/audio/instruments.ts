// 乐器音色表。全部是程序合成的（没有采样文件），分几类：
// - pluck 拨弦：Karplus–Strong 弦模型预先算好每个音（dsp.pluck），播放时直接放；
// - mallet 击奏：加法合成（dsp.mallet），钟、钢片琴、木琴、定音鼓（定音鼓的 !trem! 是滚奏）；
// - wind 吹奏 / bowed 弓弦 / brass 铜管：实时振荡器，一个乐句一条链，音与音之间连贯滑动，带揉音、气声与弓噪；
//   “组”（小提琴组、大提琴组、圆号组）与簧片是齐奏：几个略有音差的振荡器一起奏（unison）；
// - pad 长音：弦乐群、人声、持续音，每个音一组失谐的振荡器；
// - perc 打击乐：鼓点表（dsp.drum），每种鼓点预先算几个略有差别的变体轮流用。
// 振荡器的波形按“每个谐波的振幅”给出（按音高算出 PeriodicWave），可以把琴身或声道的共振峰直接烘进去。
// 各乐器的 level 经过校准（本地试音台离线渲染量得）：声部音量 0.5、力度 0.8 时，持续音领奏“奏的时候”约 −30 dB，
// 拨弦与击奏约 −32 dB，长音每个音约 −36 dB；所以曲谱里各声部的 gain 直接表示混音比例。
// 地方乐器（日本、明、奥斯曼、印度、甘美兰、安第斯、玛雅、斯瓦希里海岸……）在 instruments/regional/，一件乐器一个文件，
// 由那里的 index.ts 登记，汇总进本文件的 INSTRUMENTS 与 DRUMS。
import type { DrumSpec, MalletSpec, PluckSpec } from "./dsp";
import { REGIONAL_DRUMS, REGIONAL_INSTRUMENTS } from "./instruments/regional";

/** 高斯共振峰：频率 f 处的增益（中心 c、宽度 oct 个八度、高度 h）。 */
function bump(f: number, c: number, oct: number, h: number): number {
  const d = Math.log2(f / c) / oct;
  return h * Math.exp(-d * d);
}

/** 高于 fc 后按 slope 阶衰减。 */
function roll(f: number, fc: number, slope = 2): number {
  return 1 / (1 + Math.pow(f / fc, slope));
}

/** 谐波振幅模型：第 n 个谐波（频率 f）的振幅。 */
export type Harmonics = (n: number, f: number) => number;

/** 实时合成的持续音乐器。 */
export interface SustainSpec {
  kind: "wind" | "bowed" | "brass" | "pad";
  amps: Harmonics;
  /** 起音、释音（秒） */
  attack: number;
  release: number;
  /** 揉音：频率（Hz）、深度（音分）、开始前的延迟（秒）；只加在够长的音上 */
  vib?: { rate: number; depth: number; delay: number };
  /** 气声 / 弓噪：以 ratio × 基频为中心的带通噪声 */
  breath?: { level: number; q: number; ratio: number };
  /** 吐音 / 起弓瞬间的噪声 */
  chiff?: number;
  /** 非圆滑的两音之间音量降到多少（0–1，缺省 0.3；越大越连贯） */
  tongue?: number;
  /** 圆滑奏时的滑音时间（秒） */
  glide: number;
  /** 长音乐器：第二个振荡器的失谐（音分） */
  detune?: number;
  /**
   * 齐奏：voices 个振荡器同时奏同一个音，音高在 ±spread/2 音分内均匀错开，起振相位与揉音速度各不相同
   * （几件同类乐器合在一起的厚度与“嗡嗡”的颤动）。长音乐器写了它就不再看 detune。
   */
  unison?: { voices: number; spread: number };
  /** 固定低通（Hz） */
  lp?: number;
  /** 铜管：每个音的亮度包络，低通从 from 升到 to（乘以力度）再回落 */
  blare?: { from: number; to: number; time: number };
  /**
   * 跟着波形起伏的气声 / 弓噪（真的笛子与胡琴里，气流与弓毛的噪声是随每个周期一开一合的，不是一层平平的沙声）：
   * 带通噪声（中心为 ratio × 基频，跟着音高走）的音量由振荡器自己的波形调制。level 为相对乐音的比例。
   */
  pulse?: { level: number; q: number; ratio: number };
  /** 起音的一口气（尺八的 muraiki、奈伊笛与排箫的“噗”）：每个不圆滑的音开头一团跟着音高走的带通噪声，decay 秒消失 */
  puff?: { level: number; decay: number };
  /** 气息的起伏：音量按 rate Hz 轻轻地一涨一落（深度 depth，0–1），长音上像人在吹 */
  tremor?: { rate: number; depth: number };
  /** 音高的慢漂：两个很慢的振荡器（0.23、0.37 Hz）叠出 ±drift 音分的游移，免得长音直得像机器 */
  drift?: number;
  /** 写了 vib 装饰的音揉得多深（倍数，缺省 2.2） */
  vibBoost?: number;
  /**
   * 写了 vib 装饰的深揉往上偏多少（0–1，缺省 0：以记谱音为中心上下摆）：中心随深度一起升高 vibLift × 深度，
   * 为 1 时从记谱音往上摆到上邻音一带、不往下沉（卡纳提克的 kampita）。写了 andolan 的音不看它。
   */
  vibLift?: number;
  /**
   * 共鸣弦（萨朗吉的 tarab）：乐句的声音同时送进一排很窄的带通（每根弦一个，中心是它的音高 notes（MIDI），Q 为 q），
   * 主音的某个谐波与哪根弦对得上，哪根就“嗡”地亮起来，换音以后还响一会儿（带通越窄余音越长：约 2.2·q / f 秒）；level 为这层的音量。
   */
  sympathetic?: { notes: readonly number[]; level: number; q: number };
  /** 音量校准 */
  level: number;
}

/**
 * 拨弦的 !vib!（揉弦）怎么揉：rate 每秒几下、depth 播放速率摆动的幅度（0.03 约 ±50 音分）、delay 拨弦后多久开始（秒）；
 * lift（0–1，缺省 0）：摆动的中心随深度一起往上偏 lift × depth，为 1 时从记谱音往上摆、不往下沉（卡纳提克的 kampita）。
 * 不写时按 engine.ts 的 PLUCK_VIB（快而浅的揉弦）；萨拉斯瓦蒂维纳琴的 kampita、鲁德拉维纳琴的揉弦摆得宽而慢。
 * 写了 !andolan! 的音不看这里，按 engine.ts 的 ANDOLAN（拉格的慢摇，哪件乐器都一样）。
 */
export interface PluckVib {
  rate: number;
  depth: number;
  delay?: number;
  lift?: number;
}

export type Instrument =
  /**
   * tremolo：长于这么多秒的音（或写了 !trem!）用震音；tremRate 为每秒几下（缺省 12.5），tremPattern 为轮流的轻重（琵琶的轮指）；
   * pluckVib：!vib! 的揉弦（缺省 PLUCK_VIB），见 PluckVib；
   * vib：同一件事的另一种写法（朝鲜一支的伽倻琴、玄琴这样写，每秒几下、播放速率的深浅、开始前的延迟秒数都要写）；两个都写时以 pluckVib 为准
   */
  | { kind: "pluck"; spec: PluckSpec; level: number; tremolo?: number; release?: number; tremRate?: number; tremPattern?: readonly number[]; pluckVib?: PluckVib; vib?: { rate: number; depth: number; delay: number } }
  /** roll：写了 !trem! 的音按每秒这么多击滚奏（定音鼓），由弱渐强 */
  | { kind: "mallet"; spec: MalletSpec; level: number; release?: number; roll?: number }
  | { kind: "perc"; level: number }
  | SustainSpec;

// ───────────────────────────── 拨弦

const PLUCKS = {
  /** 竖琴：拨在弦中部，柔和、余音长 */
  harp: { t60: 3.2, tilt: 0.55, bright: 0.6, pick: 0.38, damp: 0.3, thump: 0.03, body: [[190, 1.2, 3], [800, 1.4, -2], [3000, 1, 2]], lp: 9500, max: 5 },
  /** 鲁特琴：羊肠复弦，温暖带一点鼻音 */
  lute: { t60: 1.9, tilt: 0.5, bright: 0.55, pick: 0.2, damp: 0.27, course: 3.5, thump: 0.05, body: [[240, 1.4, 4], [1100, 1.2, 2], [3200, 1, -4]], lp: 6500, max: 3.5 },
  /** 尼龙弦吉他（维乌埃拉） */
  guitar: { t60: 2.4, tilt: 0.5, bright: 0.65, pick: 0.14, damp: 0.2, thump: 0.05, body: [[105, 2, 5], [215, 1.5, 3], [2500, 1, -1]], lp: 8500, max: 4 },
  /** 乌德琴：无品、复弦、拨片，深沉、余音短 */
  oud: { t60: 1.5, tilt: 0.45, bright: 0.5, pick: 0.1, damp: 0.32, course: 4, thump: 0.08, body: [[150, 1.5, 4], [620, 1.3, 2], [2200, 1, -4]], lp: 5200, max: 2.8 },
  /** 古筝：明亮、余音长 */
  zheng: { t60: 3.6, tilt: 0.6, bright: 0.8, pick: 0.12, damp: 0.15, thump: 0.06, body: [[300, 1.2, 3], [1500, 1.5, 2]], lp: 9000, max: 5 },
  /** 四弦小吉他（群岛） */
  ukulele: { t60: 1.1, tilt: 0.4, bright: 0.55, pick: 0.2, damp: 0.3, thump: 0.05, body: [[400, 1.5, 4], [1250, 1.5, 2]], lp: 6500, max: 2 },
  /** 曼陀林：钢丝复弦，明亮，长音用震音 */
  mandolin: { t60: 1.3, tilt: 0.45, bright: 0.85, pick: 0.1, damp: 0.13, course: 5, thump: 0.07, body: [[600, 1.5, 3], [2500, 1.2, 3]], lp: 9000, max: 2.5 },
  /** 西特琴：钢丝、清脆带“铮”声（开拓者的营火边） */
  cittern: { t60: 1.1, tilt: 0.4, bright: 0.9, pick: 0.07, damp: 0.1, course: 4, thump: 0.1, body: [[900, 1.5, 5], [3000, 1.5, 2]], lp: 10000, max: 2 },
  /** 羽管键琴 */
  harpsichord: { t60: 2.2, tilt: 0.55, bright: 0.95, pick: 0.06, damp: 0.08, course: 3, thump: 0.1, body: [[250, 1, 2], [3500, 1, 3]], lp: 11000, max: 3 },
  /** 北地的卡恩特勒琴（小竖琴式的齐特琴） */
  kantele: { t60: 3.0, tilt: 0.55, bright: 0.75, pick: 0.2, damp: 0.18, thump: 0.04, body: [[350, 1.2, 3]], lp: 8000, max: 4 },
  /** 低音拨奏 */
  pizz: { t60: 0.9, tilt: 0.35, bright: 0.3, pick: 0.3, damp: 0.4, thump: 0.03, body: [[90, 1.2, 4], [250, 1, 2]], lp: 2500, max: 2 },
} as const satisfies Record<string, PluckSpec>;

// ───────────────────────────── 击奏

const MALLETS = {
  /** 船钟：小而亮，分音不协和，带拍音 */
  bell: { partials: [[1, 1, 3.5], [2.0, 0.5, 2.5], [2.76, 0.45, 1.6], [5.4, 0.25, 0.8], [8.9, 0.12, 0.4]], attack: 0.001, strike: [0.15, 0.01, 6000], beat: 0.7, tilt: 0.2, max: 5 },
  /** 钟楼的排钟：分音里有小三度（tierce）与低八度的哼音 */
  carillon: {
    partials: [[0.5, 0.45, 7], [1, 0.8, 5], [1.19, 0.5, 4], [1.5, 0.3, 3], [2, 0.7, 3], [2.5, 0.2, 1.5], [3, 0.2, 1.2], [4, 0.15, 0.8]],
    attack: 0.001,
    strike: [0.2, 0.008, 5000],
    beat: 0.5,
    tilt: 0.3,
    max: 6,
  },
  /** 钢片琴：清亮、像提灯的微光 */
  celesta: { partials: [[1, 1, 1.8], [2, 0.08, 0.6], [4.0, 0.14, 0.35], [6.3, 0.04, 0.12]], attack: 0.001, strike: [0.05, 0.004, 8000], tilt: 0.35, max: 3 },
  /** 群岛的木琴 */
  marimba: { partials: [[1, 1, 0.6], [3.9, 0.3, 0.12], [9.2, 0.06, 0.04]], attack: 0.002, strike: [0.12, 0.004, 3000], tilt: 0.4, max: 1.5 },
  /** 裂缝木鼓（有音高） */
  logdrum: { partials: [[1, 1, 0.32], [2.4, 0.25, 0.08], [5.1, 0.08, 0.03]], attack: 0.001, strike: [0.3, 0.004, 2500], tilt: 0.2, max: 0.8 },
  /** 定音鼓 */
  timpani: { partials: [[1, 1, 1.9], [1.5, 0.45, 1.3], [1.99, 0.3, 1.0], [2.44, 0.15, 0.7], [2.9, 0.1, 0.5]], attack: 0.003, strike: [0.45, 0.02, 700], tilt: 0.1, max: 3 },
  /** 小锣 */
  gong: { partials: [[1, 1, 2.6], [1.52, 0.5, 1.8], [2.2, 0.35, 1.2], [3.3, 0.2, 0.8], [4.6, 0.1, 0.5]], attack: 0.004, strike: [0.2, 0.01, 3000], beat: 1.5, tilt: 0.1, max: 4 },
} as const satisfies Record<string, MalletSpec>;

// ───────────────────────────── 打击乐

/** 原有的鼓点表：名字 → 合成参数。 */
export const CORE_DRUMS: Readonly<Record<string, DrumSpec>> = {
  /** 手鼓（框鼓）重击 */
  bodhran: {
    layers: [
      { kind: "skin", f0: 170, f1: 78, bend: 0.03, decay: 0.28, level: 1, modes: [[1.59, 0.25, 0.1], [2.14, 0.12, 0.06]] },
      { kind: "noise", lo: 300, hi: 2000, decay: 0.04, level: 0.35 },
    ],
  },
  /** 手鼓轻击（鼓边） */
  tip: {
    layers: [
      { kind: "skin", f0: 240, f1: 125, bend: 0.02, decay: 0.12, level: 0.7 },
      { kind: "noise", lo: 800, hi: 4000, decay: 0.02, level: 0.3 },
    ],
  },
  /** 带响弦的小鼓（塔博鼓） */
  tabor: {
    layers: [
      { kind: "skin", f0: 260, f1: 185, bend: 0.015, decay: 0.12, level: 0.8 },
      { kind: "noise", lo: 1500, hi: 6000, decay: 0.12, level: 0.8 },
    ],
  },
  /** 达布卡鼓的低音（鼓心） */
  doum: {
    layers: [
      { kind: "skin", f0: 150, f1: 95, bend: 0.02, decay: 0.45, level: 1, modes: [[1.5, 0.3, 0.2]] },
      { kind: "noise", lo: 200, hi: 1200, decay: 0.02, level: 0.25 },
    ],
  },
  /** 达布卡鼓的高音（鼓边） */
  tek: {
    layers: [
      { kind: "skin", f0: 700, f1: 650, bend: 0.01, decay: 0.05, level: 0.35 },
      { kind: "noise", lo: 2500, hi: 9000, decay: 0.035, level: 1 },
    ],
  },
  /** 达布卡鼓的轻击 */
  ka: {
    layers: [
      { kind: "noise", lo: 2000, hi: 7000, decay: 0.03, level: 0.6 },
      { kind: "skin", f0: 600, f1: 560, bend: 0.01, decay: 0.04, level: 0.2 },
    ],
  },
  /** 铃鼓（一击，铃片连响几下） */
  riq: {
    layers: [
      { kind: "noise", lo: 5000, hi: 12000, decay: 0.09, level: 1, taps: 3 },
      { kind: "skin", f0: 400, f1: 300, bend: 0.01, decay: 0.04, level: 0.2 },
    ],
  },
  /** 铃鼓（摇） */
  shake: { layers: [{ kind: "noise", lo: 5000, hi: 12000, attack: 0.02, decay: 0.12, level: 0.8, taps: 4 }] },
  /** 沙锤 */
  shaker: { layers: [{ kind: "noise", lo: 3500, hi: 11000, attack: 0.012, decay: 0.05, level: 1 }] },
  /** 群岛的大鼓 */
  pahu: {
    layers: [
      { kind: "skin", f0: 110, f1: 60, bend: 0.04, decay: 0.6, level: 1 },
      { kind: "noise", lo: 150, hi: 900, decay: 0.05, level: 0.3 },
    ],
  },
  /** 木鱼 / 木块 */
  woodblock: {
    layers: [
      { kind: "skin", f0: 1100, f1: 1080, bend: 0.01, decay: 0.05, level: 0.8, modes: [[2.6, 0.3, 0.02]] },
      { kind: "noise", lo: 1500, hi: 6000, decay: 0.004, level: 0.4 },
    ],
  },
  /** 梆子（更高、更短） */
  clapper: {
    layers: [
      { kind: "skin", f0: 1800, f1: 1780, bend: 0.01, decay: 0.035, level: 0.7 },
      { kind: "noise", lo: 3000, hi: 9000, decay: 0.003, level: 0.5 },
    ],
  },
  /** 战鼓 */
  taiko: {
    layers: [
      { kind: "skin", f0: 95, f1: 48, bend: 0.05, decay: 0.8, level: 1, modes: [[1.6, 0.2, 0.3]] },
      { kind: "noise", lo: 80, hi: 600, decay: 0.06, level: 0.4 },
    ],
  },
  /** 军鼓 */
  snare: {
    layers: [
      { kind: "skin", f0: 220, f1: 180, bend: 0.01, decay: 0.1, level: 0.6 },
      { kind: "noise", lo: 1800, hi: 7000, decay: 0.16, level: 1 },
    ],
  },
  /** 小钹 */
  cymbal: {
    layers: [
      { kind: "noise", lo: 3000, hi: 12000, attack: 0.002, decay: 0.9, level: 1 },
      { kind: "skin", f0: 620, f1: 600, bend: 0.01, decay: 0.3, level: 0.05 },
    ],
  },
  /** 木地板上的跺脚 */
  stomp: {
    layers: [
      { kind: "skin", f0: 110, f1: 70, bend: 0.03, decay: 0.15, level: 1 },
      { kind: "noise", lo: 100, hi: 1500, decay: 0.03, level: 0.5 },
    ],
  },
};

/** 鼓点表：原有的加上地方乐器的鼓点（instruments/regional/，一件乐器一个文件；名字不能重，测试会查）。 */
export const DRUMS: Readonly<Record<string, DrumSpec>> = { ...CORE_DRUMS, ...REGIONAL_DRUMS };

// ───────────────────────────── 持续音

/** 木笛（低音哨笛）：接近正弦，带一点气声。 */
const flute: SustainSpec = {
  kind: "wind",
  amps: (n) => [1, 0.22, 0.09, 0.04, 0.02][n - 1] ?? 0,
  attack: 0.03,
  release: 0.07,
  vib: { rate: 5.1, depth: 11, delay: 0.28 },
  breath: { level: 0.05, q: 1.6, ratio: 2 },
  chiff: 0.1,
  tongue: 0.55,
  glide: 0.025,
  level: 0.25,
};

/** 原有的乐器表。 */
export const CORE_INSTRUMENTS: Readonly<Record<string, Instrument>> = {
  // 拨弦
  harp: { kind: "pluck", spec: PLUCKS.harp, level: 1.3 },
  lute: { kind: "pluck", spec: PLUCKS.lute, level: 1.35 },
  guitar: { kind: "pluck", spec: PLUCKS.guitar, level: 1.4 },
  oud: { kind: "pluck", spec: PLUCKS.oud, level: 0.93, tremolo: 0.95 },
  zheng: { kind: "pluck", spec: PLUCKS.zheng, level: 1.3 },
  ukulele: { kind: "pluck", spec: PLUCKS.ukulele, level: 1.75 },
  mandolin: { kind: "pluck", spec: PLUCKS.mandolin, level: 1.1, tremolo: 0.42 },
  cittern: { kind: "pluck", spec: PLUCKS.cittern, level: 2.1 },
  harpsichord: { kind: "pluck", spec: PLUCKS.harpsichord, level: 1.5 },
  kantele: { kind: "pluck", spec: PLUCKS.kantele, level: 1.26 },
  pizz: { kind: "pluck", spec: PLUCKS.pizz, level: 1.33 },
  // 击奏
  bell: { kind: "mallet", spec: MALLETS.bell, level: 0.7 },
  carillon: { kind: "mallet", spec: MALLETS.carillon, level: 0.69 },
  celesta: { kind: "mallet", spec: MALLETS.celesta, level: 0.76 },
  marimba: { kind: "mallet", spec: MALLETS.marimba, level: 1.16 },
  logdrum: { kind: "mallet", spec: MALLETS.logdrum, level: 1.24 },
  timpani: { kind: "mallet", spec: MALLETS.timpani, level: 0.73, roll: 16 },
  gong: { kind: "mallet", spec: MALLETS.gong, level: 0.55 },
  // 打击乐
  perc: { kind: "perc", level: 1.5 },
  // 吹奏
  flute,
  /** 竖笛：几乎没有揉音，第三谐波略强 */
  recorder: {
    kind: "wind",
    amps: (n) => [1, 0.06, 0.15, 0.03, 0.05][n - 1] ?? 0,
    attack: 0.025,
    release: 0.05,
    vib: { rate: 4.5, depth: 4, delay: 0.4 },
    breath: { level: 0.035, q: 2, ratio: 3 },
    chiff: 0.12,
    tongue: 0.35,
    glide: 0.02,
    level: 0.23,
  },
  /** 奈伊笛（沙漠）：气声很重，揉音慢而深 */
  ney: {
    kind: "wind",
    amps: (n) => [1, 0.35, 0.15, 0.08, 0.04][n - 1] ?? 0,
    attack: 0.08,
    release: 0.15,
    vib: { rate: 4.6, depth: 18, delay: 0.25 },
    breath: { level: 0.22, q: 0.9, ratio: 1.5 },
    chiff: 0.05,
    tongue: 0.7,
    glide: 0.06,
    level: 0.27,
  },
  /** 笛子（瑶华）：明亮，笛膜的沙沙声 */
  dizi: {
    kind: "wind",
    amps: (n, f) => ((n === 1 ? 1 : 0.55 / Math.pow(n, 0.8)) + bump(f, 3600, 0.5, 0.25)) * roll(f, 7000),
    attack: 0.02,
    release: 0.06,
    vib: { rate: 5.6, depth: 14, delay: 0.22 },
    breath: { level: 0.06, q: 1.4, ratio: 2 },
    chiff: 0.12,
    tongue: 0.5,
    glide: 0.03,
    level: 0.33,
  },
  /** 鼻笛（群岛）：柔和、气声多 */
  vivo: {
    kind: "wind",
    amps: (n) => [1, 0.15, 0.05][n - 1] ?? 0,
    attack: 0.06,
    release: 0.12,
    vib: { rate: 4.2, depth: 9, delay: 0.35 },
    breath: { level: 0.14, q: 1.1, ratio: 1.2 },
    chiff: 0.04,
    tongue: 0.7,
    glide: 0.05,
    level: 0.26,
  },
  // 弓弦
  /** 小提琴（民间提琴） */
  fiddle: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.85)) * (0.6 + bump(f, 290, 0.5, 0.5) + bump(f, 460, 0.4, 0.6) + bump(f, 1000, 0.5, 0.3) + bump(f, 2800, 0.7, 1.1)) * roll(f, 4800, 3),
    attack: 0.045,
    release: 0.09,
    vib: { rate: 5.8, depth: 17, delay: 0.14 },
    breath: { level: 0.008, q: 0.8, ratio: 6 },
    chiff: 0.04,
    tongue: 0.6,
    glide: 0.035,
    level: 0.4,
  },
  /** 大提琴（也当维奥尔琴用） */
  cello: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.9)) * (0.6 + bump(f, 220, 0.5, 0.6) + bump(f, 480, 0.5, 0.4) + bump(f, 1200, 0.6, 0.3)) * roll(f, 2600, 3),
    attack: 0.08,
    release: 0.14,
    vib: { rate: 5.1, depth: 14, delay: 0.2 },
    breath: { level: 0.006, q: 0.8, ratio: 5 },
    chiff: 0.025,
    tongue: 0.6,
    glide: 0.05,
    level: 0.29,
  },
  /** 小提琴组（大编制的旋律）：三把琴齐奏，起音比独奏的提琴慢、弓噪轻，长线条圆滑地连着拉 */
  violins: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.9)) * (0.55 + bump(f, 450, 0.5, 0.45) + bump(f, 1000, 0.5, 0.2) + bump(f, 2800, 0.7, 0.75)) * roll(f, 5200, 3),
    attack: 0.11,
    release: 0.28,
    vib: { rate: 5.5, depth: 12, delay: 0.22 },
    breath: { level: 0.006, q: 0.7, ratio: 5 },
    chiff: 0.012,
    tongue: 0.72,
    glide: 0.06,
    unison: { voices: 3, spread: 14 },
    level: 0.37,
  },
  /** 大提琴组（带低音提琴的低音线）：厚、暖，长音的低音与顿弓的固定音型 */
  celli: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.95)) * (0.6 + bump(f, 200, 0.5, 0.6) + bump(f, 480, 0.5, 0.35) + bump(f, 1200, 0.6, 0.2)) * roll(f, 2400, 3),
    attack: 0.13,
    release: 0.3,
    vib: { rate: 5.0, depth: 9, delay: 0.3 },
    breath: { level: 0.005, q: 0.8, ratio: 4 },
    chiff: 0.012,
    tongue: 0.65,
    glide: 0.07,
    unison: { voices: 3, spread: 12 },
    level: 0.26,
  },
  /** 自然圆号：暗、圆，力度越大越亮 */
  horn: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.55)) * roll(f, 2400, 2),
    attack: 0.06,
    release: 0.12,
    vib: { rate: 4.8, depth: 6, delay: 0.4 },
    tongue: 0.45,
    glide: 0.04,
    blare: { from: 500, to: 2600, time: 0.12 },
    level: 0.34,
  },
  /** 圆号组（法国号）：两支齐奏，温暖、柔和，起音从容；力度大时变亮，但亮不过小号 */
  horns: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.7)) * (1 + bump(f, 380, 0.6, 0.35)) * roll(f, 1700, 2.5),
    attack: 0.09,
    release: 0.22,
    vib: { rate: 4.6, depth: 5, delay: 0.5 },
    breath: { level: 0.004, q: 1, ratio: 3 },
    tongue: 0.5,
    glide: 0.05,
    blare: { from: 420, to: 1900, time: 0.18 },
    unison: { voices: 2, spread: 8 },
    level: 0.26,
  },
  /** 小号（号角）：明亮、起音利落，号角动机与齐奏的最高声部 */
  trumpet: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.4)) * (1 + bump(f, 1400, 0.6, 0.6)) * roll(f, 4600, 2.5),
    attack: 0.03,
    release: 0.1,
    vib: { rate: 5.2, depth: 7, delay: 0.35 },
    chiff: 0.025,
    tongue: 0.25,
    glide: 0.03,
    blare: { from: 900, to: 5500, time: 0.08 },
    level: 0.46,
  },
  /** 簧片（手风琴、簧风琴式的自由簧）：两片簧略有音差，嗡嗡地颤；没有揉音，风箱的一点气声 */
  reed: {
    kind: "wind",
    amps: (n, f) => (1 / Math.pow(n, 0.75)) * (0.5 + bump(f, 1300, 0.7, 0.6) + bump(f, 3000, 0.6, 0.25)) * roll(f, 5200, 3),
    attack: 0.025,
    release: 0.08,
    breath: { level: 0.012, q: 0.8, ratio: 3 },
    tongue: 0.45,
    glide: 0.02,
    unison: { voices: 2, spread: 16 },
    level: 0.45,
  },
  // 长音
  /** 弦乐群：四组略有音差的琴齐奏，起音慢，带一层轻轻的弓噪 */
  strings: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 0.95)) * (0.7 + bump(f, 450, 0.6, 0.3) + bump(f, 2600, 0.8, 0.25)) * roll(f, 3800, 2.5),
    attack: 0.6,
    release: 1.0,
    vib: { rate: 4.9, depth: 7, delay: 0.3 },
    breath: { level: 0.01, q: 0.7, ratio: 4 },
    unison: { voices: 4, spread: 16 },
    glide: 0.1,
    level: 0.155,
  },
  /** 人声（“哦”） */
  choir: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 1.2)) * (0.05 + bump(f, 450, 0.35, 1) + bump(f, 800, 0.3, 0.55) + bump(f, 2830, 0.25, 0.12)),
    attack: 0.7,
    release: 1.4,
    vib: { rate: 5.0, depth: 11, delay: 0.4 },
    detune: 9,
    glide: 0.1,
    level: 0.22,
  },
  /** 持续音（手摇弦琴式） */
  drone: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.4 + bump(f, 1200, 0.6, 0.9) + bump(f, 2500, 0.5, 0.4)) * roll(f, 5000, 3),
    attack: 1.2,
    release: 1.6,
    detune: 3,
    glide: 0.1,
    level: 0.27,
  },
};

/** 乐器表：原有的加上地方乐器（instruments/regional/，一件乐器一个文件；键不能重，测试会查）。 */
export const INSTRUMENTS: Readonly<Record<string, Instrument>> = { ...CORE_INSTRUMENTS, ...REGIONAL_INSTRUMENTS };

/** 乐器是否存在。 */
export function isInstrument(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, id);
}
