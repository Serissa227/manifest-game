// 迷雾区间直达绘制（性能商议 2026-10-07 第 3 条）：fog_delta 的区间不再转成整张文本，画家按变化的格聚块、在局部窗口里
// 算距离场重画。增量的结果必须与整张重画逐像素相同：多处揭雾、远隔的两处、跨东西接缝、挨着南北边与图角。
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { drawFog, FogPainter, type ChartInput } from "../art/map";
import { fogDirtyRects } from "../art/map/fog";
import type { Px } from "../art/px";
import { acquireChartHub } from "./chartHub";
import { createChartJobs } from "./chartJobs";
import { ChartWorkState, type RgbaImage } from "./chartWork";
import { FogBits, type FogRun } from "./fogBits";
import { attachFogFeed, resetChartFog, useChartFog } from "./fogStore";

const C = 4;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const same = (a: Px, b: Px) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
const rowsOf = (rev: Uint8Array, W: number, H: number) =>
  Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (rev[y * W + x] ? "1" : "0")).join(""));

/** 以 (cx, cy) 为心、半径 r 的一团格（环绕时横向取模，越界的丢掉）。 */
function blob(W: number, H: number, cx: number, cy: number, r: number, wrap: boolean): number[] {
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r || y < 0 || y >= H) continue;
      const gx = wrap ? ((x % W) + W) % W : x;
      if (gx < 0 || gx >= W) continue;
      out.push(y * W + gx);
    }
  }
  return out;
}

describe("迷雾的局部重画与整张重画逐像素相同", () => {
  for (const wrap of [false, true]) {
    it(`${wrap ? "环绕" : "不环绕"}：随机多处揭雾（含图边、图角与接缝两侧）`, () => {
      const W = 150;
      const H = 70;
      const rev = new Uint8Array(W * H);
      // 起点：左边一片已揭开
      for (let y = 0; y < H; y++) for (let x = 0; x < 30; x++) rev[y * W + x] = 1;
      const painter = new FogPainter(W, H, wrap);
      painter.replace(rev.slice());
      expect(same(painter.px, drawFog(rowsOf(rev, W, H), W, H, wrap))).toBe(true);
      const rnd = lcg(wrap ? 11 : 7);
      const spots: [number, number][] = [
        [0, 0],
        [W - 1, H - 1],
        [W - 2, 35],
        [1, 20],
        [75, 0],
      ];
      for (let step = 0; step < 14; step++) {
        const cells: number[] = [];
        // 每步揭开两三处：远隔的不应合成一个大矩形
        const n = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) {
          const [cx, cy] = step < spots.length && k === 0 ? spots[step] : [Math.floor(rnd() * W), Math.floor(rnd() * H)];
          cells.push(...blob(W, H, cx, cy, 2 + Math.floor(rnd() * 5), wrap));
        }
        for (const c of cells) rev[c] = 1;
        const rects = painter.reveal(cells);
        expect(rects).not.toBeNull();
        expect(same(painter.px, drawFog(rowsOf(rev, W, H), W, H, wrap)), `第 ${step} 步`).toBe(true);
      }
    });
  }

  it("远隔的两处揭雾各是一块（不退化成一个大包围盒）；挨着接缝的一处拆在两侧，不整行重画", () => {
    const W = 200;
    const H = 80;
    const xs = [20, 21, 180, 181];
    const ys = [10, 11, 70, 70];
    const rects = fogDirtyRects(xs, ys, 4, W, H, false);
    expect(rects).toHaveLength(2);
    const area = rects.reduce((a, r) => a + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
    expect(area).toBeLessThan(20 * 20 * 2);
    // 环绕：x = 0 与 x = W - 1 两侧各一块，都远小于整行
    const seam = fogDirtyRects([0, W - 1], [40, 40], 2, W, H, true);
    for (const r of seam) expect(r.x1 - r.x0 + 1).toBeLessThan(20);
    expect(seam.some((r) => r.x0 === 0)).toBe(true);
    expect(seam.some((r) => r.x1 === W - 1)).toBe(true);

    // 画家：两处远隔的揭雾只重画两小块，结果与整张相同
    const rev = new Uint8Array(W * H);
    const painter = new FogPainter(W, H, true);
    painter.replace(rev.slice());
    const cells = [...blob(W, H, 30, 15, 4, true), ...blob(W, H, 170, 65, 4, true), ...blob(W, H, 0, 40, 3, true)];
    for (const c of cells) rev[c] = 1;
    const painted = painter.reveal(cells) ?? [];
    expect(painted.length).toBeGreaterThanOrEqual(3);
    const paintedArea = painted.reduce((a, r) => a + r.w * r.h, 0);
    expect(paintedArea).toBeLessThan((W * C * H * C) / 10);
    for (const r of painted) expect(r.w).toBeLessThan(W * C);
    expect(same(painter.px, drawFog(rowsOf(rev, W, H), W, H, true))).toBe(true);
    // 已经揭开的格再揭一次：没有变化
    expect(painter.reveal(cells)).toEqual([]);
  });

  it("还没有整张状态时不画；变化超过半张图时整张重画", () => {
    const W = 40;
    const H = 20;
    const p = new FogPainter(W, H);
    expect(p.reveal([0, 1, 2])).toBeNull();
    const rev = new Uint8Array(W * H);
    p.replace(rev.slice());
    const cells = Array.from({ length: W * H }, (_, i) => i).filter((i) => i % W < 30);
    for (const c of cells) rev[c] = 1;
    expect(p.reveal(cells)).toEqual([{ x: 0, y: 0, w: W * C, h: H * C }]);
    expect(same(p.px, drawFog(rowsOf(rev, W, H), W, H))).toBe(true);
  });
});

// ───────────── 后台线程的状态、调度与迷雾的喂法 ─────────────

/** 把一块块 RGBA 依次贴到 w × h 的画布上（迷雾的增量就是这样贴到世界图的纹理上的）。 */
function compose(w: number, h: number, parts: { img: RgbaImage }[], into?: Uint8ClampedArray): Uint8ClampedArray {
  const out = into ?? new Uint8ClampedArray(w * h * 4);
  for (const { img } of parts) {
    for (let y = 0; y < img.h; y++) out.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((img.y + y) * w + img.x) * 4);
  }
  return out;
}

describe("区间直接到后台线程的状态（ChartWorkState）", () => {
  const W = 96;
  const H = 40;
  const rows = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (Math.hypot(x - 48, y - 20) < 6 ? "#" : "~")).join(""));
  const input: ChartInput = { width: W, height: H, rows, places: [], wrapX: true };
  /** 一组跨接缝、两处远隔的揭雾区间（起列大于止列表示跨缝）。 */
  const batches: FogRun[][] = [
    [
      [10, 90, 3],
      [11, 92, 1],
    ],
    [
      [3, 20, 24],
      [35, 70, 74],
    ],
    [[20, 40, 44]],
    [
      [0, 0, 5],
      [39, 93, 95],
    ],
  ];
  const startBits = () => {
    const b = new FogBits(W, H);
    for (let y = 0; y < H; y++) b.applyRuns([[y, 0, 15]]);
    return b;
  };

  for (const scale of [1, 2] as const) {
    it(`世界图每格 ${4 / scale} 像素：增量的几块贴上去与整张重画逐像素相同，瓦片的迷雾也相同`, () => {
      const start = startBits();
      const a = new ChartWorkState(input, scale);
      const ww = (W * 4) / scale;
      const wh = (H * 4) / scale;
      const first = a.fogSync(start.bits.slice());
      expect(first).toHaveLength(1);
      expect(first[0].cells).toBe("all");
      const canvas = compose(ww, wh, first);
      const final = new FogBits(W, H, start.bits);
      for (const runs of batches) {
        final.applyRuns(runs);
        const parts = a.fogRuns(runs);
        // 每块都远小于整张（远隔的几处各是一块）
        for (const p of parts) expect(p.img.w).toBeLessThan(ww);
        compose(ww, wh, parts, canvas);
      }
      // 与一份从头整张同步到最后状态的结果相同
      const b = new ChartWorkState(input, scale);
      const whole = b.fogSync(final.bits.slice())[0].img;
      expect([whole.w, whole.h]).toEqual([ww, wh]);
      expect(canvas.every((v, i) => v === whole.data[i])).toBe(true);
      expect(a.fogFull()!.data.every((v, i) => v === whole.data[i])).toBe(true);
      // 经典的文本路径（整张 '0' / '1'）也得到同样的图
      const c = new ChartWorkState(input, scale);
      const viaRows = c.fogUpdate(final.toRows())!;
      expect(viaRows.data.every((v, i) => v === whole.data[i])).toBe(true);
      // 航行视图的瓦片按同一份探索状态盖雾
      const ta = a.tile(1, 1, 0);
      const tb = b.tile(1, 1, 0);
      expect(ta.data.every((v, i) => v === tb.data[i])).toBe(true);
    });
  }

  it("没有 Worker 时的调度：排着的区间合并成一次；回调的几块贴上去与整张相同；没有新揭开时回调 null", async () => {
    const got: { img: RgbaImage; cells: unknown }[] = [];
    let nulls = 0;
    const jobs = createChartJobs(
      input,
      {
        chart: () => {},
        fog: (img, cells) => {
          if (img) got.push({ img, cells });
          else nulls++;
        },
      },
      { worker: false },
    );
    const bits = startBits();
    jobs.fogSync(bits);
    // 交出去之后改原位图不影响已经交出去的那份
    bits.applyRuns([[0, 0, W - 1]]);
    const final = startBits();
    for (const runs of batches) {
      final.applyRuns(runs);
      jobs.fogRuns(runs);
    }
    await waitFor(() => expect(got.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 30));
    // 第一次是整张；四批区间在第一次计算期间排着，合并成一次算（几处各一块）
    expect(got[0].cells).toBe("all");
    expect(nulls).toBe(0);
    const canvas = compose(W * 4, H * 4, got);
    const whole = new ChartWorkState(input, 1).fogSync(final.bits.slice())[0].img;
    expect(canvas.every((v, i) => v === whole.data[i])).toBe(true);
    // 没有新揭开的区间：回调一次 null（与文本的“没有变化”相同）
    jobs.fogRuns([[0, 0, 3]]);
    await waitFor(() => expect(nulls).toBe(1));
    jobs.destroy();
  });

  it("迷雾的喂法：先给整张位图，跟得上时只给区间；序号跳过了给整张；同一个后台线程只喂一份；注销后不喂", () => {
    resetChartFog();
    const hub = acquireChartHub("fog-feed-test", input, { worker: false });
    const sync = vi.spyOn(hub.jobs, "fogSync").mockImplementation(() => {});
    const runs = vi.spyOn(hub.jobs, "fogRuns").mockImplementation(() => {});
    const map = "test:earth:h1";
    const state = { epoch: "e", rev: 1, bits: new FogBits(W, H) };
    useChartFog.setState({ map, state, rows: null, changed: "all", seq: 100, runs: null });
    const off1 = attachFogFeed(hub, map);
    const off2 = attachFogFeed(hub, map);
    expect(sync).toHaveBeenCalledTimes(1);
    // 下一个序号的区间：只给区间（两个使用者也只喂一次）
    useChartFog.setState({ state: { ...state, rev: 2 }, seq: 101, runs: [[1, 2, 3]] });
    expect(runs).toHaveBeenCalledTimes(1);
    expect(runs).toHaveBeenLastCalledWith([[1, 2, 3]]);
    // 别的地图的迷雾：不喂
    useChartFog.setState({ map: "other", seq: 102 });
    expect(sync).toHaveBeenCalledTimes(1);
    // 回到这张图、序号跳过了：给整张
    useChartFog.setState({ map, state: { ...state, rev: 3 }, seq: 103, runs: [[2, 2, 3]] });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(runs).toHaveBeenCalledTimes(1);
    off1();
    off2();
    // 注销之后不再喂
    useChartFog.setState({ seq: 104, runs: [[3, 2, 3]] });
    expect(runs).toHaveBeenCalledTimes(1);
    hub.release();
    resetChartFog();
  });
});
