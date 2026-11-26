// 测试用的假 Web Audio（jsdom 没有）：记录创建的节点、连接、参数的自动化与排的时刻，不出声。
// 够音频引擎（engine.ts）、环境声、音效播放器创建它们要用的节点；解码给一段 50 毫秒、3 毫秒处起音的单声道缓冲。

export interface FakeParam {
  value: number;
  events: [string, number, number][];
  setValueAtTime(v: number, t: number): FakeParam;
  linearRampToValueAtTime(v: number, t: number): FakeParam;
  setTargetAtTime(v: number, t: number, c: number): FakeParam;
  cancelScheduledValues(t: number): FakeParam;
  setValueCurveAtTime(curve: ArrayLike<number>, t: number, d: number): FakeParam;
}

export interface FakeNode {
  kind: string;
  outputs: FakeNode[];
  started?: { when: number; offset: number };
  stopped?: number;
  [key: string]: unknown;
}

function param(value: number): FakeParam {
  const p: FakeParam = {
    value,
    events: [],
    setValueAtTime(v, t) {
      p.events.push(["set", v, t]);
      return p;
    },
    linearRampToValueAtTime(v, t) {
      p.events.push(["ramp", v, t]);
      return p;
    },
    setTargetAtTime(v, t) {
      p.events.push(["target", v, t]);
      return p;
    },
    cancelScheduledValues(t) {
      p.events.push(["cancel", 0, t]);
      return p;
    },
    // 管弦版采样的循环段交叉淡化用（记下曲线的最后一个值）
    setValueCurveAtTime(curve, t, d) {
      p.events.push(["curve", curve.length > 0 ? curve[curve.length - 1] : 0, t + d]);
      return p;
    },
  };
  return p;
}

/** 最后一次安排的目标值（ramp / set / target）。 */
export function lastTarget(p: FakeParam): number {
  const e = [...p.events].reverse().find((x) => x[0] !== "cancel");
  return e ? e[1] : p.value;
}

class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(Math.max(1, length)));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src.subarray(0, this.data[c].length));
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  sampleRate: number;
  state: "running" | "suspended" | "closed" = "running";
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 48000;
    this.destination = this.node("destination");
    FakeAudioContext.instances.push(this);
  }

  private node(kind: string, extra: Record<string, unknown> = {}): FakeNode {
    const n: FakeNode = {
      kind,
      outputs: [],
      connect: (to: FakeNode) => {
        n.outputs.push(to);
        return to;
      },
      disconnect: () => {
        n.outputs = [];
      },
      addEventListener: () => {},
      ...extra,
    };
    this.nodes.push(n);
    return n;
  }

  createGain() {
    return this.node("gain", { gain: param(1) });
  }
  createStereoPanner() {
    return this.node("panner", { pan: param(0) });
  }
  createBiquadFilter() {
    return this.node("biquad", { type: "lowpass", frequency: param(350), Q: param(1), gain: param(0) });
  }
  createDynamicsCompressor() {
    return this.node("compressor", { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) });
  }
  createConvolver() {
    return this.node("convolver", { buffer: null, normalize: true });
  }
  createOscillator() {
    const n = this.node("oscillator", { frequency: param(440), detune: param(0), type: "sine" });
    Object.assign(n, {
      setPeriodicWave: () => {},
      start: (when = 0) => {
        n.started = { when, offset: 0 };
      },
      stop: (t = 0) => {
        n.stopped = t;
      },
    });
    return n;
  }
  createBufferSource() {
    const n = this.node("source", { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), detune: param(0) });
    Object.assign(n, {
      start: (when = 0, offset = 0) => {
        n.started = { when, offset };
      },
      stop: (t = 0) => {
        n.stopped = t;
      },
    });
    return n;
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(ch: number, len: number, sr: number) {
    return new FakeBuffer(ch, len, sr);
  }
  decodeAudioData(): Promise<FakeBuffer> {
    const b = new FakeBuffer(1, Math.round(this.sampleRate * 0.05), this.sampleRate);
    b.getChannelData(0)[Math.round(this.sampleRate * 0.003)] = 0.5;
    return Promise.resolve(b);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }

  /** 从一个节点顺着连接往下走，能不能走到 to。 */
  reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return from.outputs.some((o) => this.reaches(o, to, seen));
  }

  /** 排过开始时刻的缓冲源。 */
  startedSources(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === "source" && n.started);
  }
}

/** 装上假的 AudioContext 与 fetch；返回卸下的函数。 */
export function installFakeAudio(): () => void {
  const g = globalThis as Record<string, unknown>;
  const before = { AudioContext: g.AudioContext, fetch: g.fetch };
  FakeAudioContext.instances = [];
  g.AudioContext = FakeAudioContext;
  g.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  return () => {
    g.AudioContext = before.AudioContext;
    g.fetch = before.fetch;
  };
}
