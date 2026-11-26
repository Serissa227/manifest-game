// 视图查询的调度（性能商议 2026-10-07，docs/PERF-PLAN.md 第三节第 2 条）。
//
// 以前每个面板各自订阅全局的 version：概览一换（每天的推送、命令的回复、只是改了倍速）就把所有打开的视图重新查一遍；
// 高倍速、慢网时旧请求还在路上新请求又发了出去（旧结果被丢掉，但网络与序列化的开销已经花了）。现在：
// - 领域版本：概览换了之后按领域判断变没变，只有变了的领域版本加一。前端能判断的领域是 world（世界的状态）：
//   换了日期、对局或世界，本地的操作（命令、推进、开局、读档后的重取、切换语言），或推送来的概览除倍速、时刻、编号、
//   AI 预算之外的内容变了。只改了倍速、重复的推送不加。后端将来按领域通知变化（P03 的 changed）时在这里细分。
// - 同一个 key 全局共用一份结果：同时挂上的港口街景与港口窗口都要 port:3 时只问一次（后来的使用者再问一次，结果交给所有人）。
// - 每类查询（key 里第一个冒号之前的部分，例如 port、site、mkseries）同时只有一个在路上；其间来的需求只记下最新的一次，
//   回来以后再问。没人要了的 key（面板关了、换了港口）不再问，迟到的结果丢掉。
// - 没打开的面板不查询：只有挂着的组件登记了需求才会发请求。
// - 本地请求序号（ipc/sequence.ts，P03）：新开局、读档、换世界、断线重连之后序号加一；序号变了之后才回来的结果不交付
//   （不是同一局的数据，哪怕需求没变），有人要的槽随即按新序号重新查询。
import { onRequestSeq, requestSeq } from "../ipc/sequence";
import type { Overview } from "../ipc/types";
import { useGame, type GameStore } from "./game";
import { sameValue } from "./share";

/** 视图跟随的领域。 */
export type Domain = "world";

/** 一次查询的状态：idle（没有 key）、loading（还没有结果）、ok、error（最近一次失败；data 保留上一次的结果）。 */
export type ViewStatus = "idle" | "loading" | "ok" | "error";

export interface ViewSnapshot<T> {
  data: T | null;
  status: ViewStatus;
  error: unknown;
}

/** 一个使用者的登记。 */
export interface ViewSubscriber<T> {
  /** 跟随 world 的版本重新查询；false 时只在登记与 reload 时查询 */
  follow: boolean;
  /** 查询失败时不显示错误（由使用者自己处理） */
  quiet: boolean;
  fetch: () => Promise<T>;
  notify: (snap: ViewSnapshot<T>) => void;
}

// ───────────────────────────── 领域版本 ─────────────────────────────

/** 不算世界状态的字段：倍速、时刻、概览编号、AI 预算与模式（视图的内容不随它们变）。 */
const COSMETIC = new Set(["speed", "minute", "rev", "budget", "ai_mode"]);

/**
 * 从 prev 换成 next 时世界的状态是否可能变了。换了日期、对局或世界直接算变了（不看内容）；
 * 同一天的（倍速、命令的回复、航行中途停下）逐个顶层字段比较：store 放进概览时做了结构共享（store/share.ts），
 * 没变的字段与上一份是同一个对象，比较引用就够；引用不同的才逐项比内容（测试里手写的概览没有共享，结果与以前整份序列化相同）。
 * 概览没有“世界状态的版本号”（rev 每生成一次就加一，只改倍速也加），所以同一天仍要看内容（见 P14a 交接的后端清单）。
 */
export function worldChanged(prev: Overview | null, next: Overview | null): boolean {
  if (prev === next) return false;
  if (!prev || !next) return true;
  if (prev.day !== next.day || prev.epoch !== next.epoch || prev.world_key !== next.world_key || prev.scenario !== next.scenario || prev.mode !== next.mode) return true;
  const a = prev as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (COSMETIC.has(k) || a[k] === b[k]) continue;
    if (!sameValue(a[k], b[k])) return true;
  }
  for (const k of Object.keys(a)) {
    if (!COSMETIC.has(k) && !(k in b) && a[k] !== undefined) return true;
  }
  return false;
}

let world = 0;
const domainListeners = new Set<() => void>();

/** 当前的领域版本。 */
export function domainVersion(d: Domain): number {
  return d === "world" ? world : 0;
}

/** 订阅领域版本的变化（useWorldVersion 用）。 */
export function onDomains(f: () => void): () => void {
  domainListeners.add(f);
  return () => {
    domainListeners.delete(f);
  };
}

function bumpWorld() {
  world += 1;
  for (const f of [...domainListeners]) f();
  for (const s of slots.values()) if (s.followers() > 0) schedule(s);
}

function onGame(s: GameStore, prev: GameStore) {
  if (s.act !== prev.act || (s.overview !== prev.overview && worldChanged(prev.overview, s.overview))) bumpWorld();
}

// ───────────────────────────── 查询槽与通道 ─────────────────────────────

/** 一个通道（每类查询一个）：同时只有一个请求在路上。 */
interface Lane {
  busy: Slot | null;
  /** 在路上的那一次的编号（看门狗放行之后迟到的回复不再动通道） */
  token: number;
  queue: Slot[];
  watchdog: ReturnType<typeof setTimeout> | null;
}

/** 一个请求迟迟不回时放行通道的时限（毫秒）：给足 30 秒。 */
export const LANE_STALL_MS = 30_000;

const IDLE: ViewSnapshot<never> = { data: null, status: "idle", error: null };
const LOADING: ViewSnapshot<never> = { data: null, status: "loading", error: null };

class Slot {
  readonly subs = new Set<ViewSubscriber<unknown>>();
  snap: ViewSnapshot<unknown> = LOADING;
  /** reload 的次数 */
  nonce = 0;
  /** 最近一次发出的请求对应的需求（null：还没发过） */
  sent: string | null = null;
  /** 最近一次发出的请求的编号（看门狗放行后又发了新的，旧请求迟到的结果不再交付） */
  req = 0;
  /** 最近一次发出请求时的本地请求序号（-1：还没发过）：序号变了，这个请求的结果与已有的结果都不是现在这一局的 */
  seq = -1;
  inflight = false;
  queued = false;

  constructor(
    readonly key: string,
    readonly kind: string,
  ) {}

  followers(): number {
    let n = 0;
    for (const s of this.subs) if (s.follow) n++;
    return n;
  }

  /** 现在的需求：跟随者看 world 的版本，再加上 reload 的次数。 */
  demand(): string {
    return `${this.followers() > 0 ? world : "-"}:${this.nonce}`;
  }

  needs(): boolean {
    return this.subs.size > 0 && (this.demand() !== this.sent || this.seq !== requestSeq());
  }

  publish(snap: ViewSnapshot<unknown>) {
    this.snap = snap;
    for (const s of [...this.subs]) s.notify(snap);
  }
}

const slots = new Map<string, Slot>();
const lanes = new Map<string, Lane>();
/** 统计：发出的请求数（测试与调试用） */
let started = 0;

/** key 的类别：第一个冒号之前的部分（没有冒号时就是 key 本身）。 */
export function kindOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

function laneOf(kind: string): Lane {
  let l = lanes.get(kind);
  if (!l) {
    l = { busy: null, token: 0, queue: [], watchdog: null };
    lanes.set(kind, l);
  }
  return l;
}

function schedule(s: Slot) {
  if (!s.needs() || s.inflight || s.queued) return;
  const lane = laneOf(s.kind);
  s.queued = true;
  lane.queue.push(s);
  pump(lane);
}

function pump(lane: Lane) {
  while (!lane.busy && lane.queue.length > 0) {
    const s = lane.queue.shift() as Slot;
    s.queued = false;
    if (slots.get(s.key) !== s || !s.needs()) continue;
    start(lane, s);
  }
}

function start(lane: Lane, s: Slot) {
  const token = ++lane.token;
  lane.busy = s;
  s.inflight = true;
  s.req = token;
  s.sent = s.demand();
  s.seq = requestSeq();
  started++;
  // 用最近登记的使用者的取数函数（同一个 key 的取数应当相同）
  const subs = [...s.subs];
  const fetch = subs[subs.length - 1].fetch;
  let p: Promise<unknown>;
  try {
    p = fetch();
  } catch (e) {
    p = Promise.reject(e);
  }
  lane.watchdog = setTimeout(() => release(lane, token), LANE_STALL_MS);
  p.then(
    (data) => finish(lane, token, s, { data, status: "ok", error: null }),
    (error: unknown) => finish(lane, token, s, { data: s.snap.data, status: "error", error }),
  );
}

/** 放行通道（请求回来了，或迟迟不回）。 */
function release(lane: Lane, token: number) {
  if (lane.token !== token || !lane.busy) return;
  if (lane.watchdog) clearTimeout(lane.watchdog);
  lane.watchdog = null;
  const s = lane.busy;
  lane.busy = null;
  s.inflight = false;
  // 等待期间又来了需求：排到队尾（同类的其他 key 先问）；迟迟不回、已经没人要的槽丢掉
  if (slots.get(s.key) === s) {
    if (s.subs.size > 0) schedule(s);
    else slots.delete(s.key);
  }
  pump(lane);
}

function finish(lane: Lane, token: number, s: Slot, snap: ViewSnapshot<unknown>) {
  // 这个槽后来又发过请求（看门狗放行之后）：旧请求的结果不交付，等新的
  if (s.req === token) {
    s.inflight = false;
    const mine = slots.get(s.key) === s;
    if (mine && s.subs.size > 0) {
      // 发出之后换了一局（序号变了）：这个结果、这个错误都不是现在的，不交付；release 会按新序号重新排队
      if (s.seq === requestSeq()) {
        // 失败时显示错误（有不自己处理错误的使用者时；只报一次）
        if (snap.status === "error" && [...s.subs].some((x) => !x.quiet)) useGame.getState().fail(snap.error);
        s.publish(snap);
      }
    } else if (mine) {
      // 没人要了：丢掉结果
      slots.delete(s.key);
    }
  }
  if (lane.token === token && lane.busy === s) release(lane, token);
}

/**
 * 登记一个使用者，需要时排队查询。返回注销函数。
 * - 这个 key 有请求在路上（或排着）：等它的结果，不另发（同时挂上的港口街景与港口窗口只问一次）；
 * - 已经有取完的结果、没有在路上的：为新来的使用者再问一次（结果交给所有使用者），新来的不拿旧结果——
 *   与以前每个使用者各问一次的结果相同，只是同一时间不重复。
 * 最后一个使用者注销时：没有请求在路上就丢掉这个 key 的结果；有的话等它回来再丢（期间又有人登记就照常交给他）。
 */
export function attachView<T>(key: string, sub: ViewSubscriber<T>): () => void {
  let s = slots.get(key);
  if (!s) {
    s = new Slot(key, kindOf(key));
    slots.set(key, s);
  }
  const slot = s;
  const settled = slot.snap.status === "ok" || slot.snap.status === "error";
  if (settled && !slot.inflight && !slot.queued) slot.nonce += 1;
  slot.subs.add(sub as ViewSubscriber<unknown>);
  schedule(slot);
  return () => {
    slot.subs.delete(sub as ViewSubscriber<unknown>);
    if (slot.subs.size > 0 || slots.get(key) !== slot) return;
    // 在路上的请求回来之前还留着槽（马上又登记的使用者——例如 StrictMode 的二次挂载——能接上），但不留旧结果
    slot.snap = LOADING;
    if (!slot.inflight) slots.delete(key);
  };
}

/** 重新查询这个 key（命令之后、玩家点“刷新”）。 */
export function reloadView(key: string): void {
  const s = slots.get(key);
  if (!s) return;
  s.nonce += 1;
  schedule(s);
}

/** 当前的快照（没有槽时为 idle）。 */
export function viewSnapshot<T>(key: string | null): ViewSnapshot<T> {
  if (key === null) return IDLE;
  return (slots.get(key)?.snap ?? LOADING) as ViewSnapshot<T>;
}

/** 调度的统计（测试与调试用）：发出的请求数、在路上的请求数、登记着的 key 数。 */
export function viewStats(): { started: number; inflight: number; slots: number } {
  let inflight = 0;
  for (const l of lanes.values()) if (l.busy) inflight++;
  return { started, inflight, slots: slots.size };
}

/** 清空（测试用）：丢掉所有槽与通道，迟到的结果不再交付。 */
export function resetViews(): void {
  for (const l of lanes.values()) if (l.watchdog) clearTimeout(l.watchdog);
  slots.clear();
  lanes.clear();
  started = 0;
}

useGame.subscribe(onGame);

// 序号前进（新开局、读档、换世界、重连）：已经有人要的槽按新序号重新排队；在路上的请求回来时因序号对不上而不交付
onRequestSeq(() => {
  for (const s of slots.values()) if (s.subs.size > 0) schedule(s);
});

// 测试之间清空（test/setup.ts 的 afterEach 调用；这个模块没载入的测试文件不用管）：上一个用例迟到的结果不交给下一个用例
if (import.meta.env.MODE === "test") (globalThis as { __manifestResetViews?: () => void }).__manifestResetViews = resetViews;
