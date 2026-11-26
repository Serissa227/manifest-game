// 音效的播放：按需下载、解码、对齐起音（与管弦采样同一个办法：清单里记着编码前的起音标记，解码后再量一次，差值就是解码器多出来的延迟）；
// 按事件表叠层，每层随机轮换变体，外加一点音高与音量的随机；同一种音效限频、同一时刻限数；短乐句奏着时压低一点、省掉“让开”的层。
//
// 只用缓冲源、增益与声像节点，不用滤波器（音色都在素材管线里做好了）：不会有“循环噪声接双二阶滤波器在 44.1 kHz 下发散成非数”的问题，
// 实时的开销也小。音效走引擎的“音效”总线，接在总音量（静音）之前、压限器之前，与音乐、环境声共用一个音频上下文。
import { markOf, originOf } from "../orchestra/bank";
import { sfxDef, type SfxDef, type SfxId, type SfxLayer } from "./events";
import { Gate, makeRoom, Rotation, type VoiceInfo } from "./limit";
import { SFX_SAMPLES, type SfxFile, type SfxSampleId } from "./samples";

/** 短乐句奏的时候，音效压低到这个倍数（约 −4 dB）。 */
export const SFX_DUCK = 0.63;
/** 同时下载几个文件。 */
const PARALLEL = 4;

/** 文件的地址：带部署的挂载路径与内容哈希（换了素材不会用到旧缓存）。 */
export function sfxUrl(f: SfxFile): string {
  return `${import.meta.env.BASE_URL}audio/sfx/${f.file}?v=${f.hash}`;
}

/** 这些素材用到的全部文件。 */
export function filesOf(keys: readonly SfxSampleId[]): SfxFile[] {
  return keys.flatMap((k) => [...SFX_SAMPLES[k].files]);
}

/** 全部素材的键。 */
export const ALL_SAMPLES = Object.keys(SFX_SAMPLES) as SfxSampleId[];

// ───────────────────────────── 下载（与音频上下文无关，可以在用户操作之前先下）
//
// 两档优先级：now（马上要用：界面音效、正要放的声音；现在的调用全部按 now）同时最多 PARALLEL 个，按排队的先后；
// idle（后台预取）只在没有 now 的下载（排着的与在路上的都没有）时开始，一次一个。排在后台的文件要马上用时挪到前台。

/** 下载的优先级：马上要用，或后台预取。 */
export type SfxPriority = "now" | "idle";

interface Job {
  file: string;
  priority: SfxPriority;
  /** 开始下载；下完（成功或失败）调用 done */
  run: (done: () => void) => void;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();
/** 排着、还没开始的下载（按文件） */
const jobs = new Map<string, Job>();
let nowQ: Job[] = [];
let idleQ: Job[] = [];
/** 在路上的下载：前台、后台 */
let activeNow = 0;
let activeIdle = 0;
/** 清空过几次（清空之前发出的请求回来时不再动计数） */
let generation = 0;

function start(job: Job): void {
  jobs.delete(job.file);
  const now = job.priority === "now";
  if (now) activeNow++;
  else activeIdle++;
  const gen = generation;
  job.run(() => {
    if (gen !== generation) return;
    if (now) activeNow--;
    else activeIdle--;
    pump();
  });
}

function pump(): void {
  while (activeNow + activeIdle < PARALLEL && nowQ.length > 0) start(nowQ.shift()!);
  // 后台：前台没有排着、也没有在路上的下载时才开始，一次一个
  if (nowQ.length === 0 && activeNow === 0 && activeIdle === 0 && idleQ.length > 0) start(idleQ.shift()!);
}

/** 排在后台的这个文件改成马上要用（挪到前台队列的末尾）。 */
function promote(file: string): void {
  const job = jobs.get(file);
  if (!job || job.priority === "now") return;
  idleQ = idleQ.filter((j) => j !== job);
  job.priority = "now";
  nowQ.push(job);
  pump();
}

function fetchBytes(f: SfxFile, priority: SfxPriority = "now"): Promise<ArrayBuffer> {
  const have = bytes.get(f.file);
  if (have) {
    if (priority === "now") promote(f.file);
    return have;
  }
  const p = new Promise<ArrayBuffer>((resolve, reject) => {
    const job: Job = {
      file: f.file,
      priority,
      run: (done) => {
        // 低优先级：界面操作的请求先走（见 orchestra/bank.ts）
        let req: Promise<Response>;
        try {
          req = fetch(sfxUrl(f), { priority: "low" } as RequestInit);
        } catch (err) {
          req = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        req
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${f.file}`))))
          .then(resolve, reject)
          .finally(done);
      },
    };
    jobs.set(f.file, job);
    (priority === "now" ? nowQ : idleQ).push(job);
  });
  // 失败的不留在缓存里，下次重试
  p.catch(() => {
    if (bytes.get(f.file) === p) bytes.delete(f.file);
  });
  bytes.set(f.file, p);
  pump();
  return p;
}

/** 先把这些素材的文件下载下来（不解码）。没有 fetch 的环境（测试）什么也不做。 */
export function prefetchSfx(keys: readonly SfxSampleId[], priority: SfxPriority = "now"): void {
  if (typeof fetch !== "function") return;
  for (const f of filesOf(keys)) fetchBytes(f, priority).catch(() => undefined);
}

/** 下载队列的状况（测试与调试用）：在路上的（前台、后台）与排着的（前台、后台）个数。 */
export function sfxDownloadStats(): { activeNow: number; activeIdle: number; now: number; idle: number } {
  return { activeNow, activeIdle, now: nowQ.length, idle: idleQ.length };
}

/** 清空下载的缓存与队列（测试用：每个测试从“什么都没下载”开始）。 */
export function resetSfxDownloads(): void {
  generation++;
  bytes.clear();
  jobs.clear();
  nowQ = [];
  idleQ = [];
  activeNow = 0;
  activeIdle = 0;
}

// ───────────────────────────── 播放

/** 解码好的一个文件：缓冲与对齐偏移（秒，从文件的这个位置开始放）。 */
interface Decoded {
  buffer: AudioBuffer;
  origin: number;
}

export interface PlayOptions {
  /** 额外的音量（dB） */
  gain?: number;
  /** 快慢（变调），乘在每一层上（滑条的档位用） */
  rate?: number;
  /** 声像 −1（左）…1（右） */
  pan?: number;
  /** 晚多久开始（秒） */
  delay?: number;
}

interface Voice extends VoiceInfo {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** 结束的时刻（音频时钟，秒） */
  end: number;
}

const dbToAmp = (db: number) => Math.pow(10, db / 20);

/**
 * 实时的音频上下文没在跑（浏览器挂起、切到后台、关了）：这时排的声音会在恢复的一刻一起冒出来，所以不放。
 * 离线的上下文（试音台）在开始渲染之前总是“挂起”的，不算。
 */
export function paused(ctx: BaseAudioContext): boolean {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (Offline && ctx instanceof Offline) return false;
  return ctx.state !== "running";
}

/** 一个音频上下文里的音效播放器。 */
export class SfxPlayer {
  private readonly bus: GainNode;
  private readonly decoded = new Map<string, Decoded>();
  private readonly decoding = new Map<string, Promise<Decoded | null>>();
  private readonly failed = new Set<string>();
  private readonly gate = new Gate();
  private readonly rotation: Rotation;
  private voices: Voice[] = [];
  private jingleSpan: [number, number] = [-Infinity, -Infinity];
  /** 每放一个音效加一：全局点击委托据此判断这一下点击是不是已经有了更具体的声音 */
  stamp = 0;
  /** 最近一次放的音效：时刻（毫秒，performance.now()）与优先级 */
  last = { at: -Infinity, priority: -1 };

  constructor(
    readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly rand: () => number = Math.random,
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    this.rotation = new Rotation(rand);
  }

  /** 解码这些素材（下载、解码、对齐起音）；全部成功时为真。失败的文件记下来，不再重试。priority 为下载的优先级。 */
  load(keys: readonly SfxSampleId[], priority: SfxPriority = "now"): Promise<boolean> {
    return Promise.all(filesOf(keys).map((f) => this.decodeFile(f, priority))).then((r) => r.every(Boolean));
  }

  /** 这些素材都已解码好。 */
  ready(keys: readonly SfxSampleId[]): boolean {
    return filesOf(keys).every((f) => this.decoded.has(f.file));
  }

  private decodeFile(f: SfxFile, priority: SfxPriority = "now"): Promise<Decoded | null> {
    const hit = this.decoded.get(f.file);
    if (hit) return Promise.resolve(hit);
    if (this.failed.has(f.file)) return Promise.resolve(null);
    let p = this.decoding.get(f.file);
    if (p) {
      // 后台在取的文件现在马上要用：下载挪到前台
      if (priority === "now") promote(f.file);
      return p;
    }
    p = (async () => {
      try {
        const data = await fetchBytes(f, priority);
        // decodeAudioData 会占用（分离）传进去的缓冲：复制一份，下载缓存还能给别的音频上下文用
        const buffer = await this.ctx.decodeAudioData(data.slice(0));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
        const d: Decoded = { buffer, origin: originOf(markOf(channels, buffer.sampleRate), f.mark) };
        this.decoded.set(f.file, d);
        return d;
      } catch {
        this.failed.add(f.file);
        return null;
      } finally {
        this.decoding.delete(f.file);
      }
    })();
    this.decoding.set(f.file, p);
    return p;
  }

  /** 短乐句从 start 奏到 end（音频时钟，秒）：这段时间音效压低一点，写了 shy 的层省掉，一般的提示不放。 */
  jingle(start: number, end: number): void {
    this.jingleSpan = [start, end];
    const p = this.bus.gain;
    const t = Math.max(this.ctx.currentTime, start - 0.1);
    p.cancelScheduledValues(t);
    p.setValueAtTime(1, t);
    p.linearRampToValueAtTime(SFX_DUCK, start + 0.05);
    p.setValueAtTime(SFX_DUCK, end);
    p.linearRampToValueAtTime(1, end + 0.6);
  }

  /** t（音频时钟）这一刻有短乐句在奏（开始前 0.3 秒就算）。 */
  inJingle(t = this.ctx.currentTime): boolean {
    return t >= this.jingleSpan[0] - 0.3 && t <= this.jingleSpan[1];
  }

  /** 正在响（或已排好、还没响完）的声音数。 */
  get voiceCount(): number {
    const now = this.ctx.currentTime;
    return this.voices.filter((v) => v.end > now).length;
  }

  /**
   * 放一个音效。被限频、短乐句让开或上下文没在跑而没放时返回 false。
   * now 为毫秒时钟（performance.now()，测试可以注入）。
   */
  play(id: SfxId, opts: PlayOptions = {}, now = performance.now()): boolean {
    const def = sfxDef(id);
    const ctx = this.ctx;
    if (paused(ctx)) return false;
    const delay = Math.max(0, opts.delay ?? 0);
    const t0 = ctx.currentTime + delay;
    const jingle = this.inJingle(t0);
    if (jingle && def.quietInJingle) return false;
    // 限频按“真正响起的时刻”算（一批排在后面的炮声不会被前一声挡掉）
    if (!this.gate.allow(id, now + delay * 1000, def.gap, def.perSecond)) return false;
    this.stamp++;
    this.last = { at: now, priority: def.priority };
    const cents = (this.rand() * 2 - 1) * def.cents;
    const db = (this.rand() * 2 - 1) * def.db + (opts.gain ?? 0);
    const rate = (opts.rate ?? 1) * Math.pow(2, cents / 1200);
    for (const l of def.layers) {
      if (jingle && l.shy) continue;
      this.layer(l, def, t0, rate, db, opts.pan ?? 0, now);
    }
    return true;
  }

  private layer(l: SfxLayer, def: SfxDef, t0: number, rate: number, db: number, pan: number, now: number): void {
    const set = SFX_SAMPLES[l.sample];
    const file = set.files[this.rotation.next(l.sample, set.files.length)];
    const jitter = l.jitter ? (this.rand() * 2 - 1) * l.jitter : 0;
    const at = t0 + Math.max(0, (l.at ?? 0) + jitter);
    const r = rate * (l.rate ?? 1);
    const d = this.decoded.get(file.file);
    if (d) {
      this.start(d, file, at, r, l.level + db, pan, def.priority);
      return;
    }
    // 还没解码好：开始解码；在 late 毫秒内好了就放（晚一点也比没有好），否则这一次不放
    const deadline = now + def.late + Math.max(0, at - this.ctx.currentTime) * 1000;
    void this.decodeFile(file).then((dd) => {
      if (!dd || def.late <= 0 || performance.now() > deadline || paused(this.ctx)) return;
      this.start(dd, file, Math.max(at, this.ctx.currentTime), r, l.level + db, pan, def.priority);
    });
  }

  private start(d: Decoded, file: SfxFile, at: number, rate: number, db: number, pan: number, priority: number): void {
    const ctx = this.ctx;
    // 按结束的时刻清点正在响的声音（不全靠 ended 事件：离线渲染时排好的声音在渲染前不会结束，后台的标签页里事件也可能来得晚）
    this.voices = this.voices.filter((v) => v.end > at);
    const room = makeRoom(this.voices, priority);
    if (room === "skip") return;
    if (typeof room === "number") this.stopVoice(this.voices[room]);
    const src = ctx.createBufferSource();
    src.buffer = d.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = file.gain * dbToAmp(db);
    src.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.bus);
    } else g.connect(this.bus);
    const offset = Math.min(d.origin, Math.max(0, d.buffer.duration - 0.01));
    src.start(at, offset);
    const v: Voice = { src, gain: g, priority, start: at, end: at + (d.buffer.duration - offset) / Math.max(0.01, rate) };
    this.voices.push(v);
    src.addEventListener("ended", () => {
      this.voices = this.voices.filter((x) => x !== v);
      g.disconnect();
    });
  }

  /** 停掉一个声音（15 毫秒淡出，免得“咔”一下）。 */
  private stopVoice(v: Voice): void {
    this.voices = this.voices.filter((x) => x !== v);
    const now = this.ctx.currentTime;
    const p = v.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + 0.015);
    try {
      v.src.stop(now + 0.03);
    } catch {
      // 已经停了
    }
  }
}
