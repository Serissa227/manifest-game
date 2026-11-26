// 大地图迷雾的内存（性能商议 2026-10-07 第 5 条的后续）：迷雾图按世界图的分辨率存、云团毯按块生成（LRU）、边缘噪声按块现算。
// - 云团毯的块与整张一次画出（改动前的画法，抄在下面作参照）逐像素相同：相邻块拼接处连续；同一参数两次生成相同；
// - 经典世界与寰宇大地图（1080 × 396）的迷雾、世界图的迷雾、航行视图的瓦片与改动之前逐像素相同（指纹由改动前的代码算出），
//   迷雾覆盖的格子（按格：整格盖住 / 部分盖住 / 揭开）与以前一致，已揭开的腹地不漏雾、远离揭开处的格整格盖住；
// - baseBytes 与真正分配的缓冲对得上（误差 < 5%）：大地图的基础缓冲 ≤ 80 MiB、手机上瓦片的配额 ≥ 40 MiB、桌面不比以前少；
// - 每天的迷雾增量重画（与上一轮同口径：约半张已揭开，两支远隔的舰队每天各揭开半径 6 格，其中一支挨着接缝）：记下耗时，
//   上限只防数量级的退化（整套测试并行时机器很忙；改动前后的对比数字写在 DECISIONS）。
import { beforeAll, describe, expect, it } from "vitest";
import { chartMemoKey, drawFog, FogPainter, type ChartInput } from "../art/map";
import { CLOUD_BLOCK, CLOUD_CACHE_BYTES, cloudBlock, cloudFor, fogCloudBudget, fogCloudBytes, releaseFogCaches } from "../art/map/fog";
import { fbm, fbmField, fbmWindow, hash2 } from "../art/map/noise";
import { synthWorld } from "../art/map/synth";
import { P } from "../art/palette";
import { rgba } from "../art/px";
import { memoBytes } from "../art/render";
import { ChartWorkState, type RgbaImage } from "./chartWork";
import { FogBits, type FogRun } from "./fogBits";
import { baseBytes, tileBudget } from "./memory";
import { downsample, MEMORY_BUDGET } from "./tiles";

const MiB = 1024 * 1024;
const EARTH = { kind: "equirect" as const, west: -10800, north: 4320, arcmin_per_cell: 20 };

/**
 * 改动之前（ca2c8ee）的代码算出的指纹：FNV-1a，逐个元素取 4 个字节（RGBA 字节的元素只有低 8 位）。
 * 场景见下面的 halfRows、dayRuns 与各项测试。
 */
const GOLDEN = {
  /** 全未揭开（整片云团毯）：150 × 70 不环绕、环绕，15 × 9 环绕（比一朵云还窄），400 × 170 */
  blanket150: "d70ee8a5",
  blanket150w: "2cf6ed95",
  blanket15w: "46fce429",
  blanket400: "06173635",
  /** 经典尺寸 400 × 170：约半张揭开；再逐步揭开 12 处（整张文本的增量） */
  classicHalf: "138cbde0",
  classicSteps: "01fcc801",
  /** 150 × 70 环绕、约半张揭开 */
  smallWrap: "9332ab4d",
  /** 经典尺寸（合成世界 7 号）的航行视图瓦片 (0,0)、(3,1)、(6,2) 与世界图的整张迷雾 */
  classicTiles: ["9ee45077", "0d7e351b", "f37a15c5"],
  classicWorldFog: "c98a9f74",
  /** 寰宇 1080 × 396（东西相连）：全量重同步的世界图迷雾与按格的覆盖；30 天增量之后；整张补发；瓦片 (0,1)、(16,1)、(8,4) */
  bigSync: "ac4be7ee",
  bigSyncCover: "38349084",
  bigDays: "6aef893c",
  bigDaysCover: "d3721b85",
  bigTiles: ["a348f66f", "d9423098", "ef88ad72"],
} as const;

function fnv(data: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (data[i] >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (data[i] >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (data[i] >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 约半张揭开（按列条带，边缘参差），同 bigmap.test.ts。 */
function halfRows(W: number, H: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let r = "";
    for (let x = 0; x < W; x++) r += x < W / 2 + Math.sin(y / 5) * 20 ? "1" : "0";
    rows.push(r);
  }
  return rows;
}

function bitsOf(rows: string[], W: number, H: number): FogBits {
  const b = new FogBits(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] === "1") b.reveal(x, y);
  return b;
}

/** 以 (cx, cy) 为心、半径 r 的一团格的区间（横向按宽度取模，跨接缝时起列大于止列）。 */
function disc(W: number, H: number, cx: number, cy: number, r: number): FogRun[] {
  const out: FogRun[] = [];
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    out.push([y, (((cx - hw) % W) + W) % W, (((cx + hw) % W) + W) % W]);
  }
  return out;
}

/** 第 d 天：舰队 A 贴着接缝（第 1 列）南下，舰队 B 在东边的迷雾里南下、左右摆动；各揭开半径 6 格。 */
function dayRuns(W: number, H: number, d: number): FogRun[] {
  const ay = 20 + ((2 * d) % (H - 40));
  const by = 30 + ((2 * d) % (H - 60));
  const bx = Math.round(W * 0.555 + Math.sin(d / 7) * 10);
  return [...disc(W, H, 1, ay, 6), ...disc(W, H, bx, by, 6)];
}

/** 把一块块 RGBA 依次贴到 w × h 的画布上（迷雾的增量就是这样贴到世界图的纹理上的）。 */
function compose(w: number, h: number, parts: { img: RgbaImage }[], into?: Uint8ClampedArray): Uint8ClampedArray {
  const out = into ?? new Uint8ClampedArray(w * h * 4);
  for (const { img } of parts) {
    for (let y = 0; y < img.h; y++) out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((img.y + y) * w + img.x) * 4);
  }
  return out;
}

/** 按格的覆盖：每格 k × k 像素全不透明为 2（整格盖住），全透明为 0（揭开），其余为 1（边缘的抖动）。 */
function coverage(img: Uint8ClampedArray, w: number, W: number, H: number, k: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let full = 0;
      let none = 0;
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) {
          const a = img[((y * k + dy) * w + x * k + dx) * 4 + 3];
          if (a === 255) full++;
          else if (a === 0) none++;
        }
      out[y * W + x] = full === k * k ? 2 : none === k * k ? 0 : 1;
    }
  return out;
}

/**
 * 参照：改动之前一次画整张云团毯的画法（原样抄来，只是不进记忆化缓存）。块生成的结果必须与它逐像素相同。
 */
function referenceBlanket(pw: number, ph: number, wrap: boolean): Uint32Array {
  const d = new Uint32Array(pw * ph);
  const white = rgba(P.white);
  const paper = rgba(P.paper);
  const shade = rgba(P.parchment);
  const rim = rgba(P.parchmentDark);
  const line = rgba(P.parchmentDeep);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) d[y * pw + x] = (x + y) % 6 === 0 && (x & 1) === 0 ? rim : shade;
  }
  const SX = 30;
  const SY = 14;
  const mask = new Uint8Array(64 * 32);
  const dense = fbmField(pw + 64, ph + 64, 90, 219);
  const cols = Math.max(1, Math.round(pw / SX));
  for (let gy = -1; gy * SY < ph + 20; gy++) {
    for (let gx = wrap ? 0 : -1; wrap ? gx < cols : gx * SX < pw + 30; gx++) {
      const cx = gx * SX + (gy & 1 ? SX / 2 : 0) + Math.floor(hash2(gx, gy, 201) * 24) - 12;
      const cy = gy * SY + Math.floor(hash2(gx, gy, 202) * 10) - 5;
      const dn = dense(Math.max(0, cx + 32), Math.max(0, cy + 32));
      if (dn < 0.42 && hash2(gx, gy, 208) < 0.55) continue;
      const v = Math.floor(hash2(gx, gy, 209) * 4);
      const base = [5, 7, 9, 11][v] + (dn > 0.58 ? 1 : 0);
      const r0 = base + Math.floor(hash2(gx, gy, 203) * 2);
      const r1 = Math.max(3, Math.round(r0 * 0.6) + Math.floor(hash2(gx, gy, 204) * 3) - 1);
      const r2 = Math.max(3, Math.round(r0 * 0.6) + Math.floor(hash2(gx, gy, 205) * 3) - 1);
      const circles: [number, number, number][] = [
        [cx, cy, r0],
        [cx - r0 - r1 + 4, cy + r0 - r1, r1],
        [cx + r0 + r2 - 4, cy + r0 - r2, r2],
      ];
      if (hash2(gx, gy, 206) < 0.5) circles.push([cx + r0 - 1, cy - 3, Math.max(4, r0 - 4)]);
      const bottom = cy + r0 - 1;
      const ox = cx - 32;
      const oy = cy - 20;
      mask.fill(0);
      for (let y = 0; y < 32; y++) {
        const wy = oy + y;
        if (wy > bottom) break;
        for (let x = 0; x < 64; x++) {
          const wx = ox + x;
          for (const [ccx, ccy, r] of circles) {
            const dx = wx - ccx;
            const dy = wy - ccy;
            if (dx * dx + dy * dy <= r * r + r) {
              mask[y * 64 + x] = 1;
              break;
            }
          }
        }
      }
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < 64 && y < 32 && mask[y * 64 + x] === 1;
      for (let y = -1; y <= 32; y++) {
        const wy = oy + y;
        if (wy < 0 || wy >= ph) continue;
        for (let x = -1; x <= 64; x++) {
          let wx = ox + x;
          if (wrap) wx = ((wx % pw) + pw) % pw;
          else if (wx < 0 || wx >= pw) continue;
          const i = wy * pw + wx;
          if (!inside(x, y)) {
            if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1)) d[i] = rim;
            if (inside(x, y - 1) && !inside(x, y + 1)) d[i] = line;
            continue;
          }
          let c = paper;
          for (const [ccx, ccy, r] of circles) {
            const dx = wx - ccx;
            const dy = wy - ccy;
            if (dx * dx + dy * dy <= r * r + r) {
              const nx = dx / r;
              const ny = dy / r;
              if (nx + ny < -0.75 && nx * nx + ny * ny > 0.2) c = white;
              break;
            }
          }
          if (wy >= bottom - 1) c = shade;
          else if (wy === bottom - 2 && (wx & 1) === 0) c = shade;
          d[i] = c;
        }
      }
      if (hash2(gx, gy, 207) < 0.6) {
        for (let a = 0; a < 7; a++) {
          const t = 0.6 + a * 0.28;
          let wx = Math.round(cx + Math.cos(t) * (r0 - 4));
          const wy = Math.round(cy + Math.sin(t) * (r0 - 5));
          if (wrap) wx = ((wx % pw) + pw) % pw;
          if (wx >= 0 && wy >= 0 && wx < pw && wy < ph && wy < bottom - 1) d[wy * pw + wx] = rim;
        }
      }
    }
  }
  return d;
}

/** 按 bw × bh 的块逐块生成，再拼成整张。 */
function assemble(pw: number, ph: number, wrap: boolean, bw: number, bh: number): Uint32Array {
  const out = new Uint32Array(pw * ph);
  for (let y0 = 0; y0 < ph; y0 += bh) {
    for (let x0 = 0; x0 < pw; x0 += bw) {
      const w = Math.min(bw, pw - x0);
      const h = Math.min(bh, ph - y0);
      const b = cloudBlock(pw, ph, wrap, x0, y0, w, h);
      for (let y = 0; y < h; y++) out.set(b.subarray(y * w, (y + 1) * w), (y0 + y) * pw + x0);
    }
  }
  return out;
}

const sameArr = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

/** RGBA 字节 → 整张的 RgbaImage。 */
const rgbaImg = (data: Uint8ClampedArray, w: number, h: number): RgbaImage => ({ x: 0, y: 0, w, h, data: new Uint8ClampedArray(data) });

describe("云团毯按块生成", () => {
  // 每格 4 像素：150 × 70、宽度不是块与云距整数倍的 97 × 41、比一朵云（66 像素）还窄的 15 × 9 环绕图
  const cases: [number, number, boolean][] = [
    [600, 280, false],
    [600, 280, true],
    [388, 164, true],
    [388, 164, false],
    [60, 36, true],
  ];

  it("块拼起来与整张一次画出（改动前的画法）逐像素相同：相邻块的拼接处连续，环绕时接缝两侧也连续", () => {
    for (const [pw, ph, wrap] of cases) {
      const ref = referenceBlanket(pw, ph, wrap);
      for (const [bw, bh] of [
        [CLOUD_BLOCK, CLOUD_BLOCK],
        [37, 23],
        [pw, 9],
        [pw, ph],
      ]) {
        expect(sameArr(assemble(pw, ph, wrap, bw, bh), ref), `${pw}×${ph}${wrap ? " 环绕" : ""}，块 ${bw}×${bh}`).toBe(true);
      }
    }
  });

  it("块缓存只生成用到的部分：任意次序要块里的各个矩形（包含、相交、分开、向四个方向长大），要到的像素都与整张相同", () => {
    for (const [pw, ph, wrap] of [
      [600, 280, true],
      [388, 164, false],
    ] as const) {
      const ref = referenceBlanket(pw, ph, wrap);
      releaseFogCaches(pw / 4, ph / 4, wrap);
      let s = 12345;
      const rnd = (n: number) => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return Math.floor((s / 4294967296) * n);
      };
      for (let step = 0; step < 120; step++) {
        const bx = rnd(Math.ceil(pw / CLOUD_BLOCK));
        const by = rnd(Math.ceil(ph / CLOUD_BLOCK));
        const bw = Math.min(CLOUD_BLOCK, pw - bx * CLOUD_BLOCK);
        const bh = Math.min(CLOUD_BLOCK, ph - by * CLOUD_BLOCK);
        // 按格对齐的一片
        const cx0 = rnd(bw / 4);
        const cy0 = rnd(bh / 4);
        const xs = bx * CLOUD_BLOCK + cx0 * 4;
        const ys = by * CLOUD_BLOCK + cy0 * 4;
        const xe = xs + (1 + rnd(bw / 4 - cx0)) * 4;
        const ye = ys + (1 + rnd(bh / 4 - cy0)) * 4;
        const px = cloudFor(pw, ph, wrap, bx, by, xs, ys, xe, ye);
        let bad = 0;
        for (let y = ys; y < ye; y++)
          for (let x = xs; x < xe; x++) if (px[(y - by * CLOUD_BLOCK) * bw + x - bx * CLOUD_BLOCK] !== ref[y * pw + x]) bad++;
        expect(bad, `${pw}×${ph} 第 ${step} 次：块 (${bx}, ${by}) 的 [${xs}, ${xe}) × [${ys}, ${ye})`).toBe(0);
      }
      releaseFogCaches(pw / 4, ph / 4, wrap);
    }
  });

  it("整片云团（全未揭开）与改动前的指纹相同；同一参数两次生成相同；清掉块缓存后重画相同", () => {
    const zero = (W: number, H: number) => Array.from({ length: H }, () => "0".repeat(W));
    expect(fnv(drawFog(zero(150, 70), 150, 70).data)).toBe(GOLDEN.blanket150);
    expect(fnv(drawFog(zero(150, 70), 150, 70, true).data)).toBe(GOLDEN.blanket150w);
    expect(fnv(drawFog(zero(15, 9), 15, 9, true).data)).toBe(GOLDEN.blanket15w);
    expect(fnv(drawFog(zero(400, 170), 400, 170).data)).toBe(GOLDEN.blanket400);
    // 确定性：同一块生成两次
    const a = cloudBlock(4320, 1584, true, 4224, 640, 96, 128);
    const b = cloudBlock(4320, 1584, true, 4224, 640, 96, 128);
    expect(sameArr(a, b)).toBe(true);
    // 400 × 170 每格 4 像素的云团毯（4.15 MiB）比块缓存的上限大：整张重画时块会被淘汰、之后再生成，结果不变
    expect(400 * 4 * 170 * 4 * 4).toBeGreaterThan(CLOUD_CACHE_BYTES);
    const first = drawFog(halfRows(400, 170), 400, 170);
    expect(fogCloudBytes(400, 170, false)).toBeLessThanOrEqual(fogCloudBudget(400, 170));
    releaseFogCaches(400, 170, false);
    expect(fogCloudBytes(400, 170, false)).toBe(0);
    const again = drawFog(halfRows(400, 170), 400, 170);
    expect(sameArr(first.data, again.data)).toBe(true);
    expect(fnv(again.data)).toBe(GOLDEN.classicHalf);
  });
});

describe("迷雾图按世界图的分辨率存", () => {
  /** 简单的确定性伪随机（测试数据用）。 */
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  it("scale = 2 的画家（每格 2 像素）与每格 4 像素画好再 2×2 缩小逐像素相同：整张与逐块揭开，环绕与不环绕", () => {
    const W = 170;
    const H = 90;
    for (const wrap of [false, true]) {
      const rnd = lcg(wrap ? 5 : 9);
      const rev = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rev[y * W + x] = x < 40 + Math.sin(y / 4) * 9 ? 1 : 0;
      const half = new FogPainter(W, H, wrap, 2);
      const full = new FogPainter(W, H, wrap);
      half.replace(rev.slice());
      full.replace(rev.slice());
      const check = (tag: string) => {
        const big = rgbaImg(full.px.toRGBA(), full.px.w, full.px.h);
        const down = downsample(big, 2);
        expect([half.px.w, half.px.h], tag).toEqual([down.w, down.h]);
        expect(sameArr(half.px.toRGBA(), down.data), tag).toBe(true);
      };
      check(`${wrap ? "环绕" : "不环绕"}：整张`);
      for (let step = 0; step < 8; step++) {
        const cells: number[] = [];
        for (let n = 0; n < 3; n++) {
          const cx = Math.floor(rnd() * W);
          const cy = Math.floor(rnd() * H);
          const r = 2 + Math.floor(rnd() * 6);
          for (let y = cy - r; y <= cy + r; y++)
            for (let x = cx - r; x <= cx + r; x++) {
              if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || y < 0 || y >= H) continue;
              const gx = wrap ? ((x % W) + W) % W : x;
              if (gx >= 0 && gx < W) cells.push(y * W + gx);
            }
        }
        half.reveal(cells);
        full.reveal(cells);
        check(`${wrap ? "环绕" : "不环绕"}：第 ${step} 步`);
      }
    }
  });
});

describe("边缘噪声按窗口现算", () => {
  it("局部格点的取值与整张的格点表、与逐点的 fbm 逐位相同（窗口外的点回退到逐点计算，也相同）", () => {
    const pw = 4320;
    const ph = 1584;
    const whole = fbmField(pw, ph, 7, 211);
    const win = fbmWindow(1000, 300, 128, 96, 7, 211);
    let k = 0;
    for (let y = 280; y < 420; y += 3) {
      for (let x = 980; x < 1150; x += 5) {
        const v = win(x, y);
        expect(v).toBe(whole(x, y));
        expect(v).toBe(fbm(x / 7, y / 7, 211));
        k++;
      }
    }
    expect(k).toBeGreaterThan(1000);
  });
});

describe("经典世界：与改动前逐像素相同", () => {
  it("400 × 170 的迷雾（整张、逐步揭开）、150 × 70 环绕；航行视图的瓦片与世界图的整张迷雾", () => {
    expect(fnv(drawFog(halfRows(400, 170), 400, 170).data)).toBe(GOLDEN.classicHalf);
    const g = halfRows(400, 170).map((r) => r.split(""));
    const p = new FogPainter(400, 170);
    p.update(g.map((r) => r.join("")));
    for (let d = 0; d < 12; d++) {
      for (const [y, a, b] of disc(400, 170, 220 + d * 3, 40 + d * 7, 5)) for (let x = a; x <= b; x++) g[y][x] = "1";
      p.update(g.map((r) => r.join("")));
    }
    expect(fnv(p.px.data)).toBe(GOLDEN.classicSteps);
    expect(fnv(drawFog(halfRows(150, 70), 150, 70, true).data)).toBe(GOLDEN.smallWrap);
    // 经典世界切瓦片直接用记忆化缓存里的海图（像素缓冲），与以前另拷一份 RGBA 时逐字节相同
    const input: ChartInput = synthWorld(7, 400, 170).input;
    const st = new ChartWorkState(input, 1);
    st.fogSync(bitsOf(halfRows(400, 170), 400, 170).bits);
    expect([st.tile(1, 0, 0), st.tile(1, 3, 1), st.tile(1, 6, 2)].map((t) => fnv(t.data))).toEqual([...GOLDEN.classicTiles]);
    expect(fnv(st.fogFull()!.data)).toBe(GOLDEN.classicWorldFog);
    // 基础缓冲的估计与真正分配的对得上（误差 < 5%）：后台线程是缓存里的两季海图（显示的与预先生成的下一季）、
    // 迷雾图、探索状态与云团毯的块；主线程是两季的世界图与两张画布
    const worlds = [st.chart(1), st.chart(2)];
    const keys = new Set([0, 1, 2, 3].map((s) => chartMemoKey(input, s)));
    const worker = memoBytes((k) => keys.has(k)) + st.fog.image!.data.byteLength + st.fog.revealed!.byteLength + fogCloudBytes(400, 170, false);
    expect(st.heldBytes()).toBe(worker);
    const main = worlds.reduce((n, w) => n + w.data.byteLength, 0) + 2 * (400 * 4) * (170 * 4) * 4;
    const est = baseBytes(400, 170, 1);
    expect(Math.abs(worker + main - est) / est).toBeLessThan(0.05);
    st.release();
  }, 60000);
});

describe("寰宇大地图（1080 × 396）", () => {
  const W = 1080;
  const H = 396;
  const k = 2;
  const ww = (W * 4) / k;
  const wh = (H * 4) / k;
  let input: ChartInput;
  let st: ChartWorkState;
  let syncImg: Uint8ClampedArray;
  let canvas: Uint8ClampedArray;
  let final: FogBits;

  beforeAll(() => {
    input = { ...synthWorld(7, W, H).input, wrapX: true, projection: EARTH };
    st = new ChartWorkState(input, k);
    final = bitsOf(halfRows(W, H), W, H);
    const first = st.fogSync(final.bits.slice());
    syncImg = compose(ww, wh, first);
    canvas = syncImg.slice();
    for (let d = 0; d < 30; d++) {
      const runs = dayRuns(W, H, d);
      final.applyRuns(runs);
      compose(ww, wh, st.fogRuns(runs), canvas);
    }
  }, 120000);

  it("世界图的迷雾（每格 2 像素）：全量重同步与 30 天的增量都与改动前逐像素相同；按格的覆盖也与以前一致", () => {
    expect(fnv(syncImg)).toBe(GOLDEN.bigSync);
    expect(fnv(coverage(syncImg, ww, W, H, k))).toBe(GOLDEN.bigSyncCover);
    expect(fnv(canvas)).toBe(GOLDEN.bigDays);
    expect(fnv(coverage(canvas, ww, W, H, k))).toBe(GOLDEN.bigDaysCover);
    // 后来的订阅者要的整张补发与一块块贴上去的相同
    expect(fnv(st.fogFull()!.data)).toBe(GOLDEN.bigDays);
  });

  it("迷雾不漏开（按格判断）：四周都揭开的格整格透明，离揭开处 3 格以上的格整格盖住；接缝两侧连续", () => {
    const cover = coverage(canvas, ww, W, H, k);
    const rev = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rev[y * W + x] = final.get(x, y) ? 1 : 0;
    /** 以每格为中心、半径 r 的方块里的最小值 / 最大值（横向环绕、纵向夹到图内；先横后纵）。 */
    const box = (src: Uint8Array, r: number, pick: (a: number, b: number) => number) => {
      const tmp = new Uint8Array(W * H);
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = src[y * W + x];
          for (let d = -r; d <= r; d++) v = pick(v, src[y * W + (((x + d) % W) + W) % W]);
          tmp[y * W + x] = v;
        }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = tmp[y * W + x];
          for (let d = -r; d <= r; d++) v = pick(v, tmp[Math.max(0, Math.min(H - 1, y + d)) * W + x]);
          out[y * W + x] = v;
        }
      return out;
    };
    const allOpen = box(rev, 1, Math.min);
    const anyOpen = box(rev, 3, Math.max);
    let open = 0;
    let shut = 0;
    const bad: string[] = [];
    for (let i = 0; i < W * H; i++) {
      if (allOpen[i]) {
        open++;
        if (cover[i] !== 0 && bad.length < 5) bad.push(`格 (${i % W}, ${Math.floor(i / W)}) 应整格揭开`);
      }
      if (!anyOpen[i]) {
        shut++;
        if (cover[i] !== 2 && bad.length < 5) bad.push(`格 (${i % W}, ${Math.floor(i / W)}) 应整格盖住`);
      }
    }
    expect(bad).toEqual([]);
    expect(open).toBeGreaterThan(W * H * 0.3);
    expect(shut).toBeGreaterThan(W * H * 0.3);
    // 接缝：舰队 A 贴着第 1 列南下，接缝两侧（第 W − 1 列与第 0 列）都有揭开与边缘
    let seamEdge = 0;
    for (let y = 0; y < H; y++) if (cover[y * W + W - 1] !== 2 && rev[y * W + W - 1] === 0) seamEdge++;
    expect(seamEdge).toBeGreaterThan(0);
  });

  it("航行视图的瓦片与改动前逐像素相同", () => {
    expect([st.tile(1, 0, 1), st.tile(1, 16, 1), st.tile(1, 8, 4)].map((t) => fnv(t.data))).toEqual([...GOLDEN.bigTiles]);
  }, 60000);

  it("基础缓冲：≤ 80 MiB，与真正分配的缓冲对得上（误差 < 5%）；手机上瓦片的配额 ≥ 40 MiB，桌面不比改动前少", () => {
    const base = st.base(1) as RgbaImage;
    const world = st.chart(1);
    // 后台线程：切瓦片用的整图（一季）、世界图分辨率的迷雾图、探索状态、云团毯的块缓存（整张重画过：已到上限附近）
    const worker = base.data.byteLength + st.fog.image!.data.byteLength + st.fog.revealed!.byteLength + fogCloudBytes(W, H, true);
    expect(st.heldBytes()).toBe(worker);
    expect(fogCloudBytes(W, H, true)).toBeGreaterThan(CLOUD_CACHE_BYTES * 0.9);
    // 主线程：世界图（一季）与世界图的海图、迷雾两张画布（renderer.ts：每张 ⌈MW / k⌉ × ⌈MH / k⌉）
    const main = world.data.byteLength + 2 * Math.ceil((W * 4) / k) * Math.ceil((H * 4) / k) * 4;
    const est = baseBytes(W, H, k);
    expect(Math.abs(worker + main - est) / est).toBeLessThan(0.05);
    expect(est).toBeLessThanOrEqual(80 * MiB);
    expect(tileBudget(W, H, k, MEMORY_BUDGET.mobile)).toBeGreaterThanOrEqual(40 * MiB);
    // 改动前：baseBytes(1080, 396, 2) = 127 738 976 字节，桌面的瓦片配额 81 976 224 字节
    expect(tileBudget(W, H, k, MEMORY_BUDGET.desktop)).toBeGreaterThanOrEqual(81_976_224);
  });

  it("每天的迷雾增量重画（与上一轮同口径）：记下耗时，上限只防数量级的退化", () => {
    const times: number[] = [];
    for (let d = 30; d < 90; d++) {
      const runs = dayRuns(W, H, d);
      const t = performance.now();
      const parts = st.fogRuns(runs);
      times.push(performance.now() - t);
      // 每天只重画舰队附近的几小块
      for (const p of parts) expect(p.img.w).toBeLessThan(ww / 4);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.info(`[迷雾每日增量] 1080 × 396、两支舰队、60 天：平均 ${mean.toFixed(2)} 毫秒，中位 ${sorted[30].toFixed(2)} 毫秒，最慢 ${sorted[59].toFixed(1)} 毫秒`);
    // 本机同一进程里与改动前的代码交替测（各 6 轮 × 90 天，每天取 6 轮里最快的一次）：改动前平均 0.52 毫秒、中位 0.48 毫秒，
    // 改动后平均 0.43 毫秒、中位 0.42 毫秒；全部轮次的最慢一天 19.4 → 7.5 毫秒。这里的上限只防数量级的退化
    expect(mean).toBeLessThan(25);
  }, 120000);
});
