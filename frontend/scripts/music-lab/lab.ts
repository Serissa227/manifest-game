// 配乐试听台（开发工具，不进游戏的构建）：离线渲染（OfflineAudioContext）曲目与乐器的音色样本，量响度、峰值、咔嗒声与非数，存 WAV。
// 起法见 vite.config.ts 与 run.mjs。常用的表达式（style 是 "orch" 管弦版或 "synth" 复古合成版）：
//   lab.measure("port_japan", "orch")                       每一遍：长度、积分响度（BS.1770 近似：K 计权、−70 与相对 −10 LU 的门限）、短期最大、峰值、削波、非数、咔嗒声
//   lab.renderSave("port_japan", "orch", "clips/x.wav", 40)  渲染第一遍，存开头 40 秒（结尾 1.5 秒淡出），同时给整遍与片段的测量
//   lab.voices("port_japan", "orch")                        每个声部单独渲染的积分响度（混音比例）
//   lab.split("port_japan")                                 管弦版里只奏地方乐器、只奏管弦衬底，各自的响度
//   lab.splitSteps("port_japan", "orch", 1)                 同上，但按段（曲式的每一步）量，另给段内 6 秒窗口里的最小差；衬底每段都要低 7 dB 以上
//   lab.clicks("port_japan", "synth")                       咔嗒声的位置，以及是哪个声部
//   lab.inst("shamisen") / lab.allInst("japan")             地方乐器的音色样本（instruments/regional/ 里每件的 demo），存 demos/<键>.wav
//   lab.instAs("ud", "ud_old", "oud")                       同一段样本换成另一件乐器（新旧对照），或给 patch 临时改参数
//   lab.calibs([["shamisen", 52], ["oud", 52]], true)      音量校准：同一音区的八音音阶（true 为八分音符），同类乐器比积分响度
import { MusicEngine } from "../../src/audio/engine";
import { realizePass, type TrackDef } from "../../src/audio/score";
import { TRACK_IDS, TRACKS, type TrackId } from "../../src/audio/tracks";
import { ORCH_TRACKS } from "../../src/audio/orchestra/tracks";
import { demoTrack, REGIONAL, REGIONAL_INSTRUMENTS, regionalId } from "../../src/audio/instruments/regional";
import { INSTRUMENTS } from "../../src/audio/instruments";

const SR = 44100;

function trackOf(id: TrackId | TrackDef, style: "orch" | "synth" = "orch"): TrackDef {
  if (typeof id !== "string") return id;
  return style === "orch" ? ORCH_TRACKS[id] : TRACKS[id];
}

/** 离线渲染一首曲子的第 pass 遍（solo 给出时只奏这些声部）。 */
async function render(def: TrackDef, pass = 0, solo?: string[], seconds?: number, sr = SR): Promise<AudioBuffer> {
  const len = seconds ?? realizePass(def, pass).length + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const e = new MusicEngine(ctx);
  e.setVolumes(0.6, 0, false);
  const ok = await e.prepare(def);
  if (!ok) throw new Error(`采样加载失败：${def.id}`);
  e.schedulePass(def, pass, solo);
  return ctx.startRendering();
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200);

// ───────────── BS.1770 的 K 计权与积分响度（门限 −70 LUFS 与相对 −10 LU）
function kCoeffs(fs: number) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biq(x: Float32Array, c: { b: number[]; a: number[] }): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const v = c.b[0] * x[n] + c.b[1] * x1 + c.b[2] * x2 - c.a[0] * y1 - c.a[1] * y2;
    x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
  }
  return y;
}

function loudness(buf: AudioBuffer, from = 0, seconds = buf.duration) {
  const sr = buf.sampleRate;
  const a = Math.floor(from * sr);
  const b = Math.min(buf.length, Math.floor((from + seconds) * sr));
  const [shelf, hp] = kCoeffs(sr);
  const chans = [0, 1].map((c) => biq(biq(buf.getChannelData(c).slice(a, b), shelf), hp));
  const blk = Math.floor(0.4 * sr);
  const hop = Math.floor(0.1 * sr);
  const z: number[] = [];
  for (let i = 0; i + blk <= chans[0].length; i += hop) {
    let s = 0;
    for (const ch of chans) for (let k = i; k < i + blk; k++) s += ch[k] * ch[k];
    z.push(s / blk);
  }
  const L = (p: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, p));
  const abs = z.filter((p) => L(p) > -70);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  const rel = L(mean(abs)) - 10;
  const gated = abs.filter((p) => L(p) > rel);
  // 短期响度（3 秒窗口）最大值
  const st = Math.floor(3 * sr);
  let shortMax = -200;
  for (let i = 0; i + st <= chans[0].length; i += hop * 5) {
    let s = 0;
    for (const ch of chans) for (let k = i; k < i + st; k += 2) s += ch[k] * ch[k];
    shortMax = Math.max(shortMax, L(s / (st / 2)));
  }
  return { lufs: +L(mean(gated)).toFixed(1), shortMax: +shortMax.toFixed(1) };
}

function mono(buf: AudioBuffer): Float32Array {
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const m = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) / 2;
  return m;
}

/** 咔嗒声的位置（秒）：安静处（前 5 毫秒的均方根 < 0.01）突然跳 0.08 以上。 */
function clickTimes(buf: AudioBuffer): number[] {
  const sr = buf.sampleRate;
  const m = mono(buf);
  const ms5 = Math.floor(sr * 0.005);
  const out: number[] = [];
  for (let i = ms5; i < m.length - ms5; i++) {
    const d = Math.abs(m[i] - m[i - 1]);
    if (d > 0.08) {
      let s = 0;
      for (let k = i - ms5; k < i - 1; k++) s += m[k] * m[k];
      if (Math.sqrt(s / ms5) < 0.01) out.push(+(i / sr).toFixed(3));
    }
  }
  return out;
}

function stats(buf: AudioBuffer, from = 0, seconds = buf.duration) {
  const sr = buf.sampleRate;
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const a = Math.floor(from * sr);
  const b = Math.min(l.length, Math.floor((from + seconds) * sr));
  let pk = 0, sum = 0, clip = 0, nan = 0;
  for (let i = a; i < b; i++) {
    for (const v of [l[i], r[i]]) {
      if (!Number.isFinite(v)) { nan++; continue; }
      const x = Math.abs(v);
      if (x > pk) pk = x;
      if (x >= 0.999) clip++;
      sum += v * v;
    }
  }
  return {
    seconds: +((b - a) / sr).toFixed(1),
    peakDb: +db(pk).toFixed(1),
    rmsDb: +db(Math.sqrt(sum / (2 * Math.max(1, b - a)))).toFixed(1),
    ...loudness(buf, from, seconds),
    clip,
    nan,
    clicks: clickTimes(buf).filter((t) => t >= from && t < from + seconds).length,
  };
}

/** 编码成 16 位立体声 WAV；fade 秒的淡出（试听片段的结尾）。 */
function wav(buf: AudioBuffer, from = 0, seconds = buf.duration, fade = 0): Blob {
  const sr = buf.sampleRate;
  const a = Math.floor(from * sr);
  const n = Math.min(buf.length - a, Math.floor(seconds * sr));
  const data = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => data.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + n * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, sr, true);
  data.setUint32(28, sr * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, n * 4, true);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const fn = Math.floor(fade * sr);
  for (let i = 0; i < n; i++) {
    const g = fn > 0 && i > n - fn ? (n - i) / fn : 1;
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, (l[a + i] || 0) * g)) * 32767, true);
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, (r[a + i] || 0) * g)) * 32767, true);
  }
  return new Blob([data], { type: "audio/wav" });
}

async function save(name: string, body: Blob | string): Promise<string> {
  return (await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body })).text();
}

/** 渲染一首曲子的第 pass 遍：整遍的测量，另存 [from, from+seconds) 的片段（结尾 1.5 秒淡出）。 */
async function renderSave(id: TrackId, style: "orch" | "synth", name: string, seconds = 40, pass = 0, from = 0) {
  const def = trackOf(id, style);
  const t0 = performance.now();
  const buf = await render(def, pass);
  const whole = stats(buf);
  const clip = stats(buf, from, seconds);
  const saved = await save(name, wav(buf, from, seconds, 1.5));
  return { id, style, pass, passSeconds: +realizePass(def, pass).length.toFixed(1), whole, clip, saved, ms: Math.round(performance.now() - t0) };
}

/** 只量（不存）：每一遍的整遍测量。 */
async function measure(id: TrackId, style: "orch" | "synth", passes = [0, 1]) {
  const def = trackOf(id, style);
  const out: Record<string, unknown> = { id, style };
  for (const p of passes) {
    if (p >= def.forms.length) continue;
    const buf = await render(def, p);
    out[`pass${p}`] = { passSeconds: +realizePass(def, p).length.toFixed(1), ...stats(buf) };
  }
  return out;
}

/** 渲染一份临时的曲谱（乐器的音色样本），存 WAV。 */
async function demo(def: TrackDef, name: string, seconds?: number) {
  const buf = await render(def, 0, undefined, seconds);
  const st = stats(buf);
  const saved = await save(name, wav(buf));
  return { name, ...st, saved };
}

/** 咔嗒声的位置，以及每个声部单独渲染时各自的咔嗒声位置（找是哪个声部）。 */
async function clicks(id: TrackId, style: "orch" | "synth", pass = 0) {
  const def = trackOf(id, style);
  const all = clickTimes(await render(def, pass));
  const per: Record<string, number[]> = {};
  if (all.length) for (const v of Object.keys(def.voices)) {
    const c = clickTimes(await render(def, pass, [v]));
    if (c.length) per[v] = c.slice(0, 10);
  }
  return { all: all.slice(0, 20), per };
}

/** 管弦版第 pass 遍：只奏地方乐器（含打击乐）与只奏管弦衬底，各自的积分响度。 */
async function split(id: TrackId, pass = 0) {
  const def = trackOf(id, "orch");
  const orch = Object.keys(def.voices).filter((v) => def.voices[v].inst.startsWith("o."));
  const regional = Object.keys(def.voices).filter((v) => !def.voices[v].inst.startsWith("o."));
  return {
    id,
    regional: loudness(await render(def, pass, regional)).lufs,
    orchestra: loudness(await render(def, pass, orch)).lufs,
  };
}

/**
 * 按段量“领奏比衬底高多少”：第 pass 遍的每一步（曲式里的一段），只奏地方乐器（含打击乐）与只奏衬底，各自的积分响度与差（dB），
 * 另给段内 6 秒窗口（每 3 秒一个）里差的最小值。整遍的 split 会被别的段落拉平，衬底一段一段都要比领奏低 7 dB 以上。
 * 衬底：管弦版是 o. 开头的声部；合成版是既不是地方乐器、也不是打击乐（perc）的声部（钢片琴、弦乐长音、持续音……）。
 */
async function splitSteps(id: TrackId, style: "orch" | "synth" = "orch", pass = 0) {
  const def = trackOf(id, style);
  const isBed = (v: string) => {
    const inst = def.voices[v].inst;
    return inst.startsWith("o.") || (inst !== "perc" && !Object.prototype.hasOwnProperty.call(REGIONAL_INSTRUMENTS, inst));
  };
  const names = Object.keys(def.voices);
  const bed = names.filter(isBed);
  const regional = names.filter((v) => !isBed(v));
  const p = realizePass(def, pass);
  const rb = await render(def, pass, regional);
  const bb = await render(def, pass, bed);
  const form = def.forms[pass % def.forms.length];
  return p.steps.map((st, i) => {
    const end = i + 1 < p.steps.length ? p.steps[i + 1].t : p.length;
    const len = end - st.t;
    const r = loudness(rb, st.t, len).lufs;
    const b = loudness(bb, st.t, len).lufs;
    let minWin = 99;
    for (let t = st.t; t + 6 <= end + 0.01; t += 3) {
      const wr = loudness(rb, t, 6).lufs;
      const wb = loudness(bb, t, 6).lufs;
      if (wb > -60) minWin = Math.min(minWin, +(wr - wb).toFixed(1));
    }
    return { step: st.step, s: form[st.step].s, from: +st.t.toFixed(1), to: +end.toFixed(1), regional: r, bed: b, diff: +(r - b).toFixed(1), minWin };
  });
}

/** 各声部单独渲染：整遍的积分响度。 */
async function voices(id: TrackId, style: "orch" | "synth", pass = 0, seconds?: number) {
  const def = trackOf(id, style);
  const out: Record<string, number> = {};
  for (const v of Object.keys(def.voices)) {
    const buf = await render(def, pass, [v], seconds);
    out[v] = loudness(buf).lufs;
  }
  return out;
}

/**
 * 校准：乐器 inst 从 start（MIDI）起奏八个四分音符的大调音阶（每分钟 100 拍，声部音量 0.5、力度 0.8、不加混响），
 * 量积分响度（LUFS）。同类乐器在同一个音区比，level 按差值调。
 */
async function calib(instId: string, start: number, eighths = false) {
  const names = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];
  const abc = (m: number) => {
    const oct = Math.floor(m / 12) - 5;
    const n = names[m % 12];
    const letter = n.replace("^", "");
    const acc = n.startsWith("^") ? "^" : "";
    if (oct >= 0) return acc + letter.toLowerCase() + "'".repeat(oct);
    return acc + letter + ",".repeat(-oct - 1);
  };
  const steps = eighths
    ? [0, 2, 4, 5, 7, 9, 11, 12].flatMap((s) => [abc(start + s), abc(start + s)])
    : [0, 2, 4, 5, 7, 9, 11, 12].map((s) => abc(start + s) + "2");
  const track: TrackDef = {
    id: `cal-${instId}-${start}`,
    title: { zh: instId, en: instId },
    qpm: 100,
    meter: [4, 4],
    key: "C major",
    voices: { v: { inst: instId, gain: 0.5, reverb: 0 } },
    sections: { A: { bars: 2, lines: { m: `${steps.slice(0, steps.length / 2).join(" ")} | ${steps.slice(steps.length / 2).join(" ")}` } } },
    forms: [[{ s: "A", play: "m:v", dyn: 0.8 }]],
    rest: [0, 0],
  };
  const buf = await render(track, 0, undefined, 7);
  return { inst: instId, start, lufs: loudness(buf).lufs };
}

/** 一批校准：[[乐器, 起音], …] */
async function calibs(list: [string, number][], eighths = false) {
  const out: unknown[] = [];
  for (const [i, s] of list) out.push(await calib(i, s, eighths));
  return out;
}

/** 单个鼓点（力度 0.8，一拍一下奏四下）的积分响度。 */
async function hitLoud(hits: string[]) {
  const out: Record<string, number> = {};
  for (const hit of hits) {
    const track: TrackDef = {
      id: `hit-${hit}`,
      title: { zh: hit, en: hit },
      qpm: 100,
      meter: [4, 4],
      key: "C major",
      voices: { d: { inst: "perc", gain: 0.5, reverb: 0, pattern: { kind: "drum", steps: "X.X.X.X.", hits: { X: [hit, 0.8] } } } },
      sections: { A: { bars: 1 } },
      forms: [[{ s: "A", play: "d", dyn: 1 }]],
      rest: [0, 0],
    };
    out[hit] = loudness(await render(track, 0, undefined, 4)).lufs;
  }
  return out;
}

/** 地方乐器的音色样本：按标识（键或第一个鼓点名）渲染、存 WAV（尾巴多留 2 秒）。 */
async function inst(id: string, dir = "demos") {
  const def = REGIONAL.find((d) => regionalId(d) === id);
  if (!def) throw new Error(`没有这件乐器：${id}`);
  const track = demoTrack(def);
  const len = realizePass(track, 0).length + 2.5;
  return demo(track, `${dir}/${id}.wav`, len);
}

/**
 * 对照：用 id 的音色样本曲谱，换成另一件乐器（instrument 给出时临时登记成 name 再用），存 dir/name.wav。
 * patch 是对 id 自己的参数的浅改（spec 里的字段也可以写在 spec 下）。
 */
async function instAs(id: string, name: string, other?: string, patch?: Record<string, unknown>, dir = "ab") {
  const def = REGIONAL.find((d) => regionalId(d) === id);
  if (!def) throw new Error(`没有这件乐器：${id}`);
  let key = other ?? def.key!;
  if (patch) {
    const base = INSTRUMENTS[def.key!] as unknown as Record<string, unknown>;
    const spec = patch.spec ? { ...(base.spec as object), ...(patch.spec as object) } : base.spec;
    key = `tmp_${name}`;
    (INSTRUMENTS as Record<string, unknown>)[key] = { ...base, ...patch, ...(spec ? { spec } : {}) };
  }
  const track = demoTrack(def);
  const t2: TrackDef = { ...track, id: `${track.id}-${name}`, voices: { ...track.voices, v: { ...track.voices.v, inst: key } } };
  const len = realizePass(t2, 0).length + 2.5;
  return demo(t2, `${dir}/${name}.wav`, len);
}

/** 全部（或某个地区的）音色样本。 */
async function allInst(region?: string, dir = "demos") {
  const out: unknown[] = [];
  for (const d of REGIONAL) if (!region || d.region === region) out.push({ region: d.region, ...(await inst(regionalId(d), dir)) });
  return out;
}

Object.assign(window, { lab: { render, renderSave, measure, demo, voices, stats, loudness, save, wav, trackOf, clicks, split, splitSteps, inst, instAs, allInst, calib, calibs, hitLoud, REGIONAL, demoTrack, TRACK_IDS, TRACKS, ORCH_TRACKS } });
document.getElementById("out")!.textContent = "ready";
