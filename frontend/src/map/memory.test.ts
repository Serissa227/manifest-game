// 整图、迷雾、瓦片统一计账（性能商议 2026-10-07 第 5 条）：记忆化缓存按字节（大对象单独记）、换季只留要用的整图、
// 瓦片的配额扣掉基础缓冲、离开世界（最后一个使用者放手）后这张图的账清零、大对象释放。
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { chartMemoKey, type ChartInput } from "../art/map";
import { fogCloudBytes, fogCloudKey } from "../art/map/fog";
import { Px } from "../art/px";
import { MEMO_LARGE_BYTES, forgetMemo, memo, memoBytes, memoStats, setMemoBudget } from "../art/render";
import { acquireChartHub } from "./chartHub";
import { ChartWorkState } from "./chartWork";
import { FogBits } from "./fogBits";
import { TILE_FLOOR, accountedBytes, baseBytes, ledgerSnapshot, tileBudget } from "./memory";
import { MEMORY_BUDGET } from "./tiles";

const MiB = 1024 * 1024;

afterEach(() => setMemoBudget());

function smallMap(W: number, H: number, wrap = false): ChartInput {
  const rows = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (Math.hypot(x - W / 2, y - H / 2) < Math.min(W, H) / 5 ? "#" : "~")).join(""));
  return { width: W, height: H, rows, places: [], wrapX: wrap };
}

describe("记忆化缓存按字节记账", () => {
  it("大对象单独记：合计超过上限时从最久没用的开始淘汰（至少留刚放进去的）；小图不受影响；可以按键释放", () => {
    setMemoBudget({ large: 5 * MiB });
    const before = memoStats();
    const big = (tag: string) => memo(`test-large:${tag}`, () => new Px(1024, 640));
    expect(1024 * 640 * 4).toBeGreaterThanOrEqual(MEMO_LARGE_BYTES);
    const a = big("a");
    big("b");
    expect(big("a")).toBe(a); // 命中：变新
    big("c"); // 超了：淘汰最久没用的 b
    const s = memoStats();
    expect(s.largeBytes - before.largeBytes).toBeLessThanOrEqual(5 * MiB);
    expect(memoBytes((k) => k === "test-large:b")).toBe(0);
    expect(memoBytes((k) => k === "test-large:a")).toBe(1024 * 640 * 4);
    // 单张就超过上限也留下（至少留刚放进去的）
    setMemoBudget({ large: 1 * MiB });
    big("d");
    expect(memoBytes((k) => k === "test-large:d")).toBe(1024 * 640 * 4);
    // 小图照旧（不进大对象的账）
    const icon = memo("test-small:icon", () => new Px(16, 16));
    expect(memo("test-small:icon", () => new Px(16, 16))).toBe(icon);
    expect(memoStats().smallBytes).toBeGreaterThanOrEqual(16 * 16 * 4);
    // 按键释放
    const freed = forgetMemo((k) => k.startsWith("test-large:") || k.startsWith("test-small:"));
    expect(freed).toBeGreaterThanOrEqual(1024 * 640 * 4 + 16 * 16 * 4);
    expect(memoBytes((k) => k.startsWith("test-"))).toBe(0);
  });
});

describe("换季只留要用的整图", () => {
  it("大地图（世界图每格 2 像素）：切瓦片用的整图只留一季，海图不进记忆化缓存；持有的字节不随换季增长", () => {
    const input = smallMap(64, 32, true);
    const st = new ChartWorkState(input, 2);
    const full = 64 * 4 * 32 * 4 * 4;
    const held: number[] = [];
    for (const season of [0, 1, 2, 3, 0, 2]) {
      st.base(season);
      st.chart(season);
      held.push(st.heldBytes());
    }
    expect(Math.max(...held)).toBe(held[0]);
    expect(held[0]).toBe(full);
    const keys = new Set([0, 1, 2, 3].map((s) => chartMemoKey(input, s)));
    expect(memoBytes((k) => keys.has(k))).toBe(0);
    st.release();
  });

  it("经典世界：记忆化缓存里只留最近要过的两季（要显示的与预先生成的下一季）", () => {
    const input = smallMap(48, 24);
    const st = new ChartWorkState(input, 1);
    const one = 48 * 4 * 24 * 4 * 4;
    for (const season of [0, 1, 2, 3, 1]) st.chart(season);
    const keys = [0, 1, 2, 3].map((s) => chartMemoKey(input, s));
    expect(memoBytes((k) => keys.includes(k))).toBe(2 * one);
    // 最近的两季：1 与 3
    expect(memoBytes((k) => k === keys[1] || k === keys[3])).toBe(2 * one);
    st.release();
    expect(memoBytes((k) => keys.includes(k))).toBe(0);
  });
});

describe("瓦片的配额扣掉基础缓冲", () => {
  it("大地图的基础缓冲按尺寸算（整图、世界图分辨率的迷雾图、云团毯的块缓存、世界图与画布），瓦片拿剩下的，至少留 TILE_FLOOR", () => {
    const big = baseBytes(1080, 396, 2);
    // 后台线程里只剩一张每格 4 像素的整图（26.1 MiB，切瓦片用）；迷雾图按世界图的分辨率、云团毯按块、边缘噪声不常驻
    // （性能商议第 5 条的后续：以前三张整图 + 噪声格点表，约 122 MiB）。手机上整张图的基础缓冲不超过 80 MiB
    expect(big).toBeGreaterThan(1080 * 4 * 396 * 4 * 4);
    expect(big).toBeLessThanOrEqual(80 * MiB);
    expect(tileBudget(1080, 396, 2, MEMORY_BUDGET.desktop)).toBe(MEMORY_BUDGET.desktop - big);
    expect(tileBudget(1080, 396, 2, MEMORY_BUDGET.desktop) + big).toBeLessThanOrEqual(MEMORY_BUDGET.desktop);
    // 手机：瓦片的配额不少于 40 MiB（至少约 10 块的下限照旧）
    expect(tileBudget(1080, 396, 2, MEMORY_BUDGET.mobile)).toBe(Math.max(TILE_FLOOR, MEMORY_BUDGET.mobile - big));
    expect(tileBudget(1080, 396, 2, MEMORY_BUDGET.mobile)).toBeGreaterThanOrEqual(40 * MiB);
    expect(tileBudget(1080, 396, 2, MEMORY_BUDGET.mobile)).toBeGreaterThanOrEqual(10 * 64 * 12 * 64 * 12 * 4);
    // 经典世界的基础缓冲比大地图小，也不比改动前大（改动前按尺寸估计为 34 496 648 字节）
    const classic = baseBytes(400, 170, 1);
    expect(classic).toBeLessThan(big);
    expect(classic).toBeLessThanOrEqual(34_496_648);
    expect(tileBudget(400, 170, 1, MEMORY_BUDGET.desktop)).toBe(MEMORY_BUDGET.desktop - classic);
  });
});

describe("离开世界后大对象释放", () => {
  it("没有 Worker 时（主线程后备）：账上记着整图、迷雾与世界图；最后一个使用者放手后账清零，整图、迷雾、缓存里的海图与云团毯的块都释放", async () => {
    const W = 60;
    const H = 30;
    const input = smallMap(W, H, true);
    const key = "memory-test:earth:h1:60x30";
    const hub = acquireChartHub(key, input, { worker: false });
    const second = acquireChartHub(key, input, { worker: false });
    expect(second).toBe(hub);
    let charts = 0;
    let fogs = 0;
    const unsub = hub.subscribe({ chart: () => charts++, fog: () => fogs++ });
    hub.jobs.chart(1);
    const bits = new FogBits(W, H);
    for (let y = 0; y < H; y++) bits.applyRuns([[y, 0, 20]]);
    hub.jobs.fogSync(bits);
    hub.jobs.tile(1, 0, 0);
    await waitFor(() => expect(charts).toBe(1));
    await waitFor(() => expect(fogs).toBeGreaterThanOrEqual(1));
    const ledger = ledgerSnapshot();
    expect(ledger[`${key}:worker`]).toBeGreaterThan(0);
    expect(ledger[`${key}:world`]).toBe(W * 4 * H * 4 * 4);
    expect(accountedBytes(`${key}:`)).toBeGreaterThan(W * 4 * H * 4 * 4 * 2);
    // 云团毯不再进记忆化缓存，按块放在自己的块缓存里（这张小图的块全放得下：合计就是整张的大小）
    const cloud = fogCloudKey(W, H, true);
    expect(memoBytes((k) => k === cloud)).toBe(0);
    expect(fogCloudBytes(W, H, true)).toBe(W * 4 * H * 4 * 4);
    unsub();
    // 还有一个使用者：不释放
    hub.release();
    expect(accountedBytes(`${key}:`)).toBeGreaterThan(0);
    expect(fogCloudBytes(W, H, true)).toBe(W * 4 * H * 4 * 4);
    second.release();
    expect(accountedBytes(`${key}:`)).toBe(0);
    expect(memoBytes((k) => k === cloud)).toBe(0);
    expect(fogCloudBytes(W, H, true)).toBe(0);
    const keys = new Set([0, 1, 2, 3].map((s) => chartMemoKey(input, s)));
    expect(memoBytes((k) => keys.has(k))).toBe(0);
    // 再要同一张图：重新建一个（旧的已经销毁）
    const again = acquireChartHub(key, input, { worker: false });
    expect(again).not.toBe(hub);
    again.release();
  });
});
