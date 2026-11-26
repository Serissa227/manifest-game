// 确定性随机：同一个种子永远画出同一张脸、同一座房子。不要在美术代码里用 Math.random。

/** FNV-1a 32 位哈希（字符串或数字）。 */
export function hash32(v: string | number): number {
  const s = typeof v === "number" ? `#${v}` : v;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 伪随机数发生器。 */
export class Rng {
  private s: number;

  constructor(seed: string | number) {
    this.s = hash32(seed) || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi] 内的整数。 */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** [lo, hi) 内的小数。 */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 按权重挑选。 */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1][0];
  }
}

export function rng(seed: string | number): Rng {
  return new Rng(seed);
}
