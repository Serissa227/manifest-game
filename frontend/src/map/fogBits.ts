// 迷雾位图（UI-CONTRACT I3 的 fog_delta）：每格一位，按行优先（下标 y·W + x），字节内低位在前。
// 全量（full，base64）整张替换；增量（runs：[行, 起始列, 结束列（含）]）只把新揭开的格置 1。
// 迷雾只会揭开、不会重新盖上：任意一串增量应用之后，结果与最后一次的全量相同（有单元测试）。
// 经典世界照旧用 fog() 的整张 '0' / '1' 文本，不经过这里。
import type { FogDelta } from "../ipc/types";

/** 变化的格范围（含两端）。 */
export interface CellBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class FogBits {
  readonly bits: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    bits?: Uint8Array,
  ) {
    const n = Math.ceil((Math.max(0, width) * Math.max(0, height)) / 8);
    this.bits = new Uint8Array(n);
    if (bits) this.bits.set(bits.subarray(0, n));
  }

  /** 由 base64 的全量位图构造（长度不足时缺的部分算未揭开）。 */
  static fromBase64(b64: string, width: number, height: number): FogBits {
    return new FogBits(width, height, decodeBase64(b64));
  }

  /** 格 (x, y) 是否已揭开（越界为 false）。 */
  get(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const i = y * this.width + x;
    return (this.bits[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** 揭开格 (x, y)；返回是否有变化。 */
  reveal(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const i = y * this.width + x;
    const m = 1 << (i & 7);
    if (this.bits[i >> 3] & m) return false;
    this.bits[i >> 3] |= m;
    return true;
  }

  /**
   * 应用增量的行区间：[行, 起始列, 结束列（含）]。起始列大于结束列时视为跨过东西接缝（起始列到行尾、行首到结束列）。
   * 返回新揭开的格的包围盒（没有新揭开的为 null）。
   */
  applyRuns(runs: readonly (readonly [number, number, number])[]): CellBox | null {
    let box: CellBox | null = null;
    const grow = (x: number, y: number) => {
      if (!box) box = { x0: x, y0: y, x1: x, y1: y };
      else {
        if (x < box.x0) box.x0 = x;
        if (x > box.x1) box.x1 = x;
        if (y < box.y0) box.y0 = y;
        if (y > box.y1) box.y1 = y;
      }
    };
    const span = (y: number, a: number, b: number) => {
      const x0 = Math.max(0, a);
      const x1 = Math.min(this.width - 1, b);
      for (let x = x0; x <= x1; x++) if (this.reveal(x, y)) grow(x, y);
    };
    for (const [y, a, b] of runs) {
      if (y < 0 || y >= this.height) continue;
      if (a <= b) span(y, a, b);
      else {
        span(y, a, this.width - 1);
        span(y, 0, b);
      }
    }
    return box;
  }

  /** 已揭开的格数。 */
  count(): number {
    let n = 0;
    for (const v of this.bits) {
      let b = v;
      while (b) {
        b &= b - 1;
        n++;
      }
    }
    return n;
  }

  /** 与另一张位图逐格相同。 */
  equals(o: FogBits): boolean {
    if (o.width !== this.width || o.height !== this.height) return false;
    const n = this.width * this.height;
    for (let i = 0; i < n; i++) {
      const m = 1 << (i & 7);
      if ((this.bits[i >> 3] & m) !== (o.bits[i >> 3] & m)) return false;
    }
    return true;
  }

  /** 转成旧的整张文本（每行一个字符串，'1' 为已揭开）：迷雾画家与地点列表用。 */
  toRows(): string[] {
    const rows: string[] = [];
    const W = this.width;
    for (let y = 0; y < this.height; y++) {
      const chars = new Array<string>(W);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        chars[x] = this.bits[i >> 3] & (1 << (i & 7)) ? "1" : "0";
      }
      rows.push(chars.join(""));
    }
    return rows;
  }

  /** 编码成 base64（测试与调试用；格式同 fog_delta 的 full）。 */
  toBase64(): string {
    return encodeBase64(this.bits);
  }
}

/** 增量的一段：[行, 起始列, 结束列（含）]，起始列大于结束列时跨过东西接缝。 */
export type FogRun = readonly [number, number, number];

/** 区间覆盖的格的下标（y·W + x；越界的行与列丢掉，跨缝的拆成两段）。 */
export function runCells(runs: readonly FogRun[], width: number, height: number): Int32Array {
  let n = 0;
  const span = (a: number, b: number) => Math.max(0, Math.min(width - 1, b) - Math.max(0, a) + 1);
  for (const [y, a, b] of runs) {
    if (y < 0 || y >= height) continue;
    n += a <= b ? span(a, b) : span(a, width - 1) + span(0, b);
  }
  const out = new Int32Array(n);
  let k = 0;
  const put = (y: number, a: number, b: number) => {
    for (let x = Math.max(0, a); x <= Math.min(width - 1, b); x++) out[k++] = y * width + x;
  };
  for (const [y, a, b] of runs) {
    if (y < 0 || y >= height) continue;
    if (a <= b) put(y, a, b);
    else {
      put(y, a, width - 1);
      put(y, 0, b);
    }
  }
  return out;
}

/** 位图 → 每格 1 字节（1 为已揭开）：迷雾画家与航行视图的瓦片用。 */
export function unpackBits(bits: Uint8Array, width: number, height: number): Uint8Array {
  const n = Math.max(0, width) * Math.max(0, height);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return out;
}

/** 手上的迷雾：哪一局（epoch）、哪个版本（rev）与位图。 */
export interface FogState {
  epoch: string;
  rev: number;
  bits: FogBits;
}

/** 一次 fog_delta 的应用结果：新状态与变化范围（"all" 为整张替换，null 为没有变化）。 */
export interface FogApplied {
  state: FogState;
  changed: CellBox | "all" | null;
}

/**
 * 把一次 fog_delta 应用到手上的迷雾：给了全量、换了一局（epoch 不同）或手上还没有时整张替换；
 * 否则在原位图上揭开增量（state.bits 原地修改）。尺寸变了（换了地图）也整张替换。
 */
export function applyFogDelta(state: FogState | null, d: FogDelta, width: number, height: number): FogApplied {
  const sameMap = !!state && state.bits.width === width && state.bits.height === height;
  if (d.full !== null || !state || state.epoch !== d.epoch || !sameMap) {
    const bits = d.full !== null ? FogBits.fromBase64(d.full, width, height) : new FogBits(width, height);
    // 换了一局却没给全量（不应发生）：从空白开始，再叠上增量
    if (d.full === null) bits.applyRuns(d.runs);
    else if (d.runs.length > 0) bits.applyRuns(d.runs);
    return { state: { epoch: d.epoch, rev: d.rev, bits }, changed: "all" };
  }
  const box = state.bits.applyRuns(d.runs);
  return { state: { epoch: d.epoch, rev: Math.max(state.rev, d.rev), bits: state.bits }, changed: box };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  // URL 安全的写法也认
  t["-".charCodeAt(0)] = 62;
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** base64 → 字节（忽略空白与末尾的 '='；不依赖 atob，后台线程与测试里都能用）。 */
export function decodeBase64(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4) + 3);
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** 字节 → base64（带 '=' 补齐）。 */
export function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(v >> 6) & 63] : "=";
    s += i + 2 < bytes.length ? B64[v & 63] : "=";
  }
  return s;
}
