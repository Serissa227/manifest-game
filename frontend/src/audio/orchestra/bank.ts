// 采样的加载：按需下载、解码、对齐起音；只加载当前曲目要用的采样（见 pick.filesFor），超出内存上限时丢掉最久没用的。
// 下载分前台（马上要放的曲子）与后台（空闲时预取接下来可能放的）两档，音乐关着时一个也不取，见下面“下载”一节。
//
// MP3 编码器会在开头补一段静音（LAME 约 1105 个采样），有的浏览器解码时按文件头里的信息裁掉，有的不裁。
// 清单里记着每个文件在编码前的“起音标记”（各声道平均后 |x| 第一次超过峰值 0.5% 的时刻）；解码后在同样的规则下再量一次，
// 两者之差就是这个浏览器多出来的延迟（origin），播放时所有位置都加上它。起音前还有 2 毫秒的淡入，量得差几个采样也听不出来；
// 循环接缝靠交叉淡化，本来就不要求逐采样对齐。
import { SAMPLE_SETS, type SampleZone } from "./samples";

/** 起音标记的阈值（相对峰值），与 tools/orchestra/build.py 的 MARK_REL 一致。 */
export const MARK_REL = 0.005;
/** 解码后的采样最多占多少内存（字节，按 32 位浮点算），超出时丢掉最久没用、当前也用不到的。 */
const MEMORY_BYTES = 192 * 1024 * 1024;
/** 主界面里同时下载几个“马上要放”的文件（少开几个，给界面操作的请求留出余地）。 */
export const PARALLEL = 3;
/** 首屏（选世界、开局）同时只下载一个文件：首屏自己的请求优先。 */
export const FIRST_SCREEN_PARALLEL = 1;
/** 后台预取等浏览器空闲的最长时间（毫秒）：一直忙也会在这之后取一个。 */
const IDLE_TIMEOUT_MS = 2000;

const ZONE_OF = new Map<string, SampleZone>();
for (const set of Object.values(SAMPLE_SETS)) for (const z of set.zones) ZONE_OF.set(z.file, z);

/** 清单里的采样（按文件名）。 */
export function zoneOf(file: string): SampleZone | undefined {
  return ZONE_OF.get(file);
}

/** 文件的地址：带部署的挂载路径，后面带内容哈希（换了采样不会用到旧缓存）。 */
export function sampleUrl(file: string): string {
  const z = ZONE_OF.get(file);
  return `${import.meta.env.BASE_URL}audio/orchestra/${file}${z ? `?v=${z.hash}` : ""}`;
}

// ───────────────────────────── 下载（与音频上下文无关）
//
// 两档优先级：play（马上要放的曲子）与 idle（后台预取接下来可能放的、短乐句）。
// play 同时最多 limit 个（首屏 1 个、主界面 3 个，见 setDownloadLimit），按排队的先后；
// idle 只在没有 play 的下载（在下的与排着的都没有）、浏览器空闲（requestIdleCallback）时才开始，一次只下一个。
// 音乐关着时整个队列暂停：一个新请求也不发（pauseDownloads）。下载的字节按文件缓存，几个音频上下文共用。

/** 下载的优先级：马上要放的曲子，或后台预取。 */
export type Priority = "play" | "idle";

interface Job {
  file: string;
  priority: Priority;
  run: () => void;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();
/** 已经下载好的文件 */
const arrived = new Set<string>();
/** 排着、还没开始的下载（按文件） */
const jobs = new Map<string, Job>();
let playQ: Job[] = [];
let idleQ: Job[] = [];
let active = 0;
let limit = PARALLEL;
let paused = false;
/** 等着空闲时开始一个后台下载（取消函数） */
let idleWait: (() => void) | null = null;
/** 清空过几次（清空之前发出的请求回来时不再动计数） */
let generation = 0;

/** 浏览器空闲时执行（没有 requestIdleCallback 时稍后执行）；返回取消函数。 */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
}

function start(job: Job): void {
  jobs.delete(job.file);
  active++;
  job.run();
}

function pump(): void {
  if (paused) return;
  while (active < limit && playQ.length > 0) start(playQ.shift()!);
  // 后台预取：没有要马上放的下载时，等浏览器空闲再取一个
  if (playQ.length > 0 || active > 0 || idleQ.length === 0 || idleWait) return;
  idleWait = whenIdle(() => {
    idleWait = null;
    if (!paused && active === 0 && playQ.length === 0) {
      const job = idleQ.shift();
      if (job) start(job);
    }
    pump();
  });
}

/** 排着的这个文件改成马上要放（从后台队列挪到前台队列的末尾）。 */
function promote(file: string): void {
  const job = jobs.get(file);
  if (!job || job.priority === "play") return;
  idleQ = idleQ.filter((j) => j !== job);
  job.priority = "play";
  playQ.push(job);
  pump();
}

function fetchBytes(file: string, priority: Priority = "play"): Promise<ArrayBuffer> {
  const have = bytes.get(file);
  if (have) {
    if (priority === "play") promote(file);
    return have;
  }
  const p = new Promise<ArrayBuffer>((resolve, reject) => {
    const job: Job = {
      file,
      priority,
      run: () => {
        const gen = generation;
        // 低优先级：点按钮的请求、界面要用的图先走（priority 是提示，不支持的浏览器照常下载）
        let req: Promise<Response>;
        try {
          req = fetch(sampleUrl(file), { priority: "low" } as RequestInit);
        } catch (err) {
          // 没有 fetch 的环境，或请求当场就出错：照常走失败的路（计数要还回去）
          req = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        req
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${file}`))))
          .then((b) => {
            if (gen === generation) arrived.add(file);
            resolve(b);
          }, reject)
          .finally(() => {
            if (gen !== generation) return;
            active--;
            pump();
          });
      },
    };
    jobs.set(file, job);
    (priority === "play" ? playQ : idleQ).push(job);
  });
  // 失败的不留在缓存里，下次重试
  p.catch(() => {
    if (bytes.get(file) === p) bytes.delete(file);
  });
  bytes.set(file, p);
  pump();
  return p;
}

/** 同时下载几个“马上要放”的文件（首屏 FIRST_SCREEN_PARALLEL、主界面 PARALLEL）。 */
export function setDownloadLimit(n: number): void {
  const v = Math.max(1, Math.floor(n));
  if (v === limit) return;
  limit = v;
  pump();
}

/** 暂停 / 继续下载（音乐关着时暂停：排着的都不开始，已经在路上的照常收下）。 */
export function pauseDownloads(on: boolean): void {
  if (on === paused) return;
  paused = on;
  if (!on) pump();
  else if (idleWait) {
    idleWait();
    idleWait = null;
  }
}

/**
 * 这些文件（正在要放的曲子）的下载排到最前：排在后台的挪到前台，前台排着的其他文件（换走了的曲子）降回后台。
 * 已经在路上的不受影响。
 */
export function focusDownloads(files: readonly string[]): void {
  const want = new Set(files);
  const keep = playQ.filter((j) => want.has(j.file));
  const demoted = playQ.filter((j) => !want.has(j.file));
  const promoted = idleQ.filter((j) => want.has(j.file));
  for (const j of demoted) j.priority = "idle";
  for (const j of promoted) j.priority = "play";
  playQ = [...keep, ...promoted];
  idleQ = [...idleQ.filter((j) => !want.has(j.file)), ...demoted];
  pump();
}

/** 后台队列按这个顺序排（接下来最可能放的在前）；不在其中的排在后面，先后不变。 */
export function orderIdle(files: readonly string[]): void {
  const rank = new Map<string, number>();
  files.forEach((f, i) => {
    if (!rank.has(f)) rank.set(f, i);
  });
  const big = files.length;
  idleQ = idleQ
    .map((j, i) => ({ j, k: rank.get(j.file) ?? big + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.j);
}

/** 这些文件都已下载好（可能还没解码）。 */
export function downloaded(files: readonly string[]): boolean {
  return files.every((f) => arrived.has(f));
}

/** 下载队列的状况（测试与调试用）：在路上的、排在前台的、排在后台的个数，以及同时下载的上限。 */
export function downloadStats(): { active: number; play: number; idle: number; limit: number; paused: boolean } {
  return { active, play: playQ.length, idle: idleQ.length, limit, paused };
}

/** 清空下载的缓存与队列（测试用：每个测试从“什么都没下载”开始）。 */
export function resetDownloads(): void {
  generation++;
  idleWait?.();
  idleWait = null;
  bytes.clear();
  arrived.clear();
  jobs.clear();
  playQ = [];
  idleQ = [];
  active = 0;
  limit = PARALLEL;
  paused = false;
}

// ───────────────────────────── 解码与对齐

/** 解码好的一个采样：缓冲与对齐偏移（秒，播放时文件内的位置都加上它）。 */
export interface Loaded {
  buffer: AudioBuffer;
  origin: number;
}

/** 解码后的起音位置（秒）：各声道平均后 |x| 第一次超过峰值 MARK_REL 倍的时刻（与构建脚本同一个规则）。 */
export function markOf(channels: readonly Float32Array[], sampleRate: number): number {
  const n = channels[0]?.length ?? 0;
  const k = channels.length;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < k; c++) s += channels[c][i];
    const a = Math.abs(s / k);
    if (a > peak) peak = a;
  }
  const thr = peak * MARK_REL;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < k; c++) s += channels[c][i];
    if (Math.abs(s / k) >= thr && thr > 0) return i / sampleRate;
  }
  return 0;
}

/** 对齐偏移：解码后量得的起音减去清单里的标记，夹在 0–0.2 秒（编码器补的静音不会更长）。 */
export function originOf(decodedMark: number, mark: number): number {
  return Math.min(0.2, Math.max(0, decodedMark - mark));
}

/** 一个音频上下文里的采样库。 */
export class SampleBank {
  private readonly loaded = new Map<string, Loaded>();
  private readonly pending = new Map<string, Promise<boolean>>();
  /** 正在加载的文件现在的优先级（中途挪到前台的，重试时也走前台） */
  private readonly priority = new Map<string, Priority>();
  private readonly failed = new Set<string>();
  private readonly stamp = new Map<string, number>();
  private clock = 0;
  private memory = 0;
  /** 当前要留着的文件（正在放的曲子与短乐句）：丢弃时跳过它们 */
  private keep = new Set<string>();

  constructor(readonly ctx: BaseAudioContext) {}

  /** 取一个已解码的采样（刷新“最近使用”）。 */
  get(file: string): Loaded | undefined {
    const l = this.loaded.get(file);
    if (l) this.stamp.set(file, ++this.clock);
    return l;
  }

  /** 这些文件都已解码好。 */
  has(files: readonly string[]): boolean {
    return files.every((f) => this.loaded.has(f));
  }

  /** 这些文件里有加载失败的。 */
  anyFailed(files: readonly string[]): boolean {
    return files.some((f) => this.failed.has(f));
  }

  /** 已解码的文件数与占用的内存（字节）。 */
  stats(): { files: number; bytes: number } {
    return { files: this.loaded.size, bytes: this.memory };
  }

  /**
   * 加载这些文件（下载、解码、对齐）；全部成功时为真。失败的文件记下来，重试一次后不再重试。
   * priority 为 idle 时在后台空闲时下载；之后有人按 play 要同一个文件时挪到前台。
   */
  ensure(files: readonly string[], priority: Priority = "play"): Promise<boolean> {
    return Promise.all(files.map((f) => this.loadOne(f, priority))).then((ok) => ok.every(Boolean));
  }

  /** 标出当前要留着的文件；超出内存上限时丢掉最久没用、又不在其中的。 */
  retain(files: Iterable<string>): void {
    this.keep = new Set(files);
    this.evict();
  }

  private loadOne(file: string, priority: Priority): Promise<boolean> {
    if (this.loaded.has(file)) return Promise.resolve(true);
    const p = this.pending.get(file);
    if (p) {
      if (priority === "play") {
        this.priority.set(file, "play");
        promote(file);
      }
      return p;
    }
    const zone = ZONE_OF.get(file);
    if (!zone) return Promise.resolve(false);
    const run = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await fetchBytes(file, this.priority.get(file) ?? priority);
          // decodeAudioData 会占用（分离）传进去的缓冲：复制一份，下载缓存还能给别的音频上下文用
          const buffer = await this.ctx.decodeAudioData(data.slice(0));
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
          const origin = originOf(markOf(channels, buffer.sampleRate), zone.mark);
          this.loaded.set(file, { buffer, origin });
          this.stamp.set(file, ++this.clock);
          this.memory += buffer.length * buffer.numberOfChannels * 4;
          this.failed.delete(file);
          this.evict();
          return true;
        } catch {
          // 网络或解码错误：再试一次
        }
      }
      this.failed.add(file);
      return false;
    };
    this.priority.set(file, priority);
    const q = run().finally(() => {
      this.pending.delete(file);
      this.priority.delete(file);
    });
    this.pending.set(file, q);
    return q;
  }

  private evict(): void {
    if (this.memory <= MEMORY_BYTES) return;
    const order = [...this.stamp.entries()].sort((a, b) => a[1] - b[1]);
    for (const [file] of order) {
      if (this.memory <= MEMORY_BYTES * 0.8) break;
      if (this.keep.has(file)) continue;
      const l = this.loaded.get(file);
      if (!l) continue;
      this.loaded.delete(file);
      this.stamp.delete(file);
      this.memory -= l.buffer.length * l.buffer.numberOfChannels * 4;
    }
  }
}
