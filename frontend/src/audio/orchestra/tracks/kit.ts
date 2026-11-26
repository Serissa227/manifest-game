// 管弦版编配的小工具：乐队的座位（声像）、混响送量与几种常用的声部写法。
// 座位按常见的舞台布置：第一小提琴在左、第二小提琴左中、中提琴右中、大提琴与低音提琴在右；
// 木管居中靠后，圆号左后，小号与长号右后，竖琴在左，定音鼓与打击乐居中靠后。
// 打击乐声部的旋律行用音名代表鼓点（见 ../instruments.ts 的 ORCH_KEYS），调号会改音名：一律写成还原音（=C =F ……）最稳妥。
import type { Pattern, Step, VoiceDef } from "../../score";

/** 声像（−1 左 … 1 右）。 */
export const SEAT = {
  vn1: -0.36,
  vn2: -0.16,
  va: 0.14,
  vc: 0.28,
  cb: 0.38,
  harp: -0.44,
  fl: -0.08,
  ob: 0.04,
  cl: 0.12,
  bn: 0.18,
  hn: -0.26,
  tp: 0.2,
  tb: 0.3,
  timp: 0.02,
  perc: 0.1,
  glock: 0.3,
  bells: 0.36,
  marimba: 0.24,
} as const;

/** 混响送量：弦乐与木管中等，铜管与竖琴多一点，低音少一点。 */
export const WET = { strings: 0.3, low: 0.24, winds: 0.32, brass: 0.36, harp: 0.38, perc: 0.3, bells: 0.5 } as const;

/** 旋律声部（同时只奏一个音，按乐句连贯）。 */
export function line(inst: string, gain: number, pan: number, reverb: number, pattern?: VoiceDef["pattern"]): VoiceDef {
  return { inst, gain, pan, reverb, ...(pattern ? { pattern } : {}) };
}

/** 和弦长音（弦乐分部、圆号或长号的和弦）：在 [low, high] 里排 size 个音，换和弦时就近进行，共同音连着不重新起音。 */
export function chords(inst: string, gain: number, pan: number, reverb: number, low: number, high: number, size = 3): VoiceDef {
  return { inst, gain, pan, reverb, poly: true, pattern: { kind: "pad", low, high, size } };
}

/** 旋律行里直接写和弦（[DFA]）的长音声部：每个音各自起音、释音。 */
export function held(inst: string, gain: number, pan: number, reverb: number): VoiceDef {
  return { inst, gain, pan, reverb, poly: true };
}

/** 一次性的声部（拨奏、竖琴、定音鼓……）带伴奏型。 */
export function pulse(inst: string, gain: number, pan: number, reverb: number, pattern: Pattern | Readonly<Record<string, Pattern>>): VoiceDef {
  return { inst, gain, pan, reverb, pattern };
}

/** 低音线：arp 伴奏型（B 是和弦的低音，放在 [low, low+12) 里；1 是根音，5 是上方五度），low 为这一八度窗口的下限。 */
export function bass(steps: string, low: number, ring?: number): Pattern {
  return { kind: "arp", low, steps, ...(ring ? { ring } : {}) };
}

/** 从合成版的声部里原样取出这几个（地方乐器领奏的港口曲：管弦版与合成版共用地方乐器与打击乐的声部）。 */
export function pick(voices: Readonly<Record<string, VoiceDef>>, names: readonly string[]): Record<string, VoiceDef> {
  const out: Record<string, VoiceDef> = {};
  for (const n of names) {
    const v = voices[n];
    if (!v) throw new Error(`合成版没有声部 ${n}`);
    out[n] = v;
  }
  return out;
}

/**
 * 把合成版的曲式改到管弦版的声部上：map 里的声部（衬底）换成一个或几个管弦的声部（空串是去掉），其余（地方乐器、打击乐）原样。
 * “旋律行:声部”与“声部.变体”的写法都照样认；段落、力度、速度一点不动——两套编配的分段时刻因此完全一样，可以互相接上。
 */
export function retarget(forms: readonly (readonly Step[])[], map: Readonly<Record<string, string>>): Step[][] {
  return forms.map((form) =>
    form.map((step) => ({
      ...step,
      play: step.play
        .split(/\s+/)
        .flatMap((tok) => {
          const m = /^(?:(\w+):)?(\w+)(.*)$/.exec(tok);
          if (!m || !(m[2] in map)) return [tok];
          return map[m[2]]
            .split(/\s+/)
            .filter(Boolean)
            .map((v) => `${m[1] ? `${m[1]}:` : ""}${v}${m[3]}`);
        })
        .join(" "),
    })),
  );
}
