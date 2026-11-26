// 音效的节制（纯逻辑，测试直接检查）：同一种音效限频、同一时刻限数、变体轮换、“全部卖出”的一串卖出只响一次大的。
// 高倍速下概览一秒来好几次，事件一多就会刷屏；这里保证同一种声音不会连成一片，同时响的声音不会多到糊在一起。

/** 同时最多几个声音（一层算一个）。 */
export const MAX_VOICES = 12;

/**
 * 限频：同一种音效两次之间至少隔 gap 毫秒，一秒内最多 perSecond 次。
 * allow 返回真时记下这一次（调用方随后一定会放）。
 */
export class Gate {
  private readonly last = new Map<string, number>();
  private readonly recent = new Map<string, number[]>();

  allow(id: string, now: number, gap: number, perSecond: number): boolean {
    const last = this.last.get(id);
    if (last !== undefined && now - last < gap) return false;
    const list = (this.recent.get(id) ?? []).filter((t) => now - t < 1000);
    if (list.length >= perSecond) {
      this.recent.set(id, list);
      return false;
    }
    list.push(now);
    this.recent.set(id, list);
    this.last.set(id, now);
    return true;
  }

  /** 最近一次放这种音效的时刻（毫秒）；没放过为 −∞。 */
  lastAt(id: string): number {
    return this.last.get(id) ?? -Infinity;
  }
}

/**
 * 变体轮换：一轮里每个变体各用一次、顺序随机；相邻两次（包括一轮的末尾与下一轮的开头）不会是同一个。
 * rand 可以注入（测试用确定的随机数）。
 */
export class Rotation {
  private readonly queues = new Map<string, number[]>();
  private readonly lastOf = new Map<string, number>();

  constructor(private readonly rand: () => number = Math.random) {}

  next(key: string, n: number): number {
    if (n <= 1) return 0;
    let q = this.queues.get(key);
    if (!q || q.length === 0) {
      q = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      if (q[0] === this.lastOf.get(key)) [q[0], q[n - 1]] = [q[n - 1], q[0]];
      this.queues.set(key, q);
    }
    const v = q.shift() ?? 0;
    this.lastOf.set(key, v);
    return v;
  }
}

/**
 * “全部卖出”在交易所里是一件件卖的（每种货一次成交、一次概览更新）。第一笔照常响“卖出”；
 * 离上一笔不到 windowMs 又卖了，就当作一次全部卖出：响一大串钱币（只响一次），这一串里之后的不再响。
 */
export class SaleBurst {
  private lastAt = -Infinity;
  private poured = false;

  constructor(private readonly windowMs = 1500) {}

  next(now: number): "sell" | "sellAll" | null {
    const inBurst = now - this.lastAt <= this.windowMs;
    this.lastAt = now;
    if (!inBurst) {
      this.poured = false;
      return "sell";
    }
    if (!this.poured) {
      this.poured = true;
      return "sellAll";
    }
    return null;
  }

  /** 同一次更新里卖掉了好几种货：直接是一次“全部卖出”（这一串还没响过大的才响），这一串里之后的不再响。 */
  pour(now: number): "sellAll" | null {
    const inBurst = now - this.lastAt <= this.windowMs;
    this.lastAt = now;
    if (inBurst && this.poured) return null;
    this.poured = true;
    return "sellAll";
  }
}

/** 正在响的一个声音（给“同时限数”用）。 */
export interface VoiceInfo {
  priority: number;
  /** 开始的时刻（音频时钟，秒） */
  start: number;
}

/**
 * 同时响的太多时怎么办：没满时直接放（返回 "play"）；满了时，新的优先级比正在响的最低优先级高，就停掉其中最早开始的一个（返回它的下标），
 * 否则新的不放（返回 "skip"）。
 */
export function makeRoom(voices: readonly VoiceInfo[], priority: number, max = MAX_VOICES): "play" | "skip" | number {
  if (voices.length < max) return "play";
  let pick = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (v.priority >= priority) continue;
    if (pick < 0 || v.priority < voices[pick].priority || (v.priority === voices[pick].priority && v.start < voices[pick].start)) pick = i;
  }
  return pick < 0 ? "skip" : pick;
}
