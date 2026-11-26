// 声音的合成（纯函数，输出 Float32Array 采样，不依赖 Web Audio，可在测试里直接检查）：
// - 拨弦：扩展的 Karplus–Strong 弦模型（竖琴、鲁特琴、吉他、乌德琴、古筝……），可做复弦（两根略有音差的弦）与琴身共鸣；
// - 击奏：加法合成的敲击音（钟、钢片琴、木琴、定音鼓），每个分音按自己的时间衰减；
// - 打击乐：鼓皮（音高下滑的正弦 + 噪声）、噪声（沙锤、铃鼓的铃片）、木头（木鱼、裂缝鼓）几种层叠加；
// - 噪声（白、粉红、布朗）与混响的脉冲响应。
import { rng } from "./score";

// ───────────────────────────── 滤波

/** 双二阶滤波器系数（RBJ 音频 EQ 手册）。 */
export type Biquad = readonly [number, number, number, number, number];

export function biquad(kind: "lowpass" | "highpass" | "bandpass" | "peaking", f: number, q: number, gainDb: number, sr: number): Biquad {
  const w = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (kind) {
    case "lowpass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** 就地滤波。 */
export function filter(x: Float32Array, c: Biquad): Float32Array {
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const y = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xn;
    y2 = y1;
    y1 = y;
    x[n] = y;
  }
  return x;
}

/** 去直流（一阶高通，约 20 Hz）。 */
function dcBlock(x: Float32Array, sr: number): void {
  const r = 1 - (2 * Math.PI * 20) / sr;
  let px = 0,
    py = 0;
  for (let n = 0; n < x.length; n++) {
    const y = x[n] - px + r * py;
    px = x[n];
    py = y;
    x[n] = y;
  }
}

/** 峰值。 */
export function peak(x: Float32Array): number {
  let p = 0;
  for (let n = 0; n < x.length; n++) {
    const a = Math.abs(x[n]);
    if (a > p) p = a;
  }
  return p;
}

/** 把峰值缩放到 target。全静音时原样返回。 */
function normalize(x: Float32Array, target: number): Float32Array {
  const p = peak(x);
  if (p > 0) {
    const k = target / p;
    for (let n = 0; n < x.length; n++) x[n] *= k;
  }
  return x;
}

/** 截掉尾部低于峰值 −60 dB 的部分，并在末尾 15 ms 淡出，避免“咔嗒”。 */
function trim(x: Float32Array, sr: number): Float32Array {
  const p = peak(x);
  if (p === 0) return x.subarray(0, Math.min(x.length, 16));
  const floor = p * 0.001;
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last]) < floor) last--;
  const fade = Math.floor(sr * 0.015);
  const end = Math.min(x.length, last + fade);
  const out = x.slice(0, end);
  for (let k = 0; k < fade && k < end; k++) out[end - 1 - k] *= k / fade;
  return out;
}

// ───────────────────────────── 拨弦（Karplus–Strong）

/** 拨弦乐器的参数。 */
export interface PluckSpec {
  /** 220 Hz 处衰减到 −60 dB 的时间（秒） */
  t60: number;
  /** 衰减随音高变化：t60(f) = t60 × (220 / f)^tilt */
  tilt: number;
  /** 拨弦激励的明亮度 0–1 */
  bright: number;
  /** 拨弦位置（弦长比例；越靠近琴桥越明亮带鼻音，0 为不处理） */
  pick: number;
  /** 弦上的高频损耗 0–0.5（越大越暗、泛音消失得越快） */
  damp: number;
  /** 复弦：两根弦相差的音分（0 = 单弦） */
  course?: number;
  /** 拨弦瞬间的指甲 / 拨片噪声 */
  thump?: number;
  /** 琴身共鸣：[频率, Q, 增益 dB] */
  body?: readonly (readonly [number, number, number])[];
  /** 最终低通（Hz） */
  lp?: number;
  /** 最长时长（秒） */
  max?: number;
  /**
   * 琴桥的“嗡”（三味线的 sawari、西塔琴与坦布拉的 jawari）：弦每个周期往一侧摆到最远时擦着弯曲的桥面“啪”地碰一下。
   * 碰的那一截（单边、超过当前振幅 at 倍的部分）是一串很窄的脉冲，高通（hp，缺省 1200 Hz）后按 level 加回去——
   * 嗞嗞的高次谐波跟着弦的振幅走，整段余音里一直亮着（普通的弦高频先消失），音高不变。
   */
  buzz?: { at: number; level: number; hp?: number };
  /** 共鸣弦（西塔琴的 taraf）：几根调在音阶上的弦被主弦带着响；notes 为它们的音高（MIDI），level 为耦合量，t60 为余音（秒） */
  sympathetic?: { notes: readonly number[]; level: number; t60: number };
  /** 琴皮（三味线的猫皮）：拨子打在皮上的一声闷响：[频率 Hz, 衰减到 −60 dB 的秒数, 音量] */
  skin?: readonly [number, number, number];
  /** 高八度的一根弦（恰朗戈的复弦里夹着的八度弦）：相对主弦的音量 */
  octave?: number;
  /** 起音的淡入（秒，缺省 0.0015）：很亮、带“嗡”的弦（西塔琴）在安静处起音时留长一点，免得头几个采样跳得太猛 */
  onset?: number;
  /**
   * 沙沙的附件（与击奏的 rattle 同一种做法）：琴头上挂的铁片与铁环（格纳瓦的金布里琴的 sersera）跟着弦的振幅抖，
   * 只在振幅大于 gate（相对峰值）时响；音量 level、频带 lo–hi Hz。不经过琴身与低通（铁片挂在琴头上，不在箱体里）。
   */
  rattle?: { level: number; lo: number; hi: number; gate: number };
}

/** 碰桥的深度：弦往负的一侧越过 at 的那一截（没碰到时为 0）。只在一侧，振幅小于阈值时为 0。 */
export function bridge(y: number, at: number): number {
  return y < -at ? -at - y : 0;
}

/**
 * 琴桥的“嗡”（就地）：跟踪弦的振幅（每个周期的峰值，50 毫秒慢落），超过当前振幅 at 倍的负半周那一截是碰桥的脉冲，
 * 高通后按 level 加回去。
 */
function bridgeBuzz(x: Float32Array, buzz: NonNullable<PluckSpec["buzz"]>, sr: number): void {
  const fall = Math.exp(-1 / (sr * 0.05));
  const b = new Float32Array(x.length);
  let env = 0;
  for (let n = 0; n < x.length; n++) {
    env = Math.max(Math.abs(x[n]), env * fall);
    b[n] = bridge(x[n], buzz.at * env);
  }
  const hp = biquad("highpass", buzz.hp ?? 1200, 0.7, 0, sr);
  filter(b, hp);
  filter(b, hp);
  for (let n = 0; n < x.length; n++) x[n] += b[n] * buzz.level;
}

function ksString(freq: number, spec: PluckSpec, sr: number, rand: () => number, len: number, out: Float32Array, gain: number): Float32Array {
  const P = sr / freq;
  const S = Math.min(0.5, Math.max(0.01, spec.damp));
  const D = P - S;
  let N = Math.floor(D);
  let d = D - N;
  if (d < 0.1) {
    N -= 1;
    d += 1;
  }
  N = Math.max(2, N);
  const C = (1 - d) / (1 + d);
  const w = (2 * Math.PI * freq) / sr;
  const H = Math.sqrt((1 - S) * (1 - S) + S * S + 2 * S * (1 - S) * Math.cos(w));
  const t60 = spec.t60 * Math.pow(220 / freq, spec.tilt);
  const rho = Math.min(0.99999, Math.pow(0.001, 1 / (freq * t60)) / H);
  // 激励：一个周期长的低通噪声，去直流，再按拨弦位置做梳状滤波
  const exc = new Float32Array(N);
  const a = 0.08 + 0.9 * spec.bright * spec.bright;
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += a * (rand() * 2 - 1 - lp);
    exc[i] = lp;
  }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += exc[i];
  mean /= N;
  for (let i = 0; i < N; i++) exc[i] -= mean;
  if (spec.pick > 0) {
    const k = Math.max(1, Math.round(spec.pick * N));
    for (let i = N - 1; i >= k; i--) exc[i] -= exc[i - k];
  }
  normalize(exc, 1);
  ksLoop(N, S, C, rho, exc, len, out, gain);
  // 拨弦瞬间的噪声
  const thump = spec.thump ?? 0;
  if (thump > 0) for (let n = 0; n < N && n < len; n++) out[n] += exc[n] * thump * gain * (1 - n / N);
  return out;
}

/** 弦环：N 个采样的延迟、两点低通（损耗 S）、一阶全通（小数延迟 C）、反馈 rho；前 N 个采样注入激励。 */
function ksLoop(N: number, S: number, C: number, rho: number, exc: Float32Array, len: number, out: Float32Array, gain: number): void {
  const ring = new Float32Array(N);
  let prev = 0,
    apx = 0,
    apy = 0;
  for (let n = 0; n < len; n++) {
    const idx = n % N;
    const r = ring[idx];
    const low = (1 - S) * r + S * prev;
    prev = r;
    const ap = C * low + apx - C * apy;
    apx = low;
    apy = ap;
    const y = rho * ap + (n < N ? exc[n] : 0);
    ring[idx] = y;
    out[n] += y * gain;
  }
}

/**
 * 共鸣弦：每根是一个梳状共振器（延迟一个周期、环里一点低通），由主弦的声音推着响——主弦的谐波与它对得上时响得最多，
 * 拨弦一瞬的宽频噪声也会让它们都轻轻地“沙”一下（西塔琴每一拨后面那层微光）。就地加到 x 上。
 */
function sympathize(x: Float32Array, sym: NonNullable<PluckSpec["sympathetic"]>, sr: number): void {
  const src = Float32Array.from(x);
  for (const m of sym.notes) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    if (f <= 0 || f > sr * 0.2) continue;
    // 环里的一阶低通 lp = 0.7·新 + 0.3·旧 在低频带来约 0.43 个采样的延迟，从周期里扣掉
    const P = sr / f - 0.43;
    const N = Math.floor(P);
    const frac = P - N;
    const rho = Math.pow(0.001, 1 / (f * sym.t60));
    const size = N + 2;
    const buf = new Float32Array(size);
    let lp = 0;
    for (let n = 0; n < x.length; n++) {
      const a = buf[(n - N + size * 4) % size];
      const b = buf[(n - N - 1 + size * 4) % size];
      lp = 0.7 * ((1 - frac) * a + frac * b) + 0.3 * lp;
      const y = src[n] * sym.level + rho * lp;
      buf[n % size] = y;
      x[n] += y;
    }
  }
}

/** 拨一根（或一对）弦。输出峰值约 0.8。 */
export function pluck(spec: PluckSpec, freq: number, sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const t60 = spec.t60 * Math.pow(220 / freq, spec.tilt);
  const len = Math.floor(sr * Math.min(spec.max ?? 6, Math.max(0.25, t60 * 1.1)));
  const out = new Float32Array(len);
  const course = spec.course ?? 0;
  if (course > 0) {
    ksString(freq * Math.pow(2, course / 2400), spec, sr, rand, len, out, 0.5);
    ksString(freq * Math.pow(2, -course / 2400), spec, sr, rand, len, out, 0.5);
  } else ksString(freq, spec, sr, rand, len, out, 1);
  if (spec.octave && freq * 2 < sr * 0.2) ksString(freq * 2 * Math.pow(2, 3 / 1200), spec, sr, rand, len, out, spec.octave);
  if (spec.buzz) bridgeBuzz(out, spec.buzz, sr);
  if (spec.sympathetic) sympathize(out, spec.sympathetic, sr);
  if (spec.skin) {
    // 拨子打在琴皮上：一声很快消失的闷响（起音 0.4 毫秒）
    const [f, t60, level] = spec.skin;
    const d = Math.pow(0.001, 1 / (sr * t60));
    const rise = Math.max(1, Math.floor(sr * 0.0004));
    let e = level;
    for (let n = 0; n < len && e > 1e-5; n++) {
      out[n] += Math.sin((2 * Math.PI * f * n) / sr) * e * Math.min(1, n / rise);
      e *= d;
    }
  }
  for (const [f, q, g] of spec.body ?? []) filter(out, biquad("peaking", f, q, g, sr));
  if (spec.lp) filter(out, biquad("lowpass", spec.lp, 0.707, 0, sr));
  if (spec.rattle) rattleOn(out, spec.rattle, sr, rand);
  dcBlock(out, sr);
  // 起音的头 1.5 毫秒淡入（手指或拨片离弦的一瞬）：激励是一段明亮的噪声，不淡入时第一个采样就跳得很高，
  // 明亮的拨弦（西特琴、曼陀林）在安静处听起来像“咔嗒”
  const onset = Math.min(out.length, Math.floor(sr * (spec.onset ?? 0.0015)));
  for (let n = 0; n < onset; n++) out[n] *= n / onset;
  return trim(normalize(out, 0.8), sr);
}

// ───────────────────────────── 击奏（加法合成）

/** 击奏乐器的参数。 */
export interface MalletSpec {
  /** 分音：[频率比, 振幅, 衰减到 −60 dB 的秒数] */
  partials: readonly (readonly [number, number, number])[];
  /** 起音（秒） */
  attack?: number;
  /** 敲击噪声：[音量, 衰减秒, 低通 Hz] */
  strike?: readonly [number, number, number];
  /** 每个分音分成两个相差 beat Hz 的音（钟声的“嗡嗡”拍音） */
  beat?: number;
  /** 衰减随音高变化（与拨弦相同） */
  tilt?: number;
  max?: number;
  /** 音高的滑动（锣）：每个分音从 from 倍的频率指数地滑到本来的频率，时间常数 time 秒（京剧的小锣往上翘、大锣往下沉） */
  glide?: { from: number; time: number };
  /**
   * 沙沙的附件（拇指琴的铁环与瓶盖、甘美兰没有）：跟着振幅抖的带通噪声，只在振幅大于 gate（相对峰值）时响，
   * 音量 level、频带 lo–hi Hz。
   */
  rattle?: { level: number; lo: number; hi: number; gate: number };
  /**
   * 共鸣葫芦上的膜（非洲木琴的 mirliton：葫芦口蒙着蛛网的卵囊膜或薄纸，刚果、安哥拉的马林巴与曼丁的巴拉丰都有）：
   * 膜被葫芦里的气推着，每个周期往外鼓到头时“啪”地拍一下葫芦口——琴键的乐音很接近正弦，削掉一截（琴桥那样）几乎不出高次谐波，
   * 所以这里是每个周期一段方的“拍”（波形越过当前振幅 at 倍的那段时间里，脉冲的高度等于当前振幅），每一拍的轻重有一点乱（jitter，缺省 0.35，膜是软的），
   * 两次高通（hp，缺省 900 Hz）、一次低通（lp，缺省 5000 Hz：鼻音集中在一两千赫，不要电子的“滋滋”）后按 level 加回去：
   * 跟着音高走的“嗞嗞”的鼻音。fade 让嗡声比乐音消失得快（乘以 (振幅/峰值)^fade）。
   */
  buzz?: { at: number; level: number; hp?: number; lp?: number; fade?: number; jitter?: number };
  /**
   * 口弦（女真、满洲与黑龙江一带都有，阿伊努人叫 mukkuri）：簧片总在同一个低音 hz 上振动，它的谐波（1…count 次，振幅 floor/k^tilt）一直都在、嗡嗡的；
   * 嘴的共鸣腔把离所奏音高最近的谐波放大（高斯形，宽 width 个八度，加上振幅 gain——与是第几个谐波无关，旋律各音一样响）——旋律是被挑出来的泛音，
   * 所以只奏得出 hz 的整数倍（写在谱上的音高就近落到某个谐波上）。共鸣腔在起音后 0.06 秒里从 sweep 倍处滑到所奏的音（“嘣——”的一下），
   * 被放大的谐波余音长（t60 秒），别的短得多。写了 drone 时 partials、beat、glide、rattle 都不用。
   */
  drone?: { hz: number; count: number; width: number; gain: number; floor: number; t60: number; tilt?: number; sweep?: number };
}

/**
 * 膜的嗡（就地）：跟踪振幅（50 毫秒慢落），负半周越过 at 倍振幅的那段时间是膜贴在葫芦口上，输出高度为当前振幅的方脉冲
 * （按 (振幅/峰值)^fade 减弱，每个脉冲的高度乘 1 ± jitter 的随机数），两次高通后按 level 加回去。
 */
function membraneBuzz(x: Float32Array, buzz: NonNullable<MalletSpec["buzz"]>, sr: number, rand: () => number): void {
  const p = peak(x);
  if (p === 0) return;
  const fall = Math.exp(-1 / (sr * 0.05));
  const fade = buzz.fade ?? 0;
  const jitter = buzz.jitter ?? 0.35;
  const b = new Float32Array(x.length);
  let env = 0;
  let touching = false;
  let k = 1;
  for (let n = 0; n < x.length; n++) {
    env = Math.max(Math.abs(x[n]), env * fall);
    const on = x[n] < -buzz.at * env;
    // 每贴一次换一个轻重
    if (on && !touching) k = 1 + jitter * (rand() * 2 - 1);
    touching = on;
    b[n] = on ? -env * k * (fade > 0 ? Math.pow(env / p, fade) : 1) : 0;
  }
  const hp = biquad("highpass", buzz.hp ?? 900, 0.7, 0, sr);
  filter(b, hp);
  filter(b, hp);
  filter(b, biquad("lowpass", buzz.lp ?? 5000, 0.7, 0, sr));
  for (let n = 0; n < x.length; n++) x[n] += b[n] * buzz.level;
}

/** 沙沙的附件：振幅（快起、10 毫秒慢落的包络）超过 gate 的部分推着一层带通噪声，就地加到 x 上。 */
function rattleOn(x: Float32Array, r: NonNullable<MalletSpec["rattle"]>, sr: number, rand: () => number): void {
  const p = peak(x);
  if (p === 0) return;
  const fall = Math.exp(-1 / (sr * 0.01));
  const buzz = new Float32Array(x.length);
  let e = 0;
  for (let n = 0; n < x.length; n++) {
    e = Math.max(Math.abs(x[n]) / p, e * fall);
    const a = Math.max(0, e - r.gate) / Math.max(1e-6, 1 - r.gate);
    buzz[n] = (rand() * 2 - 1) * a;
  }
  const center = Math.sqrt(r.lo * r.hi);
  filter(buzz, biquad("bandpass", center, Math.max(0.3, center / Math.max(1, r.hi - r.lo)), 0, sr));
  filter(buzz, biquad("highpass", r.lo * 0.7, 0.7, 0, sr));
  for (let n = 0; n < x.length; n++) x[n] += buzz[n] * r.level * p * 2.5;
}

/** 口弦拨一下（见 MalletSpec.drone）：所有谐波都在簧片的低音上，共鸣腔挑出所奏音高附近的那一个。输出峰值约 0.8。 */
function jawHarp(spec: MalletSpec, d: NonNullable<MalletSpec["drone"]>, freq: number, sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const len = Math.floor(sr * Math.min(spec.max ?? 3, Math.max(0.1, d.t60 * 1.1)));
  const out = new Float32Array(len);
  const from = d.sweep ?? 1;
  const block = 32;
  // 共鸣腔的中心：起音时在 from 倍处，按 0.06 秒的时间常数滑到所奏的音（每 block 个采样算一次）
  const centers = new Float32Array(Math.ceil(len / block));
  for (let b = 0; b < centers.length; b++) centers[b] = freq * (1 + (from - 1) * Math.exp(-(b * block) / (sr * 0.06)));
  for (let k = 1; k <= d.count && k * d.hz < sr * 0.45; k++) {
    const f = k * d.hz;
    const w = (2 * Math.PI * f) / sr;
    const phase = rand() * 2 * Math.PI;
    const near = Math.log2(f / freq) / d.width;
    const home = Math.exp(-near * near);
    const decay = Math.pow(0.001, 1 / (sr * d.t60 * (0.25 + 0.75 * home)));
    const base = 1 / Math.pow(k, d.tilt ?? 0.7);
    const c2 = 2 * Math.cos(w);
    let s1 = Math.sin(phase - w);
    let s2 = Math.sin(phase - 2 * w);
    let env = 1;
    let gw = 0;
    for (let n = 0; n < len; n++) {
      if (n % block === 0) {
        const x = Math.log2(f / centers[n / block]) / d.width;
        gw = base * d.floor + d.gain * Math.exp(-x * x);
      }
      const s = c2 * s1 - s2;
      s2 = s1;
      s1 = s;
      out[n] += s * env * gw;
      env *= decay;
      if (env < 1e-6) break;
    }
  }
  const attack = Math.floor(sr * (spec.attack ?? 0.002));
  for (let n = 0; n < attack && n < len; n++) out[n] *= n / attack;
  if (spec.strike) {
    // 手指弹簧片的一下
    const [level, dec, lpHz] = spec.strike;
    const burst = new Float32Array(Math.min(len, Math.floor(sr * dec * 3)));
    const dd = Math.pow(0.001, 1 / (sr * dec));
    let e = 1;
    for (let n = 0; n < burst.length; n++) {
      burst[n] = (rand() * 2 - 1) * e;
      e *= dd;
    }
    filter(burst, biquad("lowpass", lpHz, 0.7, 0, sr));
    for (let n = 0; n < burst.length; n++) out[n] += burst[n] * level;
  }
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}

/** 敲一下。输出峰值约 0.8。 */
export function mallet(spec: MalletSpec, freq: number, sr: number, seed: number): Float32Array {
  if (spec.drone) return jawHarp(spec, spec.drone, freq, sr, seed);
  const rand = rng(seed);
  const tilt = spec.tilt ?? 0.3;
  const k = Math.pow(220 / freq, tilt);
  const longest = Math.max(...spec.partials.map((p) => p[2] * k));
  const len = Math.floor(sr * Math.min(spec.max ?? 6, Math.max(0.1, longest)));
  const out = new Float32Array(len);
  const beat = spec.beat ?? 0;
  const glide = spec.glide;
  for (const [ratio, amp, t60] of spec.partials) {
    const parts = beat > 0 ? [ratio * freq - beat / 2, ratio * freq + beat / 2] : [ratio * freq];
    for (const f of parts) {
      if (f * Math.max(1, glide?.from ?? 1) >= sr * 0.45 || f <= 0) continue;
      const phase = rand() * 2 * Math.PI;
      const decay = Math.pow(0.001, 1 / (sr * t60 * k));
      let env = amp / parts.length;
      if (glide) {
        // 滑音：相位累加，频率 f·(1 + (from − 1)·e^(−t/time))
        const g = Math.exp(-1 / (sr * glide.time));
        let dev = glide.from - 1;
        let ph = phase;
        for (let n = 0; n < len; n++) {
          ph += (2 * Math.PI * f * (1 + dev)) / sr;
          dev *= g;
          out[n] += Math.sin(ph) * env;
          env *= decay;
          if (env < 1e-6) break;
        }
        continue;
      }
      const w = (2 * Math.PI * f) / sr;
      // 递推正弦：s[n] = 2cos(w)·s[n−1] − s[n−2]
      const c2 = 2 * Math.cos(w);
      let s1 = Math.sin(phase - w);
      let s2 = Math.sin(phase - 2 * w);
      for (let n = 0; n < len; n++) {
        const s = c2 * s1 - s2;
        s2 = s1;
        s1 = s;
        out[n] += s * env;
        env *= decay;
        if (env < 1e-6) break;
      }
    }
  }
  if (spec.buzz) membraneBuzz(out, spec.buzz, sr, rand);
  if (spec.rattle) rattleOn(out, spec.rattle, sr, rand);
  const attack = Math.floor(sr * (spec.attack ?? 0.002));
  for (let n = 0; n < attack && n < len; n++) out[n] *= n / attack;
  if (spec.strike) {
    const [level, dec, lpHz] = spec.strike;
    const burst = new Float32Array(Math.min(len, Math.floor(sr * dec * 3)));
    const d = Math.pow(0.001, 1 / (sr * dec));
    let e = 1;
    for (let n = 0; n < burst.length; n++) {
      burst[n] = (rand() * 2 - 1) * e;
      e *= d;
    }
    filter(burst, biquad("lowpass", lpHz, 0.7, 0, sr));
    for (let n = 0; n < burst.length; n++) out[n] += burst[n] * level;
  }
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}

// ───────────────────────────── 打击乐

/** 打击乐的一层。 */
export type DrumLayer =
  | {
      /** 鼓皮：正弦从 f0 滑到 f1（时间常数 bend 秒），按 decay 秒衰减 */
      kind: "skin";
      f0: number;
      f1: number;
      bend: number;
      decay: number;
      level: number;
      /** 额外的鼓皮泛音：[频率比, 振幅, 衰减秒] */
      modes?: readonly (readonly [number, number, number])[];
      /** 起音（秒，缺省 0：一下子就到）：很硬的木头在安静处一敲，头几个采样跳得太猛会像“咔嗒”，留零点几毫秒 */
      attack?: number;
      /**
       * 滑音前停多久（秒，缺省 0：一敲就开始滑）：说话鼓（沙漏形的鼓，腋下夹着绳子）敲下去先响一下原来的音高，
       * 胳膊再一夹（或一松）音高才往上（或往下）走——f0 停 hold 秒，再按 bend 的时间常数滑到 f1。
       */
      hold?: number;
    }
  | {
      /** 噪声：带通 lo–hi Hz，起音 attack 秒，衰减 decay 秒；taps 为铃片的连续几下（间隔几毫秒） */
      kind: "noise";
      lo: number;
      hi: number;
      attack?: number;
      decay: number;
      level: number;
      taps?: number;
    }
  | {
      /**
       * 刮奏（刮瓜 güiro 一类：棍子刮过葫芦上一道道的槽；成团的种子、果壳一阵阵地撞）：dur 秒的一段连续的摩擦噪声（带通 lo–hi Hz），
       * 上面压着一串差不多等间隔的“咔”（每秒 rate 下，间隔各自抖 ±jitter 个间隔；每一下 click 秒衰减到底噪 floor）；
       * 整段的轻重先起后落（刮到中段最响），从 0 起、到 0 止。
       * 与 noise 的 taps 不同：taps 是随机散开的几下（铃片），这里是有节律的一串（听得出“嘎啦啦”的颗粒）；
       * 两下之间留着 floor 的摩擦声、不掉到静音，所以一串“咔”在安静处也不会一下下地蹦出来。
       */
      kind: "rasp";
      lo: number;
      hi: number;
      rate: number;
      dur: number;
      click: number;
      level: number;
      jitter?: number;
      /** 两下之间的摩擦声（相对一下“咔”的顶点，缺省 0.3） */
      floor?: number;
      /**
       * 共鸣腔（可选）：[频率 Hz, Q, 比例]——同一串摩擦再经过一个窄的带通（不受 lo–hi 的带通与高通限制）加回去，
       * 每一下“咔”都带着空腔的一声“空”（骨刮下面垫着的头骨或葫芦）。
       */
      body?: readonly [number, number, number];
    };

/** 一种鼓点：若干层叠加。 */
export interface DrumSpec {
  layers: readonly DrumLayer[];
  /** 每个变体的随机偏差（比例，缺省 0.04） */
  vary?: number;
}

/** 击一下鼓（variant 不同时音高、衰减略有差别）。输出峰值约 0.8。 */
export function drum(spec: DrumSpec, sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const vary = spec.vary ?? 0.04;
  const j = () => 1 + (rand() * 2 - 1) * vary;
  const longest = Math.max(...spec.layers.map((l) => (l.kind === "skin" ? l.decay : l.kind === "noise" ? l.decay + (l.attack ?? 0) : l.dur + l.click * 2)));
  const len = Math.floor(sr * Math.min(3, longest * 1.2 + 0.02));
  const out = new Float32Array(len);
  for (const l of spec.layers) {
    if (l.kind === "rasp") {
      rasp(out, l, sr, rand);
      continue;
    }
    if (l.kind === "skin") {
      const f0 = l.f0 * j();
      const f1 = l.f1 * j();
      const decay = Math.pow(0.001, 1 / (sr * l.decay * j()));
      const bend = Math.exp(-1 / (sr * l.bend));
      let f = f0;
      let phase = 0;
      let env = l.level;
      const rise = Math.max(1, Math.floor(sr * (l.attack ?? 0)));
      const ramp = (n: number) => (n < rise ? n / rise : 1);
      const holdN = Math.floor(sr * (l.hold ?? 0));
      for (let n = 0; n < len; n++) {
        phase += (2 * Math.PI * f) / sr;
        if (n >= holdN) f = f1 + (f - f1) * bend;
        out[n] += Math.sin(phase) * env * (rise > 1 ? ramp(n) : 1);
        env *= decay;
      }
      for (const [ratio, amp, dec] of l.modes ?? []) {
        const w = (2 * Math.PI * f1 * ratio * j()) / sr;
        const d = Math.pow(0.001, 1 / (sr * dec));
        let e = l.level * amp;
        const ph = rand() * 6.283;
        for (let n = 0; n < len && e > 1e-6; n++) {
          out[n] += Math.sin(ph + w * n) * e * (rise > 1 ? ramp(n) : 1);
          e *= d;
        }
      }
    } else {
      const buf = new Float32Array(len);
      const attack = Math.max(1, Math.floor(sr * (l.attack ?? 0.001)));
      const d = Math.pow(0.001, 1 / (sr * l.decay * j()));
      const taps = l.taps ?? 1;
      for (let t = 0; t < taps; t++) {
        const start = t === 0 ? 0 : Math.floor(sr * (0.004 + rand() * 0.012) * t);
        let e = l.level * (t === 0 ? 1 : 0.55 + rand() * 0.3);
        for (let n = start; n < len; n++) {
          const a = n - start < attack ? (n - start) / attack : 1;
          buf[n] += (rand() * 2 - 1) * e * a;
          if (n - start >= attack) e *= d;
          if (e < 1e-6) break;
        }
      }
      const center = Math.sqrt(l.lo * l.hi);
      const q = Math.max(0.3, center / Math.max(1, l.hi - l.lo));
      filter(buf, biquad("bandpass", center, q, 0, sr));
      filter(buf, biquad("highpass", l.lo * 0.7, 0.7, 0, sr));
      for (let n = 0; n < len; n++) out[n] += buf[n] * 2.5;
    }
  }
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}

/**
 * 刮奏的一层（就地加到 out 上）：dur 秒的白噪声，乘上两层包络——
 * 整段的轻重 sin(π·t / dur)^0.6（从 0 起、到 0 止，先起后落），与一串“咔”：第 k 下在 k / rate 秒（各自抖 ±jitter 个间隔），
 * 每一下把颗粒包络推到 0.8–1.2（0.3 毫秒的平滑，不是一下子跳上去），之后 click 秒指数地落回底噪 floor。
 * 最后与 noise 层同样带通、高通；有共鸣腔（body）时，同一串摩擦另经一个窄带通加回去。
 */
function rasp(out: Float32Array, l: Extract<DrumLayer, { kind: "rasp" }>, sr: number, rand: () => number): void {
  const len = out.length;
  const buf = new Float32Array(len);
  const n = Math.max(1, Math.round(l.dur * l.rate));
  const jitter = l.jitter ?? 0.15;
  const floor = l.floor ?? 0.3;
  const at: number[] = [];
  for (let k = 0; k < n; k++) at.push(Math.max(0, Math.floor(sr * ((k + (k === 0 ? 0 : (rand() * 2 - 1) * jitter)) / l.rate))));
  at.sort((a, b) => a - b);
  const end = Math.max(1, Math.min(len, Math.floor(sr * l.dur)));
  const fall = Math.pow(0.001, 1 / (sr * l.click));
  const smooth = 1 - Math.exp(-1 / (sr * 0.0003));
  let next = 0;
  let pulse = 0;
  let grain = 0;
  for (let i = 0; i < end; i++) {
    while (next < at.length && at[next] <= i) {
      pulse = 0.8 + rand() * 0.4;
      next++;
    }
    grain += (pulse - grain) * smooth;
    pulse *= fall;
    const shape = Math.pow(Math.sin((Math.PI * (i + 0.5)) / end), 0.6);
    buf[i] = (rand() * 2 - 1) * l.level * shape * (floor + (1 - floor) * grain);
  }
  let res: Float32Array | null = null;
  if (l.body) {
    const [f, bq, mix] = l.body;
    res = filter(Float32Array.from(buf), biquad("bandpass", f, bq, 0, sr));
    for (let i = 0; i < len; i++) res[i] *= mix;
  }
  const center = Math.sqrt(l.lo * l.hi);
  const q = Math.max(0.3, center / Math.max(1, l.hi - l.lo));
  filter(buf, biquad("bandpass", center, q, 0, sr));
  filter(buf, biquad("highpass", l.lo * 0.7, 0.7, 0, sr));
  for (let i = 0; i < len; i++) out[i] += (buf[i] + (res ? res[i] : 0)) * 2.5;
}

// ───────────────────────────── 噪声与混响

/** 循环用的噪声（白 / 粉红 / 布朗），首尾相接处做了交叉淡化。 */
export function noise(kind: "white" | "pink" | "brown", seconds: number, sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const len = Math.floor(seconds * sr);
  const out = new Float32Array(len);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    brown = 0;
  for (let n = 0; n < len; n++) {
    const w = rand() * 2 - 1;
    if (kind === "white") out[n] = w * 0.5;
    else if (kind === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[n] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    } else {
      brown = (brown + w * 0.02) * 0.998;
      out[n] = brown;
    }
  }
  // 三种噪声统一到相同的均方根（0.2），换用时响度一致
  let e = 0;
  for (let n = 0; n < len; n++) e += out[n] * out[n];
  const k = 0.2 / Math.sqrt(e / Math.max(1, len) || 1);
  for (let n = 0; n < len; n++) out[n] *= k;
  // 首尾交叉淡化 50 ms，循环播放时没有接缝
  const fade = Math.min(Math.floor(sr * 0.05), Math.floor(len / 4));
  for (let k = 0; k < fade; k++) {
    const a = k / fade;
    out[k] = out[k] * a + out[len - fade + k] * (1 - a);
  }
  return out.slice(0, len - fade);
}

/** 混响的形状：预延迟（秒）、早期反射散布的时长（秒）、尾巴末端的截止频率（Hz，越低越暗）。 */
export interface ReverbShape {
  pre?: number;
  early?: number;
  dark?: number;
}

/**
 * 混响的脉冲响应（立体声）：预延迟之后几次早期反射，再是指数衰减的噪声尾巴，越往后越暗（高频先消失）。
 * rt60 为衰减到 −60 dB 的秒数；shape 缺省为房间（预延迟 12 ms、反射散在 50 ms 内、尾巴末端 1.5 kHz）。
 */
export function reverbIR(sr: number, rt60: number, seed: number, shape: ReverbShape = {}): [Float32Array, Float32Array] {
  const rand = rng(seed);
  const len = Math.floor(sr * Math.min(4, rt60 * 1.1));
  const pre = Math.floor(sr * (shape.pre ?? 0.012));
  const early = shape.early ?? 0.05;
  const dark = shape.dark ?? 1500;
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (const ch of chans) {
    const decay = Math.pow(0.001, 1 / (sr * rt60));
    let env = 0.6;
    let lp = 0;
    for (let n = pre; n < len; n++) {
      const t = (n - pre) / len;
      // 截止频率从约 9 kHz 滑到 dark（单极点低通的系数随时间变小）
      const fc = 9000 * Math.pow(dark / 9000, t);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (rand() * 2 - 1 - lp);
      ch[n] = lp * env;
      env *= decay;
    }
    // 早期反射：几次稀疏的回声
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.floor(sr * (0.004 + rand() * early));
      if (at < len) ch[at] += (rand() < 0.5 ? -1 : 1) * (0.35 - k * 0.03);
    }
  }
  // 能量归一：让湿声的响度与送量大致成比例
  let e = 0;
  for (const ch of chans) for (let n = 0; n < len; n++) e += ch[n] * ch[n];
  const k = 1 / Math.sqrt(e / 2);
  for (const ch of chans) for (let n = 0; n < len; n++) ch[n] *= k * 0.5;
  return chans;
}

// ───────────────────────────── 环境声的采样

/**
 * 木头的吱呀（船身、桅杆、缆桩在浪里扭动）：摩擦的“粘—滑”——一串先变密、再放慢的小冲击（每秒十几到八十几下），
 * 经过三个木头的共振（带通），整体慢起慢收。输出峰值约 0.8，长 0.45–1.15 秒。
 */
export function creak(sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const len = Math.floor(sr * (0.45 + rand() * 0.7));
  const exc = new Float32Array(len);
  const r0 = 14 + rand() * 12;
  const r1 = 40 + rand() * 45;
  const r2 = 16 + rand() * 16;
  const turn = 0.3 + rand() * 0.3;
  const burst = Math.max(4, Math.floor(sr * 0.004));
  let phase = 0;
  for (let n = 0; n < len; n++) {
    const x = n / len;
    const rate = x < turn ? r0 + (r1 - r0) * (x / turn) : r1 + (r2 - r1) * ((x - turn) / (1 - turn));
    phase += (rate * (0.85 + rand() * 0.3)) / sr;
    if (phase >= 1) {
      phase -= 1;
      // 一次“滑”：几毫秒的衰减噪声
      const amp = 0.5 + rand() * 0.5;
      for (let i = 0; i < burst && n + i < len; i++) exc[n + i] += amp * Math.exp(-i / (burst / 4)) * (rand() * 2 - 1);
    }
  }
  const out = new Float32Array(len);
  const modes: readonly (readonly [number, number, number])[] = [
    [280 + rand() * 140, 10, 1],
    [700 + rand() * 250, 12, 0.6],
    [1500 + rand() * 600, 14, 0.3],
  ];
  for (const [f, q, g] of modes) {
    const y = filter(Float32Array.from(exc), biquad("bandpass", f, q, 0, sr));
    for (let n = 0; n < len; n++) out[n] += y[n] * g;
  }
  for (let n = 0; n < len; n++) out[n] *= Math.pow(Math.sin((Math.PI * n) / len), 0.7);
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}

/**
 * 海鸥的一声叫：音高先猛地升上去、再慢慢落下（“嗷——”），几个谐波加一个鼻音似的共振峰，喉音带一点颤，夹一丝气声。
 * 输出峰值约 0.8，长 0.22–0.44 秒。
 */
export function gull(sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const len = Math.floor(sr * (0.22 + rand() * 0.22));
  const out = new Float32Array(len);
  const base = 700 + rand() * 300;
  const top = base * (1.3 + rand() * 0.25);
  const end = base * (0.72 + rand() * 0.15);
  const peakAt = 0.18 + rand() * 0.14;
  const amps = [1, 0.8, 0.55, 0.35, 0.22, 0.12];
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const x = n / len;
    const f = x < peakAt ? base + (top - base) * Math.sin(((x / peakAt) * Math.PI) / 2) : top + (end - top) * Math.pow((x - peakAt) / (1 - peakAt), 0.8);
    ph += (f * (1 + 0.02 * Math.sin((2 * Math.PI * 31 * n) / sr))) / sr;
    let s = 0;
    for (let h = 0; h < amps.length; h++) if ((h + 1) * f < sr * 0.45) s += amps[h] * Math.sin(2 * Math.PI * (h + 1) * ph);
    const env = Math.min(1, x / 0.05) * Math.pow(1 - x, 0.8);
    out[n] = (s + (rand() * 2 - 1) * 0.15) * env;
  }
  filter(out, biquad("peaking", 2400, 1.1, 7, sr));
  filter(out, biquad("highpass", 450, 0.7, 0, sr));
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}

/**
 * 浪拍在船壳（或码头的木桩）上的一记：一小团低通噪声，起得快、落得稍慢，下面带一声很快消失的船壳闷响。
 * 输出峰值约 0.8，长 0.25–0.55 秒。
 */
export function slap(sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const dur = 0.25 + rand() * 0.3;
  const len = Math.floor(sr * dur);
  const out = new Float32Array(len);
  const attack = Math.max(1, Math.floor(sr * (0.006 + rand() * 0.01)));
  const decay = Math.pow(0.001, 1 / (sr * dur * 0.8));
  let e = 1;
  for (let n = 0; n < len; n++) {
    out[n] = (rand() * 2 - 1) * e * (n < attack ? n / attack : 1);
    if (n >= attack) e *= decay;
  }
  filter(out, biquad("lowpass", 900 + rand() * 700, 0.7, 0, sr));
  const f = 110 + rand() * 60;
  const d = Math.pow(0.001, 1 / (sr * 0.12));
  let g = 0.6;
  for (let n = 0; n < len && g > 1e-5; n++) {
    out[n] += Math.sin((2 * Math.PI * f * n) / sr) * g * (n < attack ? n / attack : 1);
    g *= d;
  }
  dcBlock(out, sr);
  return trim(normalize(out, 0.8), sr);
}
