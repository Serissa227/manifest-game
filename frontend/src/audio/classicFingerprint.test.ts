// 经典世界的配乐逐音不变（第九批配乐·地方特色第二阶段起的护栏）：经典世界用到的曲目（七首航海曲、七首港口曲、主题曲、风暴、海战、
// 四个短乐句）两套编配的曲谱与展开后的每个音，原有的乐器表与鼓点表合成出来的采样，都与第二阶段开工前记下的指纹一模一样。
// 地方乐器按地区并行扩充时只许“加”：新乐器另起键，新的合成手法是可选字段，经典世界听到的东西一个采样都不能变。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck } from "./dsp";
import { CORE_DRUMS, CORE_INSTRUMENTS, type SustainSpec } from "./instruments";
import { ORCH_INSTRUMENTS } from "./orchestra/instruments";
import { ORCH_JINGLES, ORCH_TRACKS } from "./orchestra/tracks";
import { realizePass, type TrackDef } from "./score";
import { TRACKS, type TrackId } from "./tracks";
import { CUE_IDS, JINGLES } from "./tracks/jingles";

/** FNV-1a（32 位），逐个整数地喂进去。 */
class Print {
  private h = 2166136261;
  int(v: number): void {
    let x = v | 0;
    for (let k = 0; k < 4; k++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 16777619);
      x >>>= 8;
    }
  }
  text(s: string): void {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
  }
  /** 采样（量化到 1e-6）。 */
  samples(x: Float32Array): void {
    this.int(x.length);
    for (let i = 0; i < x.length; i++) this.int(Math.round(x[i] * 1e6));
  }
  get value(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

/** 一首曲子：曲谱本身与每一遍展开后的每个音。 */
function trackPrint(def: TrackDef): string {
  const p = new Print();
  p.text(JSON.stringify(def));
  for (let pass = 0; pass < def.forms.length; pass++) {
    const r = realizePass(def, pass);
    p.int(Math.round(r.length * 1e6));
    for (const e of r.events) {
      p.text(`${e.voice},${e.hit ?? ""},${e.legato ? 1 : 0},${(e.deco ?? []).join("+")}`);
      for (const v of [e.t * 1e6, e.d * 1e6, e.v * 1e6, e.m * 1e3]) p.int(Math.round(v));
    }
  }
  return p.value;
}

/** 经典世界用到的曲目（ZONE_TRACK 的七首航海曲、经典的七首港口曲、主题曲、风暴、海战）。 */
const CLASSIC: readonly TrackId[] = [
  "title",
  "sea",
  "sea_north",
  "sea_south",
  "sea_islands",
  "sea_east",
  "sea_new",
  "ocean",
  "storm",
  "port_mediterranean",
  "port_nordic",
  "port_lowland",
  "port_desert",
  "port_islands",
  "port_eastern",
  "port_frontier",
  "battle",
];

/** 开工前（第二阶段，2026-10-07，main 的 bbad47d）记下的指纹：[合成版, 管弦版]。 */
const TRACK_PRINTS: Readonly<Record<string, readonly [string, string]>> = {
  title: ["ebd17e88", "0ad10fef"],
  sea: ["26b0471a", "43db0de5"],
  sea_north: ["5219e935", "2c29d2ab"],
  sea_south: ["c4f0a5a8", "74dd2623"],
  sea_islands: ["381cb317", "849a710e"],
  sea_east: ["8000a096", "bad8f2f0"],
  sea_new: ["f0c99b1b", "2af3af87"],
  ocean: ["64fb9b10", "8c029a52"],
  storm: ["201d73a0", "25389a52"],
  port_mediterranean: ["884f39c2", "d46ab22f"],
  port_nordic: ["e1bc7266", "c5f90380"],
  port_lowland: ["16f02acd", "e7570483"],
  port_desert: ["ee2dd27d", "5aa24b75"],
  port_islands: ["006c2946", "a80ed776"],
  port_eastern: ["e0a6f7b8", "01a93092"],
  port_frontier: ["5997c66b", "9b336394"],
  battle: ["74072d36", "5832ef40"],
  cue_depart: ["75a0b558", "c9860098"],
  cue_arrive: ["bde7f568", "ab4b5183"],
  cue_discover: ["14ec7ced", "00980ddc"],
  cue_fortune: ["b450f3a4", "9f3480de"],
};

/** 原有的乐器与鼓点合成出来的采样的指纹（同上）。 */
const INSTRUMENT_PRINT = "31325b33";

describe("经典世界的配乐逐音不变", () => {
  it("经典世界用到的曲目：两套编配的曲谱与展开后的每个音都与开工前一模一样", () => {
    const got: Record<string, [string, string]> = {};
    for (const id of CLASSIC) got[id] = [trackPrint(TRACKS[id]), trackPrint(ORCH_TRACKS[id])];
    for (const id of CUE_IDS) got[`cue_${id}`] = [trackPrint(JINGLES[id]), trackPrint(ORCH_JINGLES[id])];
    expect(got).toEqual(TRACK_PRINTS);
  });

  it("原有的乐器表与鼓点表：拨弦、击奏、鼓点合成出来的采样，持续音的谐波表与参数，管弦版的乐器表，都与开工前一模一样", () => {
    const sr = 22050;
    const p = new Print();
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    for (const [key, inst] of Object.entries(CORE_INSTRUMENTS)) {
      p.text(key);
      if (inst.kind === "pluck") for (const m of [45, 64]) p.samples(pluck(inst.spec, hz(m), sr, 7));
      else if (inst.kind === "mallet") for (const m of [52, 76]) p.samples(mallet(inst.spec, hz(m), sr, 7));
      else if (inst.kind !== "perc") {
        const { amps, ...rest } = inst as SustainSpec;
        p.text(JSON.stringify(rest));
        for (const f0 of [98, 196, 392, 784]) for (let n = 1; n <= 24; n++) p.int(Math.round(amps(n, n * f0) * 1e6));
      }
      p.int(Math.round(inst.level * 1e6));
    }
    for (const [hit, spec] of Object.entries(CORE_DRUMS)) {
      p.text(hit);
      p.samples(drum(spec, sr, 3));
    }
    p.text(JSON.stringify(ORCH_INSTRUMENTS));
    expect(p.value).toBe(INSTRUMENT_PRINT);
  });
});
